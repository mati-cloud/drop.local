/**
 * Device Discovery via mDNS/DNS-SD (_drop-local._tcp)
 *
 * Uses multicast-dns for RFC 6762/6763 compliant service announcement and browsing.
 * Peers appear/disappear via multicast events — no polling, no UDP broadcast storm.
 * X25519 public key is embedded in the DNS-SD TXT record for zero-round-trip key exchange.
 */

import os from "os";
// oxlint-disable-next-line @typescript-eslint/no-require-imports
const mdns = require("multicast-dns") as () => MdnsInstance;
import { generateKeyPair, type DeviceKeyPair } from "./crypto";

// ── Minimal multicast-dns types ───────────────────────────────────────────────

interface DnsRecord {
  name: string;
  type: string;
  ttl?: number;
  data?: unknown;
}

interface DnsPacket {
  type: "query" | "response";
  questions?: Array<{ name: string; type: string }>;
  answers?: DnsRecord[];
  additionals?: DnsRecord[];
  authorities?: DnsRecord[];
}

interface RInfo {
  address: string;
  port: number;
}

interface MdnsInstance {
  on(event: "query", cb: (packet: DnsPacket, rinfo: RInfo) => void): void;
  on(event: "response", cb: (packet: DnsPacket, rinfo: RInfo) => void): void;
  on(event: "ready", cb: () => void): void;
  on(event: "warning", cb: (err: unknown) => void): void;
  query(questions: Array<{ name: string; type: string }>, cb?: () => void): void;
  respond(answers: DnsRecord[], cb?: () => void): void;
  destroy(cb?: () => void): void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_TYPE = "_drop-local._tcp.local";
const SERVICE_PORT = 50002;
const REANNOUNCE_INTERVAL = 10_000; // re-announce every 10s for late joiners

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

class DeviceDiscoveryService {
  private devices: Map<string, DiscoveredDevice> = new Map();
  private eventListeners: Set<DeviceEventCallback> = new Set();
  private cachedDeviceId: string | null = null;
  private keyPair: DeviceKeyPair = generateKeyPair();
  private peerPublicKeys: Map<string, string> = new Map();
  private mdns: MdnsInstance | null = null;
  private reannounceInterval: Timer | null = null;
  localVersion: string = "0.0.1";

  async start(): Promise<void> {
    console.log("Starting mDNS device discovery...");

    this.mdns = mdns();
    const localId = this.generateDeviceId();

    // ── Answer PTR queries — lets others browse _drop-local._tcp.local ─────────
    this.mdns.on("query", (packet) => {
      const hasPtrQuery = packet.questions?.some(
        (q) => q.name === SERVICE_TYPE && (q.type === "PTR" || q.type === "ANY"),
      );
      if (!hasPtrQuery) return;
      this.sendAnnouncement();
    });

    // ── Parse responses — pick up peers announcing themselves ──────────────────
    this.mdns.on("response", (packet, rinfo) => {
      try {
        this.handleResponse(packet, rinfo);
      } catch (err) {
        console.error("mDNS response error:", err);
      }
    });

    this.mdns.on("warning", (err) => {
      console.warn("mDNS warning:", err);
    });

    // Initial announcement + periodic re-announce for late joiners
    await new Promise<void>((resolve) => {
      this.mdns!.on("ready", () => {
        this.sendAnnouncement();
        this.queryForPeers();
        resolve();
      });
    });

    this.reannounceInterval = setInterval(() => {
      this.sendAnnouncement();
      this.queryForPeers();
    }, REANNOUNCE_INTERVAL);

    console.log(`✓ mDNS discovery started (service: ${SERVICE_TYPE})`);
  }

  private sendAnnouncement(): void {
    if (!this.mdns) return;
    const localId = this.generateDeviceId();
    const hostname = os.hostname();
    const localIp = this.getLocalIpAddress();
    const instanceName = `drop-local-${localId}.${SERVICE_TYPE}`;

    this.mdns.respond([
      { name: SERVICE_TYPE, type: "PTR", ttl: 4500, data: instanceName },
      {
        name: instanceName,
        type: "SRV",
        ttl: 120,
        data: { port: SERVICE_PORT, target: `${hostname}.local`, priority: 0, weight: 0 },
      },
      {
        name: instanceName,
        type: "TXT",
        ttl: 4500,
        data: [
          `id=${localId}`,
          `name=${hostname}`,
          `type=${this.guessDeviceType(hostname)}`,
          `publicKey=${this.keyPair.publicKey.toString("hex")}`,
          `version=${this.localVersion}`,
        ],
      },
      { name: `${hostname}.local`, type: "A", ttl: 120, data: localIp },
    ]);
  }

  private queryForPeers(): void {
    this.mdns?.query([{ name: SERVICE_TYPE, type: "PTR" }]);
  }

  private handleResponse(packet: DnsPacket, rinfo: RInfo): void {
    const allRecords = [...(packet.answers ?? []), ...(packet.additionals ?? [])];

    // Find PTR records pointing to our service type
    const ptrRecords = allRecords.filter((r) => r.type === "PTR" && r.name === SERVICE_TYPE);
    if (ptrRecords.length === 0) return;

    for (const ptr of ptrRecords) {
      const instanceName = ptr.data as string;
      if (!instanceName) continue;

      // Find matching TXT record for this instance
      const txtRecord = allRecords.find((r) => r.type === "TXT" && r.name === instanceName);
      if (!txtRecord?.data) continue;

      const txt = txtRecord.data as Record<string, string | Buffer>;
      const peerId = typeof txt.id === "string" ? txt.id : txt.id?.toString();
      if (!peerId || peerId === this.generateDeviceId()) continue;

      const peerName =
        typeof txt.name === "string" ? txt.name : (txt.name?.toString() ?? rinfo.address);
      const peerType = (
        typeof txt.type === "string" ? txt.type : "desktop"
      ) as DiscoveredDevice["type"];
      const peerPublicKey =
        typeof txt.publicKey === "string" ? txt.publicKey : txt.publicKey?.toString("hex");
      const peerVersion = typeof txt.version === "string" ? txt.version : "unknown";

      if (peerPublicKey) {
        this.peerPublicKeys.set(peerId, peerPublicKey);
      }

      const existing = this.devices.get(peerId);
      const device: DiscoveredDevice = {
        id: peerId,
        name: peerName,
        type: peerType,
        ip: rinfo.address,
        port: SERVICE_PORT,
        lastSeen: Date.now(),
        version: peerVersion,
      };

      this.devices.set(peerId, device);

      if (!existing) {
        console.log(`✓ Device joined: ${device.name} @ ${device.ip}`);
        this.emitDeviceEvent("device-joined", device);
      } else {
        this.emitDeviceEvent("device-updated", device);
      }
    }
  }

  private getLocalIpAddress(): string {
    const interfaces = os.networkInterfaces();
    const priority = ["Wi-Fi", "WiFi", "Ethernet", "en0", "eth0", "wlan0"];

    for (const name of [...priority, ...Object.keys(interfaces)]) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal) return addr.address;
      }
    }
    return "127.0.0.1";
  }

  private generateDeviceId(): string {
    if (this.cachedDeviceId) return this.cachedDeviceId;

    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const addr of iface) {
        if (addr.mac && addr.mac !== "00:00:00:00:00:00") {
          this.cachedDeviceId = addr.mac.replace(/:/g, "");
          return this.cachedDeviceId;
        }
      }
    }

    this.cachedDeviceId = `device-${Date.now()}`;
    return this.cachedDeviceId;
  }

  private guessDeviceType(hostname: string): DiscoveredDevice["type"] {
    const h = hostname.toLowerCase();
    if (h.includes("macbook") || h.includes("laptop")) return "laptop";
    return "desktop";
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

  onDeviceEvent(callback: DeviceEventCallback): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  private emitDeviceEvent(
    type: "device-joined" | "device-left" | "device-updated",
    device: DiscoveredDevice,
  ): void {
    for (const listener of this.eventListeners) {
      try {
        listener({ type, device });
      } catch (error) {
        console.error("Error in device event listener:", error);
      }
    }
  }

  async stop(): Promise<void> {
    console.log("Stopping mDNS device discovery...");

    if (this.reannounceInterval) {
      clearInterval(this.reannounceInterval);
      this.reannounceInterval = null;
    }

    await new Promise<void>((resolve) => {
      if (!this.mdns) return resolve();
      this.mdns.destroy(resolve);
    });

    this.mdns = null;
    this.devices.clear();
    console.log("mDNS device discovery stopped");
  }
}

export const deviceDiscovery = new DeviceDiscoveryService();
