export interface TransferProgress {
  transferId: string;
  fileName: string;
  totalBytes: number;
  sentBytes: number;
  progress: number;
  status: "transferring" | "completed" | "failed";
  error?: string;
}
