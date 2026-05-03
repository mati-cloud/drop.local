import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  MessageSquare,
  FileText,
  Download,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { ReceivedMessage } from "../../hooks/useFileTransfer-tcp";

interface MessageToastProps {
  messages: ReceivedMessage[];
  onDismiss: (messageId: string) => void;
}

function TextToast({
  message,
  onDismiss,
}: {
  message: ReceivedMessage;
  onDismiss: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(message.content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }, [message.content]);

  const isLong = message.content.length > 120;
  const preview = isLong && !expanded ? message.content.slice(0, 120) + "…" : message.content;

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-4 min-w-[300px] max-w-sm">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
          <MessageSquare className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-sm font-medium text-foreground">Message from {message.fromName}</p>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                title="Copy text"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => onDismiss(message.id)}
                className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div
            className={`font-mono text-xs text-muted-foreground break-words whitespace-pre-wrap ${expanded ? "max-h-48 overflow-y-auto" : ""}`}
          >
            {preview}
          </div>
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "collapse" : "expand"}
            </button>
          )}
          <p className="font-mono text-[10px] text-muted-foreground/60 mt-2">
            {new Date(message.timestamp).toLocaleTimeString()}
          </p>
        </div>
      </div>
    </div>
  );
}

function FileToast({
  message,
  onDismiss,
}: {
  message: ReceivedMessage;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-4 min-w-[300px] max-w-sm">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
          <FileText className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-sm font-medium text-foreground">File from {message.fromName}</p>
            <button
              onClick={() => onDismiss(message.id)}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded border border-border mb-2">
            <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{message.fileName}</p>
              {message.fileSize !== undefined && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {message.fileSize < 1024
                    ? `${message.fileSize} B`
                    : message.fileSize < 1024 * 1024
                      ? `${(message.fileSize / 1024).toFixed(1)} KB`
                      : `${(message.fileSize / 1024 / 1024).toFixed(1)} MB`}
                </p>
              )}
            </div>
          </div>
          {message.isDownloading && message.downloadProgress !== undefined && (
            <div className="space-y-1 mb-2">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-muted-foreground">receiving</span>
                <span className="text-foreground">{message.downloadProgress}%</span>
              </div>
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-foreground transition-all duration-300 ease-out"
                  style={{ width: `${message.downloadProgress}%` }}
                />
              </div>
            </div>
          )}
          {!message.isDownloading && (
            <div className="space-y-1.5">
              {message.savePath ? (
                <p
                  className="font-mono text-[10px] text-muted-foreground truncate"
                  title={message.savePath}
                >
                  saved · {message.savePath.replace(/.*\/drop\.local\//, "~/Downloads/drop.local/")}
                </p>
              ) : message.fileUrl ? (
                <div className="flex gap-2">
                  <a
                    href={message.fileUrl}
                    download={message.fileName}
                    className="flex items-center gap-1 px-3 py-1.5 font-mono text-xs bg-foreground text-background rounded hover:opacity-80 transition-opacity"
                  >
                    <Download className="w-3 h-3" />
                    download
                  </a>
                  <a
                    href={message.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-3 py-1.5 font-mono text-xs bg-muted text-foreground rounded hover:bg-accent transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    preview
                  </a>
                </div>
              ) : null}
            </div>
          )}
          <p className="font-mono text-[10px] text-muted-foreground/60 mt-2">
            {new Date(message.timestamp).toLocaleTimeString()}
          </p>
        </div>
      </div>
    </div>
  );
}

export function MessageToast({ messages, onDismiss }: MessageToastProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <AnimatePresence>
        {messages.map((message) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            {message.type === "text" ? (
              <TextToast message={message} onDismiss={onDismiss} />
            ) : (
              <FileToast message={message} onDismiss={onDismiss} />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
