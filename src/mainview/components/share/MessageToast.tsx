import { useState, useCallback, useEffect } from "react";
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
  FolderOpen,
  Maximize2,
} from "lucide-react";
import type { ReceivedMessage } from "../../hooks/useFileTransfer-tcp";
import { revealInFolder } from "../../electroview";

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

function formatFileSize(bytes?: number) {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FileToast({
  message,
  onDismiss,
}: {
  message: ReceivedMessage;
  onDismiss: (id: string) => void;
}) {
  const [enlarged, setEnlarged] = useState(false);
  const isImage = message.mimeType?.startsWith("image/");
  const isPdf = message.mimeType === "application/pdf";
  const canPreview = isImage || isPdf;

  useEffect(() => {
    if (!enlarged) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEnlarged(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enlarged]);

  const previewSrc = message.fileUrl ?? (message.savePath ? `file://${message.savePath}` : null);

  return (
    <>
      {/* Enlarged modal */}
      <AnimatePresence>
        {enlarged && previewSrc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setEnlarged(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 350, damping: 28 }}
              className="relative max-w-[90vw] max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setEnlarged(false)}
                className="absolute -right-3 -top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-background border border-border text-muted-foreground hover:text-foreground transition-colors shadow"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              {isImage ? (
                <img
                  src={previewSrc}
                  alt={message.fileName}
                  className="max-w-[88vw] max-h-[88vh] rounded-lg object-contain shadow-2xl"
                />
              ) : (
                <iframe
                  src={previewSrc}
                  className="w-[80vw] h-[85vh] rounded-lg shadow-2xl bg-white"
                  title={message.fileName}
                />
              )}
              <p className="mt-2 text-center font-mono text-[11px] text-white/60">
                {message.fileName}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-card border border-border rounded-lg shadow-lg overflow-hidden min-w-[300px] max-w-sm">
        {/* Image / PDF thumbnail */}
        {canPreview && previewSrc && !message.isDownloading && (
          <div className="relative group/thumb cursor-pointer" onClick={() => setEnlarged(true)}>
            {isImage ? (
              <img
                src={previewSrc}
                alt={message.fileName}
                className="w-full max-h-36 object-cover"
              />
            ) : (
              <div className="relative w-full h-28 bg-muted/40 flex items-center justify-center overflow-hidden">
                <iframe
                  src={previewSrc}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  title={message.fileName}
                />
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/thumb:bg-black/30 transition-colors">
              <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity drop-shadow" />
            </div>
          </div>
        )}

        <div className="p-4">
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

              <p className="truncate text-xs font-medium text-foreground mb-0.5">
                {message.fileName}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground mb-2">
                {formatFileSize(message.fileSize)}
              </p>

              {/* Progress bar while receiving */}
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

              {/* Actions after receive */}
              {!message.isDownloading && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {message.savePath && (
                    <button
                      onClick={() => revealInFolder(message.savePath!)}
                      className="flex items-center gap-1 px-2.5 py-1.5 font-mono text-[11px] bg-foreground text-background rounded hover:opacity-80 transition-opacity"
                    >
                      <FolderOpen className="w-3 h-3" />
                      show in folder
                    </button>
                  )}
                  {canPreview && previewSrc && (
                    <button
                      onClick={() => setEnlarged(true)}
                      className="flex items-center gap-1 px-2.5 py-1.5 font-mono text-[11px] bg-muted text-foreground rounded hover:bg-accent transition-colors"
                    >
                      <Maximize2 className="w-3 h-3" />
                      preview
                    </button>
                  )}
                  {!message.savePath && message.fileUrl && (
                    <a
                      href={message.fileUrl}
                      download={message.fileName}
                      className="flex items-center gap-1 px-2.5 py-1.5 font-mono text-[11px] bg-foreground text-background rounded hover:opacity-80 transition-opacity"
                    >
                      <Download className="w-3 h-3" />
                      download
                    </a>
                  )}
                  {!message.savePath && message.fileUrl && !canPreview && (
                    <a
                      href={message.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2.5 py-1.5 font-mono text-[11px] bg-muted text-foreground rounded hover:bg-accent transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      open
                    </a>
                  )}
                </div>
              )}

              <p className="font-mono text-[10px] text-muted-foreground/60 mt-2">
                {new Date(message.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
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
