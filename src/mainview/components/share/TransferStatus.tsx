import { useMemo } from "react";
import { motion } from "framer-motion";
import { Check, RotateCcw, AlertCircle } from "lucide-react";
import type { SharedContent, Device } from "@/lib/types";
import type { TransferProgress } from "../../lib/file-transfer";

interface TransferStatusProps {
  contents: SharedContent[];
  devices: Device[];
  onReset: () => void;
  transfers?: TransferProgress[];
  isTransferring?: boolean;
}

export const TransferStatus = ({
  contents,
  devices,
  onReset,
  transfers = [],
  isTransferring = false,
}: TransferStatusProps) => {
  const { progress, done, hasFailed } = useMemo(() => {
    const anyFailed = transfers.some((t) => t.status === "failed");

    // Sender side: transfers array stays empty (progress events come from receiver).
    // Trust isTransferring as the authoritative completion signal.
    if (transfers.length === 0) {
      return {
        progress: isTransferring ? 0 : 100,
        done: !isTransferring && !anyFailed,
        hasFailed: anyFailed,
      };
    }

    const allSettled = transfers.every((t) => t.status === "completed" || t.status === "failed");
    const valid = transfers.filter((t) => t.status !== "failed");
    const avg = valid.length > 0 ? valid.reduce((s, t) => s + t.progress, 0) / valid.length : 0;
    return { progress: avg, done: allSettled && !anyFailed, hasFailed: anyFailed };
  }, [transfers, isTransferring]);

  const failedTransfers = transfers.filter((t) => t.status === "failed");
  const iconBg = hasFailed ? "bg-destructive" : done ? "bg-green-500" : "bg-accent";

  return (
    <div className="flex flex-col items-center space-y-6">
      {/* Status icon */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`flex h-16 w-16 items-center justify-center rounded-full transition-colors duration-500 ${iconBg}`}
      >
        {hasFailed ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <AlertCircle className="h-7 w-7 text-destructive-foreground" strokeWidth={2} />
          </motion.div>
        ) : done ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <Check className="h-7 w-7 text-primary-foreground" strokeWidth={2} />
          </motion.div>
        ) : (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
            className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 border-t-foreground"
          />
        )}
      </motion.div>

      {/* Info */}
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">
          {hasFailed ? "Transfer failed" : done ? "Sent successfully" : "Sending..."}
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {contents.length} {contents.length === 1 ? "file" : "files"} →{" "}
          {devices.map((d) => d.name).join(", ")}
        </p>
      </div>

      {/* Failed file list */}
      {failedTransfers.length > 0 && (
        <div className="w-full max-w-xs space-y-1">
          {failedTransfers.map((t) => (
            <p key={t.transferId} className="font-mono text-[10px] text-destructive truncate">
              ✗ {t.fileName}
            </p>
          ))}
        </div>
      )}

      {/* Progress bar — only show while transferring or on success */}
      {!hasFailed && (
        <div className="w-full max-w-xs">
          <div className="h-1 w-full overflow-hidden rounded-full bg-accent">
            <motion.div
              className="h-full bg-foreground"
              initial={{ width: "0%" }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.1 }}
            />
          </div>
          <p className="mt-2 text-center font-mono text-[10px] text-muted-foreground">
            {Math.round(progress)}%
          </p>
        </div>
      )}

      {/* Reset button — show on completion or failure */}
      {(done || hasFailed) && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <button
            onClick={onReset}
            className="flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 font-mono text-xs text-primary-foreground transition-opacity hover:opacity-80"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
            {hasFailed ? "try again" : "share another"}
          </button>
        </motion.div>
      )}
    </div>
  );
};
