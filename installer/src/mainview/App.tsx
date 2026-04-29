import { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowRight, Check, HardDrive, Lock, Minus, Shield, Square, Wifi, X } from "lucide-react";
import { electroview, onStatus } from "./electroview";
import type { StatusEvent } from "./electroview";

type Phase =
  | "idle"
  | "detecting"
  | "fetching-release"
  | "downloading"
  | "extracting"
  | "installing"
  | "launching"
  | "done"
  | "error";

type Step = "welcome" | "installing" | "finish";

interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  mac: "macOS",
  linux: "Linux",
  win: "Windows",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-full bg-foreground" />
      <span className="text-[15px] font-medium tracking-tight">
        drop<span className="text-muted-foreground">.local</span>
      </span>
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  const order: Step[] = ["welcome", "installing", "finish"];
  const idx = order.indexOf(step);
  return (
    <div className="flex items-center gap-1.5">
      {order.map((s, i) => (
        <span
          key={s}
          className={`h-1.5 rounded-full transition-all ${
            i === idx ? "w-6 bg-foreground" : i < idx ? "w-1.5 bg-foreground" : "w-1.5 bg-border"
          }`}
        />
      ))}
    </div>
  );
}

function FeatureChip({ icon: Icon, label }: { icon: typeof Wifi; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-background">
      <Icon className="h-3.5 w-3.5 text-foreground" strokeWidth={1.75} />
      <span className="text-xs text-foreground">{label}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-md border border-border bg-background">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="text-xs font-mono text-foreground">{value}</span>
    </div>
  );
}

function WelcomeStep({
  onNext,
  sysInfo,
  version,
}: {
  onNext: () => void;
  sysInfo: SystemInfo | null;
  version: string | null;
}) {
  const platformLabel = sysInfo
    ? `${PLATFORM_LABELS[sysInfo.platform] ?? sysInfo.platform} · ${sysInfo.arch} (detected)`
    : "Detecting system…";

  return (
    <div className="px-8 pt-8 pb-7">
      <div className="flex items-center justify-between mb-7">
        <Brand />
        <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
          Step 01 / 03 · Welcome
        </span>
      </div>

      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border text-[10px] font-mono tracking-widest uppercase text-muted-foreground mb-5">
        <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
        {version ?? "v1.0"} · open source · agpl-3.0
      </div>

      <h1 className="text-[34px] leading-[1.05] font-medium tracking-tight">
        Install drop.local.
        <br />
        <span className="text-muted-foreground">No cloud. No accounts.</span>
      </h1>

      <p className="mt-4 text-sm text-muted-foreground max-w-[440px] leading-relaxed">
        A lightweight desktop app that moves files peer-to-peer across your local network.
        Nothing leaves your subnet.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2">
        <FeatureChip icon={Wifi} label="LAN only" />
        <FeatureChip icon={Lock} label="E2E encrypted" />
        <FeatureChip icon={HardDrive} label="No cloud" />
      </div>

      <div className="mt-7 flex items-center justify-between">
        <div className="text-[11px] font-mono text-muted-foreground">{platformLabel}</div>
        <button
          onClick={onNext}
          className="group inline-flex items-center gap-2 h-10 pl-5 pr-4 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition"
        >
          Install
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

function InstallingStep({
  phase,
  progress,
  downloaded,
  total,
  error,
  onRetry,
}: {
  phase: Phase;
  progress: number;
  downloaded: number;
  total: number;
  error: string | null;
  onRetry: () => void;
}) {
  const isError = phase === "error";

  const logLines = useMemo(
    () => [
      "detecting system · arch + platform",
      "fetching latest release · github api",
      "downloading release bundle",
      "extracting archive",
      "installing to applications",
      "launching drop.local",
    ],
    []
  );

  const activePhases: Phase[] = [
    "detecting",
    "fetching-release",
    "downloading",
    "extracting",
    "installing",
    "launching",
  ];
  const phaseIdx = activePhases.indexOf(phase);

  const barWidth = isError
    ? "100%"
    : phase === "downloading" && total > 0
      ? `${progress}%`
      : phaseIdx >= 0
        ? `${Math.round(((phaseIdx + 1) / activePhases.length) * 100)}%`
        : "0%";

  const phaseLabels: Partial<Record<Phase, string>> = {
    detecting: "detecting system · arch + platform",
    "fetching-release": "fetching latest release · github api",
    downloading: "downloading release bundle",
    extracting: "extracting archive",
    installing: "installing to applications",
    launching: "launching drop.local",
  };

  const downloadLabel =
    phase === "downloading" && total > 0
      ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
      : phaseLabels[phase] ?? "working…";

  return (
    <div className="px-8 pt-8 pb-7">
      <div className="flex items-center justify-between mb-7">
        <Brand />
        <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
          Step 02 / 03 · Installing
        </span>
      </div>

      <h2 className="text-[26px] leading-[1.1] font-medium tracking-tight">
        {isError ? "Something went wrong." : "Setting up your node."}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {isError
          ? "Check the log below and retry."
          : "Downloading and installing drop.local on this machine."}
      </p>

      <div className="mt-7">
        <div className="flex items-center justify-between mb-2 font-mono text-[11px] text-muted-foreground">
          <span>{downloadLabel}</span>
          <span className="text-foreground">
            {isError ? "failed" : phaseIdx >= 0 ? `${Math.round(((phaseIdx + 1) / activePhases.length) * 100)}%` : "0%"}
          </span>
        </div>
        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full transition-[width] duration-300 ease-linear rounded-full ${isError ? "bg-destructive" : "bg-foreground"}`}
            style={{ width: barWidth }}
          />
        </div>
      </div>

      <div className="mt-6 rounded-md border border-border bg-secondary/40 p-4 font-mono text-[11px] leading-relaxed h-[130px] overflow-hidden">
        {isError && error ? (
          <div className="text-destructive">{error}</div>
        ) : (
          logLines.slice(0, Math.max(1, phaseIdx + 1)).map((l, i) => (
            <div key={i} className="flex items-start gap-3 text-muted-foreground">
              <span className="text-foreground/40 w-6">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-foreground/40">·</span>
              <span className={i === phaseIdx ? "text-foreground" : ""}>{l}</span>
              {i < phaseIdx && (
                <Check className="h-3 w-3 text-foreground ml-auto mt-0.5" strokeWidth={2.5} />
              )}
            </div>
          ))
        )}
      </div>

      {isError && (
        <div className="mt-5 flex justify-end">
          <button
            onClick={onRetry}
            className="h-9 px-4 rounded-md border border-border text-sm hover:bg-secondary transition"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function FinishStep({ sysInfo, version }: { sysInfo: SystemInfo | null; version: string | null }) {
  return (
    <div className="px-8 pt-8 pb-7">
      <div className="flex items-center justify-between mb-7">
        <Brand />
        <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
          Step 03 / 03 · Ready
        </span>
      </div>

      <div className="flex items-start gap-5">
        <div className="h-12 w-12 rounded-full border border-border flex items-center justify-center shrink-0">
          <Check className="h-5 w-5 text-foreground" strokeWidth={2.25} />
        </div>
        <div>
          <h2 className="text-[26px] leading-[1.1] font-medium tracking-tight">
            Installed. You're on the network.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-[420px]">
            drop.local is launching now. Discover peers on the same Wi-Fi or wired network instantly.
          </p>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-2">
        <Stat label="Platform" value={sysInfo ? `${PLATFORM_LABELS[sysInfo.platform] ?? sysInfo.platform} · ${sysInfo.arch}` : "—"} />
        <Stat label="Version" value={version ?? "—"} />
        <Stat label="UDP port" value=":50002" />
        <Stat label="TCP port" value=":50004" />
      </div>

      <div className="mt-7 flex items-center justify-end">
        <div className="inline-flex items-center gap-2 h-10 pl-5 pr-4 rounded-md bg-foreground text-background text-sm font-medium">
          <Shield className="h-4 w-4" strokeWidth={2} />
          Launching drop.local…
        </div>
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [version, setVersion] = useState<string | null>(null);
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const step: Step =
    phase === "done" ? "finish" : phase === "idle" ? "welcome" : "installing";

  useEffect(() => {
    const unsub = onStatus((event: StatusEvent) => {
      setPhase(event.type as Phase);
      if (event.type === "downloading") {
        setProgress(event.progress ?? 0);
        setDownloaded(event.downloaded ?? 0);
        setTotal(event.total ?? 0);
      }
      if (event.version) setVersion(event.version);
      if (event.type === "error") setError(event.message ?? "Unknown error");
    });

    if (electroview?.rpc?.request) {
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      (electroview.rpc as any).request
        .getSystemInfo()
        .then((info: SystemInfo) => setSysInfo(info))
        .catch(() => {});
    }

    return unsub;
  }, []);

  const startInstall = useCallback(async () => {
    setPhase("detecting");
    setError(null);
    setProgress(0);
    try {
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      await (electroview.rpc as any).request.startInstall();
    } catch (err) {
      setPhase("error");
      setError(String(err));
    }
  }, []);

  return (
    <div className="min-h-screen w-full grid-bg flex items-center justify-center p-6 bg-background select-none">
      <div className="w-full max-w-[680px] rounded-xl border border-border bg-card shadow-[0_30px_80px_-20px_rgba(0,0,0,0.25)] overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center justify-between h-9 px-3 border-b border-border bg-secondary/40">
          <div className="flex items-center gap-2">
            <button className="h-3 w-3 rounded-full bg-[#ff5f57] flex items-center justify-center group">
              <X className="h-2 w-2 text-black/40 opacity-0 group-hover:opacity-100" strokeWidth={3} />
            </button>
            <button className="h-3 w-3 rounded-full bg-[#febc2e]">
              <Minus className="h-2 w-2 text-black/40 opacity-0" />
            </button>
            <button className="h-3 w-3 rounded-full bg-[#28c840]">
              <Square className="h-2 w-2 text-black/40 opacity-0" />
            </button>
          </div>
          <div className="text-[11px] tracking-wide text-muted-foreground font-mono">
            drop.local · installer
          </div>
          <div className="w-12" />
        </div>

        {/* Body */}
        <div className="relative">
          {step === "welcome" && (
            <WelcomeStep onNext={startInstall} sysInfo={sysInfo} version={version} />
          )}
          {step === "installing" && (
            <InstallingStep
              phase={phase}
              progress={progress}
              downloaded={downloaded}
              total={total}
              error={error}
              onRetry={startInstall}
            />
          )}
          {step === "finish" && <FinishStep sysInfo={sysInfo} version={version} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 h-10 border-t border-border bg-secondary/30">
          <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
              {version ?? "v1.0"}
            </span>
            <span>·</span>
            <span>AGPL-3.0</span>
          </div>
          <StepDots step={step} />
        </div>
      </div>
    </div>
  );
}
