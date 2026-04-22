/**
 * File Transfer Hook - TCP Version (No WebRTC)
 * Direct TCP connections for LAN-only file transfers
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { electroview, onFileReceived, onTransferProgress } from "../electroview";
import type { Device, SharedContent } from "../lib/types";
import type { TransferProgress as UiTransferProgress } from "../lib/file-transfer";

interface TcpTransferProgress {
  transferId: string;
  fileName: string;
  totalBytes: number;
  receivedBytes: number;
  progress: number;
}

export interface ReceivedMessage {
  id: string;
  from: string;
  fromName: string;
  content: string;
  fileName: string;
  timestamp: number;
  type: "text" | "file";
  fileSize?: number;
  fileUrl?: string;
  savePath?: string; // Absolute path on disk (set by Bun backend)
  mimeType?: string;
  downloadProgress?: number;
  isDownloading?: boolean;
}

export function useFileTransfer() {
  const [transfers, setTransfers] = useState<Map<string, TcpTransferProgress>>(new Map());
  const [isTransferring, setIsTransferring] = useState(false);
  const [receivedMessages, setReceivedMessages] = useState<ReceivedMessage[]>([]);
  const textTransferIds = useRef<Set<string>>(new Set());

  // Listen for incoming files
  useEffect(() => {
    const unsubscribe = onFileReceived(async (file) => {
      console.log("📥 File received:", file.fileName, "from", file.from);
      console.log("🔍 Frontend received fromName:", file.fromName);

      // Convert array back to Uint8Array
      const fileData = new Uint8Array(file.data);
      
      // Check if it's a text message (use flag from backend)
      if (file.isTextMessage) {
        // Track this id so the progress handler won't create a file toast for it
        textTransferIds.current.add(file.transferId);
        // Display as text message
        const textContent = new TextDecoder().decode(fileData);
        
        const message: ReceivedMessage = {
          id: file.transferId,
          from: file.from,
          fromName: file.fromName,
          content: textContent,
          fileName: file.fileName,
          timestamp: Date.now(),
          type: "text",
        };
        
        // Keep only last 20 messages to prevent memory buildup
        setReceivedMessages((prev) => [...prev, message].slice(-20));
        console.log("✓ Text message received:", textContent);
      } else {
        // Create blob URL for file (don't auto-download)
        const blob = new Blob([fileData], { type: file.mimeType });
        const url = URL.createObjectURL(blob);
        
        console.log("✓ File received:", file.fileName);
        
        // Update existing message or create new one
        setReceivedMessages((prev) => {
          const existingIndex = prev.findIndex((msg) => msg.id === file.transferId);
          
          if (existingIndex !== -1) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              from: file.from,
              fromName: file.fromName,
              fileUrl: url,
              savePath: file.savePath,
              mimeType: file.mimeType,
              downloadProgress: 100,
              isDownloading: false,
            };
            return updated;
          } else {
            const message: ReceivedMessage = {
              id: file.transferId,
              from: file.from,
              fromName: file.fromName,
              content: file.fileName,
              fileName: file.fileName,
              timestamp: Date.now(),
              type: "file",
              fileSize: file.fileSize,
              fileUrl: url,
              savePath: file.savePath,
              mimeType: file.mimeType,
              downloadProgress: 100,
              isDownloading: false,
            };
            return [...prev, message].slice(-20);
          }
        });
      }
    });

    return unsubscribe;
  }, []);

  // Listen for transfer progress
  useEffect(() => {
    const unsubscribe = onTransferProgress((progress) => {
      setTransfers((prev) => {
        const next = new Map(prev);
        next.set(progress.transferId, progress);
        return next;
      });
      
      // Update or create message for incoming files (but not text messages)
      // Text messages don't need progress tracking
      setReceivedMessages((prev) => {
        const existingMsg = prev.find((msg) => msg.id === progress.transferId);
        
        if (existingMsg) {
          // Update existing message
          return prev.map((msg) => 
            msg.id === progress.transferId
              ? { 
                  ...msg, 
                  downloadProgress: progress.progress,
                  isDownloading: progress.progress < 100 
                }
              : msg
          );
        } else {
          // Skip placeholder for text messages — they're handled in onFileReceived
          if (textTransferIds.current.has(progress.transferId)) {
            return prev;
          }
          // Create placeholder message for new file transfer
          const placeholderMsg: ReceivedMessage = {
            id: progress.transferId,
            from: "",
            fromName: "Unknown",
            content: progress.fileName,
            fileName: progress.fileName,
            timestamp: Date.now(),
            type: "file",
            fileSize: progress.totalBytes,
            downloadProgress: progress.progress,
            isDownloading: true,
          };
          return [...prev, placeholderMsg];
        }
      });
    });

    return unsubscribe;
  }, []);

  const sendFiles = useCallback(
    async (contents: SharedContent[], devices: Device[]) => {
      console.log(`🚀 sendFiles: ${contents.length} items → ${devices.length} device(s)`);
      setIsTransferring(true);

      // 2MB RPC chunk size — safe within Electrobun IPC limits
      const RPC_CHUNK_SIZE = 2 * 1024 * 1024;

      for (const device of devices) {
        for (const content of contents) {
          try {
            if (content.type === "file" || content.type === "image") {
              const file = content.data as File;
              console.log(`📤 ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB) → ${device.name}`);

              if (file.size > 5 * 1024 * 1024) {
                const transferId = `transfer_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                let offset = 0;
                let chunkIndex = 0;
                const totalChunks = Math.ceil(file.size / RPC_CHUNK_SIZE);

                while (offset < file.size) {
                  const end = Math.min(offset + RPC_CHUNK_SIZE, file.size);
                  const chunkData = await file.slice(offset, end).arrayBuffer();
                  const isFirst = chunkIndex === 0;
                  const isLast = end >= file.size;

                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  await (electroview.rpc as any).request.sendFileChunk({
                    transferId,
                    chunkData: Array.from(new Uint8Array(chunkData)),
                    isFirst,
                    isLast,
                    fileName: file.name,
                    totalSize: file.size,
                    mimeType: file.type,
                    recipientId: device.id,
                  });

                  offset = end;
                  chunkIndex++;
                  console.log(`🌊 Chunk ${chunkIndex}/${totalChunks}`);
                  // Yield to keep UI responsive
                  await new Promise((r) => setTimeout(r, 0));
                }
              } else {
                const fileData = await file.arrayBuffer();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (electroview.rpc as any).request.sendFile({
                  recipientId: device.id,
                  fileName: file.name,
                  fileData: Array.from(new Uint8Array(fileData)),
                  mimeType: file.type,
                });
              }

              console.log(`✓ Sent "${file.name}" to ${device.name}`);
            } else if (content.type === "text") {
              const textData = new TextEncoder().encode(content.data as string);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (electroview.rpc as any).request.sendFile({
                recipientId: device.id,
                fileName: content.name || "text.txt",
                fileData: Array.from(textData),
                mimeType: "text/plain",
                isTextMessage: true,
              });
              console.log(`✓ Sent text to ${device.name}`);
            }
          } catch (error) {
            console.error(`✗ Failed to send "${content.name}" to ${device.name}:`, error);
            // Mark this transfer as failed in state so UI can show error
            const failId = `fail_${Date.now()}`;
            setTransfers((prev) => {
              const next = new Map(prev);
              next.set(failId, {
                transferId: failId,
                fileName: content.name,
                totalBytes: (content.data instanceof File ? content.data.size : 0),
                receivedBytes: 0,
                progress: -1, // sentinel for failed
              });
              return next;
            });
          }
        }
      }

      console.log("✓ All transfers done");
      setIsTransferring(false);
    },
    []
  );

  const clearMessage = useCallback((id: string) => {
    setReceivedMessages((prev) => {
      const message = prev.find((m) => m.id === id);
      if (message?.fileUrl) {
        URL.revokeObjectURL(message.fileUrl);
      }
      return prev.filter((m) => m.id !== id);
    });
  }, []);

  const uiTransfers: UiTransferProgress[] = Array.from(transfers.values()).map((t) => ({
    transferId: t.transferId,
    fileName: t.fileName,
    totalBytes: t.totalBytes,
    sentBytes: t.receivedBytes,
    progress: Math.max(0, t.progress),
    status: t.progress < 0 ? "failed" : t.progress >= 100 ? "completed" : "transferring",
    error: t.progress < 0 ? "Transfer failed" : undefined,
  }));

  return {
    sendFiles,
    transfers: uiTransfers,
    isTransferring,
    receivedMessages,
    clearMessage,
  };
}
