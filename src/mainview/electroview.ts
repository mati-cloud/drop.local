import { Electroview } from "electrobun/view";

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
type DeviceEvent = { type: "device-joined" | "device-left" | "device-updated"; device: any };
type DeviceEventCallback = (event: DeviceEvent) => void;

// Received file interface
interface ReceivedFile {
  transferId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  from: string;
  fromName: string;
  isTextMessage?: boolean;
  savePath?: string; // Absolute path where file was saved on disk (non-text only)
  data: number[]; // Array of bytes
}

// Transfer progress interface
interface TransferProgress {
  transferId: string;
  fileName: string;
  totalBytes: number;
  receivedBytes: number;
  progress: number;
  isTextMessage?: boolean;
}

// Store device event listeners
const deviceEventListeners = new Set<DeviceEventCallback>();

// Store file received listeners
const fileReceivedListeners = new Set<(file: ReceivedFile) => void>();

// Store transfer progress listeners
const transferProgressListeners = new Set<(progress: TransferProgress) => void>();

// Store update ready listeners
const updateReadyListeners = new Set<(version: string) => void>();

// Create the Electroview instance with message handlers
export const electroview = new Electroview({
  rpc: Electroview.defineRPC({
    handlers: {
      requests: {
        checkForUpdate: async () => ({}),
        applyUpdate: async () => ({}),
        revealInFolder: async (_: { filePath: string }) => ({}),
      },
      messages: {
        // Receive device events from backend
        onDeviceEvent: (event: DeviceEvent) => {
          console.log("📡 Received device event:", event.type, event.device.name);

          // Notify all listeners
          for (const listener of deviceEventListeners) {
            try {
              listener(event);
            } catch (error) {
              console.error("Error in device event listener:", error);
            }
          }
        },
        // Receive files from backend
        onFileReceived: (file: ReceivedFile) => {
          console.log("🎯 onFileReceived handler called!");
          console.log("📥 Frontend received file:", file.fileName, "from", file.from);
          console.log("🔍 RPC handler received fromName:", file.fromName);

          // Notify all listeners
          for (const listener of fileReceivedListeners) {
            try {
              listener(file);
            } catch (error) {
              console.error("Error in file received listener:", error);
            }
          }
        },
        // Receive transfer progress from backend
        onTransferProgress: (progress: TransferProgress) => {
          // Notify all listeners
          for (const listener of transferProgressListeners) {
            try {
              listener(progress);
            } catch (error) {
              console.error("Error in transfer progress listener:", error);
            }
          }
        },
        onUpdateReady: ({ version }: { version: string }) => {
          for (const listener of updateReadyListeners) {
            try {
              listener(version);
            } catch {
              /* ignore */
            }
          }
        },
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  }),
});

// Export function to subscribe to device events
export function onDeviceEvent(callback: DeviceEventCallback): () => void {
  deviceEventListeners.add(callback);

  // Return unsubscribe function
  return () => {
    deviceEventListeners.delete(callback);
  };
}

// Export function to subscribe to file received events
export function onFileReceived(callback: (file: ReceivedFile) => void): () => void {
  fileReceivedListeners.add(callback);

  // Return unsubscribe function
  return () => {
    fileReceivedListeners.delete(callback);
  };
}

// Export function to subscribe to transfer progress events
export function onTransferProgress(callback: (progress: TransferProgress) => void): () => void {
  transferProgressListeners.add(callback);

  // Return unsubscribe function
  return () => {
    transferProgressListeners.delete(callback);
  };
}

// Export function to subscribe to update-ready events
export function onUpdateReady(callback: (version: string) => void): () => void {
  updateReadyListeners.add(callback);
  return () => {
    updateReadyListeners.delete(callback);
  };
}

// Trigger the restart to apply the downloaded update
export function restartToUpdate(): void {
  electroview.rpc.request.applyUpdate({}).catch(() => {});
}

// Reveal a file in the OS file manager (Finder / Explorer / Nautilus)
export function revealInFolder(filePath: string): void {
  electroview.rpc.request.revealInFolder({ filePath }).catch(() => {});
}

// Trigger a background update check whenever the window becomes visible
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      electroview.rpc.request.checkForUpdate({}).catch(() => {});
    }
  });
}

// Make it globally available for debugging
if (typeof window !== "undefined") {
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).electroview = electroview;
  console.log("✓ Electroview initialized and available globally");
}
