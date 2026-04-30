import { BrowserWindow, BrowserView, Updater } from "electrobun/bun";
import os from "os";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { deviceDiscovery } from "./device-discovery";
import { tcpTransferServer, loadChunkSize } from "./tcp-transfer-server";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log("Vite dev server not running. Run 'bun run dev:hmr' for HMR support.");
    }
  }
  return "views://mainview/index.html";
}

/**
 * Save received file data to ~/Downloads/drop.local/<fileName>.
 * Returns the absolute path written.
 */
async function saveReceivedFile(fileName: string, data: Buffer): Promise<string> {
  const downloadsDir = path.join(os.homedir(), "Downloads", "drop.local");
  await mkdir(downloadsDir, { recursive: true });

  // Avoid clobbering existing files by appending a counter suffix
  let targetPath = path.join(downloadsDir, fileName);
  let counter = 1;
  while (true) {
    try {
      await writeFile(targetPath, data, { flag: "wx" }); // fail if exists
      break;
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.code !== "EEXIST") throw err;
      counter += 1;
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      targetPath = path.join(downloadsDir, `${base} (${counter})${ext}`);
    }
  }

  console.log(`💾 Saved to ${targetPath}`);
  return targetPath;
}

// eslint-disable-next-line no-useless-assignment
let mainWindowRef: BrowserWindow | null = null;

const deviceDiscoveryRPC = BrowserView.defineRPC({
  handlers: {
    requests: {
      getDevices: () => {
        const devices = deviceDiscovery.getDevices();
        console.log("Frontend requested devices:", devices.length);
        return devices;
      },
      getLocalDeviceId: () => deviceDiscovery.getLocalDeviceId(),
      getLocalDeviceName: () => os.hostname(),
      getLocalAppVersion: () => deviceDiscovery.localVersion,
      subscribeToDeviceEvents: () => {
        console.log("Frontend subscribed to device events");
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        const rpc = mainWindowRef?.webview?.rpc as any;
        if (rpc) {
          for (const device of deviceDiscovery.getDevices()) {
            try {
              rpc.send.onDeviceEvent({ type: "device-joined", device });
            } catch (err) {
              console.error("Failed to push initial device:", err);
            }
          }
        }
        return { success: true };
      },
      sendFile: async ({ recipientId, fileName, fileData, mimeType, isTextMessage }) => {
        const logType = isTextMessage ? "text message" : "file";
        console.log(
          `📤 Sending ${logType} "${fileName}" to ${recipientId} (${fileData.length} bytes)`,
        );

        const recipient = deviceDiscovery.getDevices().find((d) => d.id === recipientId);
        if (!recipient) throw new Error(`Device ${recipientId} not found`);

        await tcpTransferServer.sendFile(
          recipient.ip,
          fileName,
          Buffer.from(fileData),
          mimeType,
          deviceDiscovery.getLocalDeviceId(),
          isTextMessage,
        );
        return { success: true };
      },
      sendFileChunk: async ({
        transferId,
        chunkData,
        isFirst,
        isLast,
        fileName,
        totalSize,
        mimeType,
        recipientId,
      }) => {
        if (isFirst) {
          const recipient = deviceDiscovery.getDevices().find((d) => d.id === recipientId);
          if (!recipient) throw new Error(`Device ${recipientId} not found`);
          console.log(
            `📦 Starting streaming: "${fileName}" (${totalSize} bytes) → ${recipient.ip}`,
          );
          await tcpTransferServer.startStreamingTransfer(
            transferId,
            recipient.ip,
            fileName,
            totalSize,
            mimeType || "application/octet-stream",
            deviceDiscovery.getLocalDeviceId(),
          );
        }

        await tcpTransferServer.writeChunk(transferId, Buffer.from(chunkData));

        if (isLast) {
          // Fire-and-forget: don't block the RPC call waiting for 100% ack
          tcpTransferServer
            .finishStreamingTransfer(transferId)
            .then(() => console.log(`✓ Streaming complete: "${fileName}"`))
            .catch((err) => console.error(`✗ Streaming failed: ${err}`));
        }
        return { success: true };
      },
    },
    messages: {},
  },
});

// ── Mandatory auto-update on every launch ────────────────────────────────────
const localVersion = await Updater.localInfo.version();
const channel = await Updater.localInfo.channel();
console.log(`🔖 App version: ${localVersion} (channel: ${channel})`);

// Inject version into device discovery so peers see it in UDP broadcasts
deviceDiscovery.localVersion = localVersion;

if (channel !== "dev") {
  console.log("🔄 Checking for updates...");
  try {
    const updateInfo = await Updater.checkForUpdate();
    if (updateInfo?.updateAvailable) {
      console.log(`⬆️  Update available: ${updateInfo.version} — downloading...`);
      await Updater.downloadUpdate();
      await Updater.applyUpdate(); // relaunches the app automatically
    } else {
      console.log("✓ App is up to date");
    }
  } catch (err) {
    console.error("⚠️ Update check failed (continuing):", err);
  }
}

// Create the main application window
const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
  title: "drop.local",
  url,
  frame: {
    width: 900,
    height: 700,
    x: 200,
    y: 200,
  },
  rpc: deviceDiscoveryRPC,
});

// Store window reference
mainWindowRef = mainWindow;

// Show the window
mainWindow.show();

// Load adaptive chunk size from installer-written perf.json
await loadChunkSize();

// Start TCP transfer server
console.log("Starting TCP transfer server...");
await tcpTransferServer.start();

// Inject local keypair into TCP server for E2E encryption
tcpTransferServer.localPrivateKey = deviceDiscovery.getLocalPrivateKey();
tcpTransferServer.localPublicKeyHex = deviceDiscovery.getLocalPublicKeyHex();

// Handle incoming file/text transfers
tcpTransferServer.onTransfer(async (metadata, data) => {
  console.log(`📥 Received: "${metadata.fileName}" from ${metadata.from}`);

  const localDeviceId = deviceDiscovery.getLocalDeviceId();
  if (metadata.from === localDeviceId) {
    console.log(`⚠️ Ignoring loopback transfer`);
    return;
  }

  const sender = deviceDiscovery.getDevices().find((d) => d.id === metadata.from);
  const fromName = sender?.name ?? "Unknown";

  // Save non-text files to ~/Downloads/drop.local/
  let savePath: string | undefined;
  if (!metadata.isTextMessage) {
    try {
      savePath = await saveReceivedFile(metadata.fileName, data);
    } catch (err) {
      console.error(`✗ Failed to save "${metadata.fileName}":`, err);
    }
  }

  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = mainWindowRef?.webview?.rpc as any;
  if (rpc) {
    rpc.send.onFileReceived({
      transferId: metadata.transferId,
      fileName: metadata.fileName,
      fileSize: metadata.fileSize,
      mimeType: metadata.mimeType,
      from: metadata.from,
      fromName,
      isTextMessage: metadata.isTextMessage,
      savePath,
      data: Array.from(data),
    });
    console.log(
      `✓ ${metadata.isTextMessage ? "Text message" : "File"} forwarded to frontend from ${fromName}`,
    );
  }
});

// Forward transfer progress to frontend
tcpTransferServer.onProgress((progress) => {
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = mainWindowRef?.webview?.rpc as any;
  rpc?.send.onTransferProgress(progress);
});

// Start device discovery service
console.log("Starting device discovery...");
await deviceDiscovery.start();

// Keep TCP server's peer-key map in sync with discovered devices
deviceDiscovery.onDeviceEvent((event) => {
  if (event.type === "device-joined" || event.type === "device-updated") {
    const pubKey = deviceDiscovery.getPeerPublicKey(event.device.id);
    if (pubKey) {
      tcpTransferServer.setPeerPublicKey(event.device.ip, pubKey);
    }
  }
});

// Forward device events to frontend in real-time
deviceDiscovery.onDeviceEvent((event) => {
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = mainWindowRef?.webview?.rpc as any;
  try {
    rpc?.send.onDeviceEvent(event);
  } catch (err) {
    console.error("Failed to send device event to frontend:", err);
  }
});

// Graceful shutdown
const shutdown = async () => {
  console.log("\nShutting down gracefully...");
  await deviceDiscovery.stop();
  await tcpTransferServer.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Handle window close
mainWindow.on("close", async () => {
  console.log("Window closing, stopping services...");
  await deviceDiscovery.stop();
  await tcpTransferServer.stop();
});

console.log("React Tailwind Vite app started!");
