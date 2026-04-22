import { useCallback, useState, useRef, type DragEvent } from "react";
import { Upload, FileText, Image, Type, Clipboard } from "lucide-react";
import type { SharedContent } from "@/lib/types";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

interface DropZoneProps {
  onContent: (content: SharedContent) => void;
}

export const DropZone = ({ onContent }: DropZoneProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      files.forEach((file) => {
        const isImage = file.type.startsWith("image/");
        onContent({
          type: isImage ? "image" : "file",
          name: file.name,
          size: file.size,
          data: file,
          preview: isImage ? URL.createObjectURL(file) : undefined,
        });
      });
    },
    [onContent]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            onContent({
              type: "image",
              name: "clipboard-image.png",
              size: file.size,
              data: file,
              preview: URL.createObjectURL(file),
            });
            return;
          }
        }
      }
      const text = e.clipboardData.getData("text");
      if (text) {
        onContent({
          type: "text",
          name: "clipboard-text",
          size: text.length,
          data: text,
        });
      }
    },
    [onContent]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      files.forEach((file) => {
        const isImage = file.type.startsWith("image/");
        onContent({
          type: isImage ? "image" : "file",
          name: file.name,
          size: file.size,
          data: file,
          preview: isImage ? URL.createObjectURL(file) : undefined,
        });
      });
    },
    [onContent]
  );

  const handleTextSubmit = useCallback(() => {
    if (pasteText.trim()) {
      onContent({
        type: "text",
        name: "text-content",
        size: pasteText.length,
        data: pasteText,
      });
    }
  }, [pasteText, onContent]);

  return (
    <div className="space-y-4">
      {/* Drop / Paste area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
        tabIndex={0}
        className={`group relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
          isDragging
            ? "border-foreground bg-accent scale-[1.01]"
            : "border-border bg-card hover:border-foreground/30 hover:bg-accent/50"
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />

        <Upload
          className={`mb-3 h-8 w-8 transition-all duration-300 ${
            isDragging
              ? "text-foreground scale-110"
              : "text-muted-foreground group-hover:text-foreground"
          }`}
          strokeWidth={1.5}
        />

        <p className="text-sm font-medium text-foreground">
          Drop files here or click to browse
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          or press{" "}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            {isMac ? "⌘V" : "Ctrl+V"}
          </kbd>{" "}
          to paste from clipboard
        </p>

        <div className="mt-5 flex items-center gap-4">
          {[
            { icon: FileText, label: "Files" },
            { icon: Image, label: "Images" },
            { icon: Type, label: "Text" },
            { icon: Clipboard, label: "Clipboard" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-1 text-muted-foreground/60"
            >
              <Icon className="h-3 w-3" strokeWidth={1.5} />
              <span className="font-mono text-[10px] uppercase tracking-wider">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Text input fallback */}
      <div className="relative">
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          onPaste={handlePaste}
          placeholder="Or type / paste text here..."
          className="h-24 w-full resize-none rounded-xl border border-border bg-card px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
        />
        {pasteText.trim() && (
          <button
            onClick={handleTextSubmit}
            className="absolute bottom-3 right-3 rounded-lg bg-foreground px-3 py-1.5 font-mono text-xs text-primary-foreground transition-opacity hover:opacity-80"
          >
            send →
          </button>
        )}
      </div>
    </div>
  );
};
