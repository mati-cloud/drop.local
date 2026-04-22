import { Electroview } from "electrobun/view";

// Device event callback type
type DeviceEventCallback = (event: {
  type: "device-joined" | "device-left" | "device-updated";
  device: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}) => void;

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
}

// Store device event listeners
const deviceEventListeners = new Set<DeviceEventCallback>();

// Store file received listeners
const fileReceivedListeners = new Set<(file: ReceivedFile) => void>();

// Store transfer progress listeners
const transferProgressListeners = new Set<(progress: TransferProgress) => void>();

// Create the Electroview instance with message handlers
export const electroview = new Electroview({
  rpc: Electroview.defineRPC({
    handlers: {
      requests: {},
      messages: {
        // Receive device events from backend
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onDeviceEvent: (event: any) => {
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
      },
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

// Make it globally available for debugging
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).electroview = electroview;
  console.log("✓ Electroview initialized and available globally");
}
