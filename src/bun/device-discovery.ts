import { BrowserWindow } from "electrobun/bun";
import os from "os";
import { generateKeyPair, type DeviceKeyPair } from "./crypto";

export interface DiscoveredDevice {
  id: string;
  name: string;
  type: "laptop" | "phone" | "tablet" | "desktop";
  ip: string;
  port: number;
  lastSeen: number;
  version: string;
}

type DeviceEventCallback = (event: {
  type: "device-joined" | "device-left" | "device-updated";
  device: DiscoveredDevice;
}) => void;

const SERVICE_TYPE = "_drop-local._tcp";
const SERVICE_PORT = 50002;
const BROADCAST_INTERVAL = 2000; // 2 seconds - broadcast presence (aggressive for LAN)
const STALE_THRESHOLD = 6000; // 6 seconds - remove devices not seen (3x broadcast interval)

class DeviceDiscoveryService {
  private devices: Map<string, DiscoveredDevice> = new Map();
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  private server: any = null;
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  private broadcastClient: any = null; // Persistent UDP socket for broadcasts
  private broadcastInterval: Timer | null = null;
  private cleanupInterval: Timer | null = null;
  private eventListeners: Set<DeviceEventCallback> = new Set();
  private cachedDeviceId: string | null = null; // Cache device ID for consistency
  private keyPair: DeviceKeyPair = generateKeyPair();
  private peerPublicKeys: Map<string, string> = new Map();
  localVersion: string = "0.0.1";

  async start(): Promise<void> {
    console.log("Starting device discovery service...");

    // Get local device info
    const localDevice = this.getLocalDeviceInfo();
    console.log("Local device:", localDevice);

    // Start UDP broadcast server for device discovery
    await this.startBroadcastServer();

    // Start periodic broadcast
    this.startPeriodicBroadcast();

    // Start cleanup of stale devices
    this.startCleanup();
  }

  private getLocalDeviceInfo(): DiscoveredDevice {
    const hostname = os.hostname();
    const platform = os.platform();

    let type: DiscoveredDevice["type"] = "desktop";
    if (platform === "darwin") {
      type = hostname.toLowerCase().includes("macbook") ? "laptop" : "desktop";
    } else if (platform === "win32") {
      type = "desktop";
    } else if (platform === "linux") {
      type = "desktop";
    }

    const localIp = this.getLocalIpAddress();

    return {
      id: this.generateDeviceId(),
      name: hostname,
      type,
      ip: localIp,
      port: SERVICE_PORT,
      lastSeen: Date.now(),
      version: this.localVersion,
    };
  }

  private getPrimaryNetworkInterface(): { ip: string; broadcast: string } | null {
    const interfaces = os.networkInterfaces();

    // Prioritize common network interface names
    const priorityNames = ["Wi-Fi", "WiFi", "Ethernet", "en0", "eth0", "wlan0"];

    // First, try priority interfaces
    for (const priorityName of priorityNames) {
      const iface = interfaces[priorityName];
      if (!iface) continue;

      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal && addr.netmask) {
          const ip = addr.address.split(".").map(Number);
          const mask = addr.netmask.split(".").map(Number);
          const broadcast = ip.map((byte, i) => byte | (~mask[i] & 255));
          return {
            ip: addr.address,
            broadcast: broadcast.join("."),
          };
        }
      }
    }

    // Fallback: find any non-internal IPv4 interface
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;

      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal && addr.netmask) {
          const ip = addr.address.split(".").map(Number);
          const mask = addr.netmask.split(".").map(Number);
          const broadcast = ip.map((byte, i) => byte | (~mask[i] & 255));
          return {
            ip: addr.address,
            broadcast: broadcast.join("."),
          };
        }
      }
    }

    return null;
  }

  private getLocalIpAddress(): string {
    const primary = this.getPrimaryNetworkInterface();
    return primary?.ip || "127.0.0.1";
  }

  private generateDeviceId(): string {
    // Return cached ID if available for consistency
    if (this.cachedDeviceId) {
      return this.cachedDeviceId;
    }

    const interfaces = os.networkInterfaces();
    let macAddress = "";

    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;

      for (const addr of iface) {
        if (addr.mac && addr.mac !== "00:00:00:00:00:00") {
          macAddress = addr.mac;
          break;
        }
      }
      if (macAddress) break;
    }

    // Cache the generated ID
    this.cachedDeviceId = macAddress || `device-${Date.now()}`;
    return this.cachedDeviceId;
  }

  private async startBroadcastServer(): Promise<void> {
    try {
      const dgram = await import("dgram");
      this.server = dgram.createSocket({ type: "udp4", reuseAddr: true });

      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      this.server.on("message", (msg: Buffer, rinfo: any) => {
        try {
          const data = JSON.parse(msg.toString());
          // console.log(`Received message from ${rinfo.address}:${rinfo.port}:`, data);

          if (data.type === "drop-local-goodbye") {
            // Device is gracefully disconnecting
            const localId = this.generateDeviceId();
            if (data.id !== localId) {
              const device = this.devices.get(data.id);
              if (device) {
                console.log("✗ Device left (goodbye):", data.name);
                this.devices.delete(data.id);
                this.emitDeviceEvent("device-left", device);
              }
            }
          } else if (data.type === "drop-local-announce") {
            const device: DiscoveredDevice = {
              id: data.id,
              name: data.name,
              type: data.deviceType || "desktop",
              ip: rinfo.address,
              port: data.port || SERVICE_PORT,
              lastSeen: Date.now(),
              version: data.version || "unknown",
            };

            // Store peer's public key if provided
            if (data.publicKey && typeof data.publicKey === "string") {
              this.peerPublicKeys.set(data.id, data.publicKey);
            }

            // Don't add ourselves
            const localId = this.generateDeviceId();
            if (device.id !== localId) {
              const existingDevice = this.devices.get(device.id);
              const isNew = !existingDevice;

              this.devices.set(device.id, device);

              if (isNew) {
                console.log("✓ Device joined:", device.name);
                this.emitDeviceEvent("device-joined", device);
              } else {
                // Device updated (heartbeat)
                this.emitDeviceEvent("device-updated", device);
              }
            } else {
              // console.log("Ignored own broadcast from:", device.name);
            }
          }
        } catch (err) {
          console.error("Error parsing broadcast message:", err);
        }
      });

      this.server.on("error", (err: Error) => {
        console.error("Broadcast server error:", err);
      });

      this.server.bind(SERVICE_PORT, () => {
        this.server.setBroadcast(true);
        console.log(`Device discovery listening on port ${SERVICE_PORT}`);
      });
    } catch (err) {
      console.error("Failed to start broadcast server:", err);
    }
  }

  private getBroadcastAddress(): string {
    const primary = this.getPrimaryNetworkInterface();
    return primary?.broadcast || "255.255.255.255";
  }

  private async startPeriodicBroadcast(): Promise<void> {
    // Create persistent broadcast socket
    const dgram = await import("dgram");
    this.broadcastClient = dgram.createSocket({ type: "udp4", reuseAddr: true });

    await new Promise<void>((resolve) => {
      this.broadcastClient.bind(() => {
        this.broadcastClient.setBroadcast(true);
        resolve();
      });
    });

    const broadcast = () => {
      try {
        const localDevice = this.getLocalDeviceInfo();
        const message = JSON.stringify({
          type: "drop-local-announce",
          id: localDevice.id,
          name: localDevice.name,
          deviceType: localDevice.type,
          port: SERVICE_PORT,
          timestamp: Date.now(),
          publicKey: this.keyPair.publicKey.toString("hex"),
          version: this.localVersion,
        });

        const buffer = Buffer.from(message);
        const broadcastAddr = this.getBroadcastAddress();

        // console.log(`Broadcasting to ${broadcastAddr}:${SERVICE_PORT}`);

        this.broadcastClient.send(
          buffer,
          0,
          buffer.length,
          SERVICE_PORT,
          broadcastAddr,
          (err: unknown) => {
            if (err) {
              console.error("Broadcast error:", err);
            }
          },
        );
      } catch (err) {
        console.error("Failed to broadcast:", err);
      }
    };

    // Broadcast immediately
    broadcast();

    // Then broadcast every 5 seconds
    this.broadcastInterval = setInterval(broadcast, 5000);
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const STALE_THRESHOLD = 15000; // 15 seconds

      for (const [id, device] of this.devices.entries()) {
        if (now - device.lastSeen > STALE_THRESHOLD) {
          console.log("Removing stale device:", device.name);
          this.devices.delete(id);
        }
      }
    }, 5000);
  }

  getDevices(): DiscoveredDevice[] {
    return Array.from(this.devices.values());
  }

  getLocalDeviceId(): string {
    return this.generateDeviceId();
  }

  getLocalPrivateKey(): Buffer {
    return this.keyPair.privateKey;
  }

  getLocalPublicKeyHex(): string {
    return this.keyPair.publicKey.toString("hex");
  }

  getPeerPublicKey(deviceId: string): string | undefined {
    return this.peerPublicKeys.get(deviceId);
  }

  /**
   * Subscribe to real-time device events
   */
  onDeviceEvent(callback: DeviceEventCallback): () => void {
    this.eventListeners.add(callback);
    // console.log("Device event listener added, total listeners:", this.eventListeners.size);

    // Return unsubscribe function
    return () => {
      this.eventListeners.delete(callback);
      // console.log("Device event listener removed, total listeners:", this.eventListeners.size);
    };
  }

  /**
   * Emit device event to all listeners
   */
  private emitDeviceEvent(
    type: "device-joined" | "device-left" | "device-updated",
    device: DiscoveredDevice,
  ): void {
    const event = { type, device };
    // console.log(`📡 Emitting event: ${type} for device ${device.name}`);

    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in device event listener:", error);
      }
    }
  }

  /**
   * Send goodbye broadcast to notify other devices we're leaving
   */
  private async sendGoodbyeBroadcast(): Promise<void> {
    try {
      const dgram = await import("dgram");
      const client = dgram.createSocket({ type: "udp4", reuseAddr: true });

      client.bind(() => {
        client.setBroadcast(true);

        const localDevice = this.getLocalDeviceInfo();
        const message = JSON.stringify({
          type: "drop-local-goodbye",
          id: localDevice.id,
          name: localDevice.name,
        });

        const buffer = Buffer.from(message);
        const broadcastAddr = this.getBroadcastAddress();

        console.log(`📡 Sending goodbye broadcast to ${broadcastAddr}:${SERVICE_PORT}`);

        client.send(buffer, 0, buffer.length, SERVICE_PORT, broadcastAddr, (err) => {
          if (err) {
            console.error("Goodbye broadcast error:", err);
          }
          client.close();
        });
      });
    } catch (err) {
      console.error("sendGoodbyeBroadcast error:", err);
    }
  }

  async stop(): Promise<void> {
    console.log("Stopping device discovery...");

    // Send goodbye broadcast
    await this.sendGoodbyeBroadcast();

    // Stop intervals
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close broadcast client
    if (this.broadcastClient) {
      this.broadcastClient.close();
      this.broadcastClient = null;
    }

    // Close server
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    this.devices.clear();
    console.log("Device discovery service stopped");
  }
}

export const deviceDiscovery = new DeviceDiscoveryService();
