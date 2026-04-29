import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageSquare, FileText, Download, ExternalLink } from "lucide-react";
import type { ReceivedMessage } from "../../hooks/useFileTransfer-tcp";

interface MessageToastProps {
  messages: ReceivedMessage[];
  onDismiss: (messageId: string) => void;
}

export function MessageToast({ messages, onDismiss }: MessageToastProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md max-h-[80vh] overflow-y-auto pr-2">
      <AnimatePresence>
        {messages.map((message) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 50, scale: 0.3 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
            className="bg-card border border-border rounded-lg shadow-lg p-4 min-w-[300px]"
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                {message.type === "file" ? (
                  <FileText className="w-5 h-5 text-primary" />
                ) : (
                  <MessageSquare className="w-5 h-5 text-primary" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-foreground">
                    {message.type === "file"
                      ? `File from ${message.fromName}`
                      : `Message from ${message.fromName}`}
                  </p>
                  <button
                    onClick={() => onDismiss(message.id)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {message.type === "file" ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded border border-border">
                      <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {message.fileName}
                        </p>
                        {message.fileSize && (
                          <p className="text-xs text-muted-foreground">
                            {(message.fileSize / 1024).toFixed(1)} KB
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Progress bar */}
                    {message.isDownloading && message.downloadProgress !== undefined && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Downloading...</span>
                          <span className="text-primary font-medium">
                            {message.downloadProgress}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all duration-300 ease-out"
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
                            Saved to{" "}
                            {message.savePath.replace(
                              /.*\/drop\.local\//,
                              "~/Downloads/drop.local/",
                            )}
                          </p>
                        ) : message.fileUrl ? (
                          <div className="flex gap-2">
                            <a
                              href={message.fileUrl}
                              download={message.fileName}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                            >
                              <Download className="w-3 h-3" />
                              Download
                            </a>
                            <a
                              href={message.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Preview
                            </a>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">
                    {message.content}
                  </p>
                )}

                <p className="text-xs text-muted-foreground mt-2">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
