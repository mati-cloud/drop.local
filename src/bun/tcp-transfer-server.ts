/**
 * Direct TCP File Transfer Server for LAN-only transfers
 * No WebRTC, no STUN, no ICE - just simple TCP connections
 */

import { createServer, connect, type Server, type Socket } from "net";
import { randomBytes } from "crypto";
import os from "os";
import path from "path";
import { readFile } from "fs/promises";
import { deriveTransferKey, encryptChunk, EncryptedFrameDecoder } from "./crypto";

const TRANSFER_PORT = 50004;
const LOG_INTERVAL_BYTES = 10 * 1024 * 1024; // log every 10MB

// ── Adaptive chunk size based on disk benchmark from installer ────────────────

let CHUNK_SIZE = 4 * 1024 * 1024; // default: 4 MB
let LOCAL_DISK_READ_MBPS = 500;
let LOCAL_DISK_WRITE_MBPS = 200;

function perfConfigPath(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "drop-local", "perf.json");
    case "linux":
      return path.join(
        process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"),
        "drop-local",
        "perf.json",
      );
    default:
      return path.join(
        process.env["APPDATA"] ?? path.join(os.homedir(), "AppData", "Roaming"),
        "drop-local",
        "perf.json",
      );
  }
}

/**
 * Pick chunk size from sender read speed and receiver write speed.
 * The network link is typically the real ceiling on LAN, so we cap at
 * practical per-RTT window sizes: 1/4/8/16 MB tiers.
 */
function selectChunkSize(senderReadMBps: number, receiverWriteMBps: number): number {
  const bottleneck = Math.min(senderReadMBps, receiverWriteMBps);
  if (bottleneck < 200) return 1 * 1024 * 1024; // HDD / slow USB
  if (bottleneck < 800) return 4 * 1024 * 1024; // SATA SSD
  if (bottleneck < 3000) return 8 * 1024 * 1024; // NVMe (normal)
  return 16 * 1024 * 1024; // NVMe (high-end, e.g. 6–7 GB/s)
}

export async function loadChunkSize(): Promise<void> {
  try {
    const raw = await readFile(perfConfigPath(), "utf-8");
    const perf = JSON.parse(raw) as { diskReadMBps: number; diskWriteMBps?: number };
    LOCAL_DISK_READ_MBPS = perf.diskReadMBps;
    LOCAL_DISK_WRITE_MBPS = perf.diskWriteMBps ?? 200;
    CHUNK_SIZE = selectChunkSize(LOCAL_DISK_READ_MBPS, LOCAL_DISK_WRITE_MBPS);
    console.log(
      `✓ Chunk size: ${CHUNK_SIZE / 1024 / 1024} MB (read: ${LOCAL_DISK_READ_MBPS} MB/s, write: ${LOCAL_DISK_WRITE_MBPS} MB/s)`,
    );
  } catch {
    console.log(`• perf.json not found — using default 4 MB chunk size`);
  }
}

export interface TransferMetadata {
  transferId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  from: string;
  isTextMessage?: boolean;
  senderPublicKey?: string;
  /** Sender's disk read speed so receiver can include it in chunk-size negotiation */
  senderDiskReadMBps?: number;
}

export interface TransferProgress {
  transferId: string;
  fileName: string;
  totalBytes: number;
  receivedBytes: number;
  progress: number;
  isTextMessage?: boolean;
}

interface StreamingTransfer {
  socket: Socket;
  transferId: string;
  fileName: string;
  totalSize: number;
  sentBytes: number;
  progressBuffer: string;
  resolveFinish: (() => void) | null;
  rejectFinish: ((err: Error) => void) | null;
  /** Negotiated chunk size, updated after receiver sends its write speed in first ack */
  chunkSize: number;
  perfNegotiated: boolean;
}

export class TcpTransferServer {
  private server: Server | null = null;
  private onTransferCallback: ((metadata: TransferMetadata, data: Buffer) => void) | null = null;
  private onProgressCallback: ((progress: TransferProgress) => void) | null = null;
  private activeStreams = new Map<string, StreamingTransfer>();
  private activeStreamKeys = new Map<string, Buffer>(); // transferId → AES key
  /** Must be set before any send calls. Injected from device-discovery keypair. */
  localPrivateKey: Buffer | null = null;
  /** Hex-encoded local P-256 public key for inclusion in transfer metadata. */
  localPublicKeyHex: string | null = null;
  private peerPublicKeys = new Map<string, string>(); // recipientIp → hex public key

  /** Register a peer's public key so transfers to them are encrypted. */
  setPeerPublicKey(ip: string, hexPublicKey: string): void {
    this.peerPublicKeys.set(ip, hexPublicKey);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.handleIncomingConnection(socket));
      this.server.on("error", (err) => {
        console.error("TCP transfer server error:", err);
        reject(err);
      });
      this.server.listen(TRANSFER_PORT, "0.0.0.0", () => {
        console.log(`✓ TCP transfer server listening on port ${TRANSFER_PORT}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        console.log("TCP transfer server stopped");
        resolve();
      });
    });
  }

  onTransfer(callback: (metadata: TransferMetadata, data: Buffer) => void): void {
    this.onTransferCallback = callback;
  }

  onProgress(callback: (progress: TransferProgress) => void): void {
    this.onProgressCallback = callback;
  }

  private handleIncomingConnection(socket: Socket): void {
    console.log(`📥 Incoming connection from ${socket.remoteAddress}`);

    let metadata: TransferMetadata | null = null;
    const receivedData: Buffer[] = [];
    let receivedBytes = 0;
    let expectedBytes = 0;
    let metadataReceived = false;
    let transferComplete = false;
    let decoder: EncryptedFrameDecoder | null = null;
    // Buffer for partial metadata line across chunks
    let headerBuf = "";

    socket.on("data", (raw) => {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

      if (!metadataReceived) {
        headerBuf += buf.toString("utf-8");
        const nl = headerBuf.indexOf("\n");
        if (nl === -1) return; // still accumulating header

        try {
          metadata = JSON.parse(headerBuf.substring(0, nl)) as TransferMetadata;
          expectedBytes = metadata.fileSize;
          metadataReceived = true;
          console.log(
            `📦 Receiving: ${metadata.fileName} (${expectedBytes} bytes) from ${metadata.from}`,
          );

          // Set up decryption if sender provided a public key and we have our private key
          if (metadata.senderPublicKey && this.localPrivateKey) {
            const key = deriveTransferKey(
              this.localPrivateKey,
              metadata.senderPublicKey,
              metadata.transferId,
            );
            decoder = new EncryptedFrameDecoder(key);
            console.log(`🔒 E2E decryption active for transfer ${metadata.transferId}`);
          }

          // Bytes that arrived in the same TCP chunk after the newline
          const headerByteLen = Buffer.byteLength(headerBuf.substring(0, nl + 1));
          const remainder = buf.slice(headerByteLen);
          if (remainder.length > 0) {
            if (decoder) {
              const chunks = decoder.push(remainder);
              for (const c of chunks) {
                receivedData.push(c);
                receivedBytes += c.length;
              }
            } else {
              receivedData.push(remainder);
              receivedBytes += remainder.length;
            }
          }
        } catch (error) {
          console.error("Failed to parse metadata:", error);
          socket.destroy();
          return;
        }
      } else {
        if (decoder) {
          const chunks = decoder.push(buf);
          for (const c of chunks) {
            receivedData.push(c);
            receivedBytes += c.length;
          }
        } else {
          receivedData.push(buf);
          receivedBytes += buf.length;
        }

        if (receivedBytes % LOG_INTERVAL_BYTES < buf.length) {
          console.log(
            `📦 ${(receivedBytes / 1024 / 1024).toFixed(1)}MB / ${(expectedBytes / 1024 / 1024).toFixed(1)}MB`,
          );
        }
      }

      if (!metadataReceived || !metadata) return;

      const progress = Math.min(100, Math.floor((receivedBytes / expectedBytes) * 100));

      // Always report progress to frontend
      this.onProgressCallback?.({
        transferId: metadata.transferId,
        fileName: metadata.fileName,
        totalBytes: expectedBytes,
        receivedBytes,
        progress,
        isTextMessage: metadata.isTextMessage,
      });

      // Ack progress back to sender — always include local write speed so sender can negotiate chunk size
      socket.write(
        JSON.stringify({
          type: "progress",
          transferId: metadata.transferId,
          receivedBytes,
          totalBytes: expectedBytes,
          progress,
          receiverDiskWriteMBps: LOCAL_DISK_WRITE_MBPS,
        }) + "\n",
      );

      if (!transferComplete && receivedBytes >= expectedBytes) {
        transferComplete = true;
        console.log(
          `✓ Transfer complete: ${metadata.fileName} (${receivedBytes}/${expectedBytes} bytes)`,
        );
        this.onTransferCallback?.(metadata, Buffer.concat(receivedData));
        // Sender will close the socket upon receiving the 100% ack above
      }
    });

    socket.on("error", (err) => {
      console.error("Socket error:", err);
      if (metadataReceived && !transferComplete) {
        console.warn(
          `⚠️ Transfer interrupted: ${metadata?.fileName} (${receivedBytes}/${expectedBytes} bytes)`,
        );
      }
    });

    socket.on("close", () => {
      if (metadataReceived && !transferComplete) {
        console.warn(
          `⚠️ Connection closed before transfer complete: ${metadata?.fileName} (${receivedBytes}/${expectedBytes} bytes)`,
        );
      }
    });
  }

  /**
   * Open a persistent TCP connection for a large streaming transfer.
   * Metadata is sent immediately; chunks are written via writeChunk().
   * Progress updates from the receiver drive the sender's UI in real-time.
   */
  async startStreamingTransfer(
    transferId: string,
    recipientIp: string,
    fileName: string,
    totalSize: number,
    mimeType: string,
    fromDeviceId: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`🌊 Opening streaming connection to ${recipientIp}:${TRANSFER_PORT}`);

      const socket = connect(TRANSFER_PORT, recipientIp, () => {
        console.log(`✓ Streaming connection established for ${fileName}`);

        const peerPubKey = this.peerPublicKeys.get(recipientIp);
        let senderPublicKey: string | undefined;
        if (this.localPrivateKey && this.localPublicKeyHex && peerPubKey) {
          this.activeStreamKeys.set(
            transferId,
            deriveTransferKey(this.localPrivateKey, peerPubKey, transferId),
          );
          senderPublicKey = this.localPublicKeyHex;
          console.log(`🔒 E2E encrypting streaming transfer to ${recipientIp}`);
        }

        const metadata: TransferMetadata = {
          transferId,
          fileName,
          fileSize: totalSize,
          mimeType,
          from: fromDeviceId,
          isTextMessage: false,
          senderPublicKey,
          senderDiskReadMBps: LOCAL_DISK_READ_MBPS,
        };
        socket.write(JSON.stringify(metadata) + "\n");

        const stream: StreamingTransfer = {
          socket,
          transferId,
          fileName,
          totalSize,
          sentBytes: 0,
          progressBuffer: "",
          resolveFinish: null,
          rejectFinish: null,
          chunkSize: CHUNK_SIZE,
          perfNegotiated: false,
        };
        this.activeStreams.set(transferId, stream);

        // Listen for progress acks from receiver
        socket.on("data", (chunk) => {
          stream.progressBuffer += chunk.toString();
          const lines = stream.progressBuffer.split("\n");
          stream.progressBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const update = JSON.parse(line);
              if (update.type !== "progress" || update.transferId !== transferId) continue;

              // First ack with receiver write speed — negotiate chunk size
              if (!stream.perfNegotiated && update.receiverDiskWriteMBps) {
                stream.chunkSize = selectChunkSize(
                  LOCAL_DISK_READ_MBPS,
                  update.receiverDiskWriteMBps,
                );
                stream.perfNegotiated = true;
                console.log(
                  `⚙️ Negotiated chunk: ${stream.chunkSize / 1024 / 1024} MB ` +
                    `(sender read: ${LOCAL_DISK_READ_MBPS} MB/s, receiver write: ${update.receiverDiskWriteMBps} MB/s)`,
                );
              }

              this.onProgressCallback?.({
                transferId,
                fileName,
                totalBytes: totalSize,
                receivedBytes: update.receivedBytes,
                progress: update.progress,
              });

              if (update.progress >= 100 && stream.resolveFinish) {
                console.log(`✓ Streaming transfer confirmed complete: ${fileName}`);
                socket.end(() => {
                  this.activeStreams.delete(transferId);
                  this.activeStreamKeys.delete(transferId);
                  stream.resolveFinish?.();
                });
              }
            } catch {
              // partial JSON — ignore
            }
          }
        });

        resolve();
      });

      socket.on("error", (err) => {
        console.error(`Streaming connection error for ${fileName}:`, err);
        const stream = this.activeStreams.get(transferId);
        this.activeStreams.delete(transferId);
        stream?.rejectFinish?.(err);
        reject(err);
      });

      socket.on("close", () => {
        if (this.activeStreams.has(transferId)) {
          const stream = this.activeStreams.get(transferId)!;
          console.warn(`⚠️ Connection dropped before transfer complete: ${fileName}`);
          this.activeStreams.delete(transferId);
          stream.rejectFinish?.(new Error("Connection closed before transfer complete"));
        }
      });
    });
  }

  /**
   * Return the negotiated chunk size for a streaming transfer.
   * The value is updated after the first ack from the receiver arrives.
   * Use this to decide how large the next chunk slice should be.
   */
  getStreamChunkSize(transferId: string): number {
    return this.activeStreams.get(transferId)?.chunkSize ?? CHUNK_SIZE;
  }

  /**
   * Write one chunk directly to the open TCP socket with backpressure handling.
   * Chunk is AES-256-GCM encrypted if a key exists for this transfer.
   */
  async writeChunk(transferId: string, chunk: Buffer): Promise<void> {
    const stream = this.activeStreams.get(transferId);
    if (!stream) throw new Error(`No active stream for transfer ${transferId}`);

    const encKey = this.activeStreamKeys.get(transferId);
    const payload = encKey ? encryptChunk(encKey, chunk) : chunk;

    return new Promise((resolve, reject) => {
      const canContinue = stream.socket.write(payload, (err) => {
        if (err) reject(err);
      });
      stream.sentBytes += chunk.length;

      if (stream.sentBytes % LOG_INTERVAL_BYTES < chunk.length) {
        console.log(
          `🌊 ${(stream.sentBytes / 1024 / 1024).toFixed(1)}MB / ${(stream.totalSize / 1024 / 1024).toFixed(1)}MB`,
        );
      }

      if (canContinue) {
        resolve();
      } else {
        stream.socket.once("drain", resolve);
      }
    });
  }

  /**
   * Signal that all chunks have been written.
   * Returns a promise that resolves when the receiver confirms 100% receipt.
   */
  async finishStreamingTransfer(transferId: string): Promise<void> {
    const stream = this.activeStreams.get(transferId);
    if (!stream) throw new Error(`No active stream for transfer ${transferId}`);

    console.log(
      `✓ All chunks sent: ${stream.fileName} (${stream.sentBytes} bytes) — awaiting receiver ack`,
    );

    return new Promise((resolve, reject) => {
      stream.resolveFinish = resolve;
      stream.rejectFinish = reject;
    });
  }

  /**
   * Send a small file or text message via a single TCP connection.
   * For files >5MB prefer the startStreamingTransfer / writeChunk / finishStreamingTransfer path.
   */
  async sendFile(
    recipientIp: string,
    fileName: string,
    fileData: Buffer,
    mimeType: string,
    fromDeviceId: string,
    isTextMessage?: boolean,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const transferId = randomBytes(16).toString("hex");
      console.log(
        `📤 Connecting to ${recipientIp}:${TRANSFER_PORT} for ${fileName} (${fileData.length} bytes)`,
      );

      const socket = connect(TRANSFER_PORT, recipientIp, () => {
        console.log(`✓ Connected to ${recipientIp}`);

        const peerPubKey = this.peerPublicKeys.get(recipientIp);
        let encKey: Buffer | null = null;
        let senderPublicKey: string | undefined;
        if (this.localPrivateKey && this.localPublicKeyHex && peerPubKey) {
          encKey = deriveTransferKey(this.localPrivateKey, peerPubKey, transferId);
          senderPublicKey = this.localPublicKeyHex;
          console.log(`🔒 E2E encrypting transfer to ${recipientIp}`);
        }

        // Pre-compute all encrypted chunks so we know exact wire size for the metadata header
        const chunks: Buffer[] = [];
        if (encKey) {
          let off = 0;
          while (off < fileData.length) {
            const plain = fileData.slice(off, Math.min(off + CHUNK_SIZE, fileData.length));
            chunks.push(encryptChunk(encKey, plain));
            off += plain.length;
          }
        } else {
          let off = 0;
          while (off < fileData.length) {
            chunks.push(fileData.slice(off, Math.min(off + CHUNK_SIZE, fileData.length)));
            off += CHUNK_SIZE;
          }
        }
        const metadata: TransferMetadata = {
          transferId,
          fileName,
          fileSize: fileData.length,
          mimeType,
          from: fromDeviceId,
          isTextMessage,
          senderPublicKey,
        };
        socket.write(JSON.stringify(metadata) + "\n");

        let chunkIndex = 0;
        const sendNextChunk = () => {
          if (chunkIndex >= chunks.length) return; // wait for 100% ack to resolve

          const chunk = chunks[chunkIndex++];
          const canContinue = socket.write(chunk);
          // sentBytes tracking not needed — wire size already in metadata

          if (canContinue) {
            setImmediate(sendNextChunk);
          } else {
            socket.once("drain", sendNextChunk);
          }
        };

        sendNextChunk();
      });

      let progressBuffer = "";
      socket.on("data", (raw) => {
        progressBuffer += raw.toString();
        const lines = progressBuffer.split("\n");
        progressBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const update = JSON.parse(line);
            if (
              update.type === "progress" &&
              update.transferId === transferId &&
              update.progress >= 100
            ) {
              console.log(`✓ Transfer confirmed: ${fileName}`);
              socket.end();
              resolve();
            }
          } catch {
            // partial line — ignore
          }
        }
      });

      socket.on("error", (err) => {
        console.error(`Failed to send to ${recipientIp}:`, err);
        reject(err);
      });
    });
  }
}

export const tcpTransferServer = new TcpTransferServer();
