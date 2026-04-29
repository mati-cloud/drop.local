import {
  Laptop,
  Smartphone,
  Tablet,
  Monitor,
  ArrowLeft,
  X,
  FileText,
  Image as ImageIcon,
  Type,
  Plus,
  Check,
} from "lucide-react";
import type { SharedContent, Device } from "@/lib/types";

const DEVICE_ICONS = {
  laptop: Laptop,
  phone: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
};

interface DeviceSelectorProps {
  devices: Device[];
  contents: SharedContent[];
  selectedDevices: Device[];
  onSelect: (device: Device) => void;
  onBack: () => void;
  onRemoveContent: (index: number) => void;
  onAddFiles: () => void;
  onProceed: () => void;
}

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const DeviceSelector = ({
  devices,
  contents,
  selectedDevices,
  onSelect,
  onBack,
  onRemoveContent,
  onAddFiles,
  onProceed,
}: DeviceSelectorProps) => {
  const getContentIcon = (type: SharedContent["type"]) => {
    switch (type) {
      case "image":
        return ImageIcon;
      case "file":
        return FileText;
      case "text":
        return Type;
    }
  };

  const getContentLabel = (type: SharedContent["type"]) => {
    switch (type) {
      case "image":
        return "IMG";
      case "file":
        return "FIL";
      case "text":
        return "TXT";
    }
  };
  return (
    <div className="space-y-5">
      {/* Content preview - multiple files */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {contents.length} {contents.length === 1 ? "file" : "files"} selected
          </p>
          <button
            onClick={onBack}
            className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span className="font-mono text-[10px] uppercase tracking-wider">back</span>
          </button>
        </div>
        <div className="space-y-2">
          {contents.map((content, index) => {
            const Icon = getContentIcon(content.type);
            return (
              <div
                key={index}
                className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-border/80"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                  <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{content.name}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {content.type} {content.size ? `· ${formatBytes(content.size)}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => onRemoveContent(index)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            );
          })}
        </div>
        {/* Upload more files button */}
        <div className="flex justify-end">
          <button
            onClick={onAddFiles}
            className="flex w-fit items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 font-mono text-xs text-primary-foreground transition-opacity hover:opacity-80"
          >
            <Plus className="h-3 w-3" strokeWidth={1.5} />
            upload
          </button>
        </div>
      </div>

      {/* Device selection label */}
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Select target device{selectedDevices.length > 0 ? "s" : ""}
        {selectedDevices.length > 0 && (
          <span className="ml-2 text-foreground">({selectedDevices.length} selected)</span>
        )}
      </p>

      {/* Device list */}
      <div className="grid gap-2">
        {devices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">No devices discovered yet</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Make sure Drop Local is running on other devices
            </p>
          </div>
        ) : (
          devices.map((device) => {
            const Icon = DEVICE_ICONS[device.type];
            const isSelected = selectedDevices.some((d) => d.id === device.id);
            const isActive = device.isActive ?? false;
            const isMismatch = device.versionMismatch ?? false;
            const isDisabled = !isActive || isMismatch;

            return (
              <div
                key={device.id}
                className="relative"
                title={
                  isMismatch
                    ? `Version mismatch — peer is on v${device.version}, update required`
                    : undefined
                }
              >
                <button
                  onClick={() => !isDisabled && onSelect(device)}
                  disabled={isDisabled}
                  className={`group flex w-full items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition-all ${
                    isDisabled
                      ? "cursor-not-allowed border-border/50 bg-muted/30 opacity-60"
                      : isSelected
                        ? "border-foreground bg-accent active:scale-[0.99]"
                        : "border-border bg-card hover:border-foreground/30 hover:bg-accent active:scale-[0.99]"
                  }`}
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                      isDisabled
                        ? "bg-muted/50"
                        : isSelected
                          ? "bg-foreground"
                          : "bg-accent group-hover:bg-foreground"
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 transition-colors ${
                        isDisabled
                          ? "text-muted-foreground/50"
                          : isSelected
                            ? "text-primary-foreground"
                            : "text-foreground group-hover:text-primary-foreground"
                      }`}
                      strokeWidth={1.5}
                    />
                  </div>
                  <div className="flex-1">
                    <p
                      className={`text-sm font-medium ${!isDisabled ? "text-foreground" : "text-muted-foreground"}`}
                    >
                      {device.name}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {device.ip}
                      {!isActive && " · offline"}
                      {isMismatch && ` · v${device.version} — update required`}
                    </p>
                  </div>
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-colors ${
                      isDisabled
                        ? "border-muted-foreground/20"
                        : isSelected
                          ? "border-foreground bg-foreground"
                          : "border-muted-foreground/30 group-hover:border-foreground/50"
                    }`}
                  >
                    {isSelected && (
                      <Check className="h-3 w-3 text-primary-foreground" strokeWidth={2.5} />
                    )}
                  </div>
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Send button */}
      {selectedDevices.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={onProceed}
            className="w-fit rounded-xl bg-foreground px-5 py-3 font-mono text-sm text-primary-foreground transition-opacity hover:opacity-80"
          >
            Send to {selectedDevices.length} {selectedDevices.length === 1 ? "device" : "devices"} →
          </button>
        </div>
      )}
    </div>
  );
};
