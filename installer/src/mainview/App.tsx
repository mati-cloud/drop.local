import { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowRight, Check, HardDrive, Lock, Shield, Wifi, X, Zap } from "lucide-react";
import { electroview, onStatus } from "./electroview";
import type { StatusEvent } from "./electroview";

type Phase =
  | "idle"
  | "detecting"
  | "fetching-release"
  | "downloading"
  | "extracting"
  | "installing"
  | "benchmarking"
  | "benchmark-ready"
  | "launching"
  | "done"
  | "error";

type Step = "welcome" | "installing" | "benchmark" | "finish";

const STEP_ORDER: Step[] = ["welcome", "installing", "benchmark", "finish"];

interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
}

interface AppInfo {
  installerVersion: string;
  repo: string;
  udpPort: number;
  tcpPort: number;
}

const CHUNK_LABEL: Record<number, string> = {
  1: "HDD / slow storage",
  4: "SATA SSD",
  8: "NVMe SSD",
};

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
  const order = STEP_ORDER;
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
          Step 01 / 04 · Welcome
        </span>
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
      "installing to applications",
      "benchmarking disk · tuning transfer speed",
      "launching drop.local",
    ],
    []
  );

  const activePhases: Phase[] = [
    "detecting",
    "fetching-release",
    "downloading",
    "installing",
    "benchmarking",
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
    installing: "installing to applications",
    launching: "launching drop.local",
    benchmarking: "benchmarking disk · tuning transfer speed",
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
          Step 02 / 04 · Installing
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

function BenchmarkStep({
  diskReadMBps,
  diskWriteMBps,
  chunkSizeMB,
  onContinue,
}: {
  diskReadMBps: number | null;
  diskWriteMBps: number | null;
  chunkSizeMB: number | null;
  onContinue: () => void;
}) {
  return (
    <div className="px-8 pt-8 pb-7">
      <div className="flex items-center justify-between mb-7">
        <Brand />
        <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
          Step 03 / 04 · Performance
        </span>
      </div>

      <div className="flex items-start gap-5">
        <div className="h-12 w-12 rounded-full border border-border flex items-center justify-center shrink-0">
          <Zap className="h-5 w-5 text-foreground" strokeWidth={2} />
        </div>
        <div>
          <h2 className="text-[26px] leading-[1.1] font-medium tracking-tight">
            Your machine is tuned.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-[420px]">
            drop.local benchmarked your storage. Chunk size adapts per-transfer based on both sender and receiver speeds.
          </p>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-2">
        <Stat
          label="Disk read"
          value={diskReadMBps !== null ? `${diskReadMBps} MB/s` : "—"}
        />
        <Stat
          label="Disk write"
          value={diskWriteMBps !== null ? `${diskWriteMBps} MB/s` : "—"}
        />
        <Stat
          label="Default chunk"
          value={chunkSizeMB !== null ? `${chunkSizeMB} MB` : "4 MB"}
        />
        {chunkSizeMB !== null && CHUNK_LABEL[chunkSizeMB] && (
          <Stat label="Storage class" value={CHUNK_LABEL[chunkSizeMB] ?? "—"} />
        )}
      </div>

      <div className="mt-7 flex items-center justify-end">
        <button
          onClick={onContinue}
          className="group inline-flex items-center gap-2 h-10 pl-5 pr-4 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition"
        >
          Launch drop.local
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

function FinishStep({
  sysInfo,
  releaseVersion,
  appInfo,
}: {
  sysInfo: SystemInfo | null;
  releaseVersion: string | null;
  appInfo: AppInfo | null;
}) {
  return (
    <div className="px-8 pt-8 pb-7">
      <div className="flex items-center justify-between mb-7">
        <Brand />
        <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
          Step 04 / 04 · Ready
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
        <Stat
          label="Platform"
          value={sysInfo ? `${PLATFORM_LABELS[sysInfo.platform] ?? sysInfo.platform} · ${sysInfo.arch}` : "—"}
        />
        <Stat label="Version" value={releaseVersion ?? "—"} />
        <Stat label="UDP port" value={appInfo ? `:${appInfo.udpPort}` : ":50002"} />
        <Stat label="TCP port" value={appInfo ? `:${appInfo.tcpPort}` : ":50004"} />
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
  const [releaseVersion, setReleaseVersion] = useState<string | null>(null);
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diskReadMBps, setDiskReadMBps] = useState<number | null>(null);
  const [diskWriteMBps, setDiskWriteMBps] = useState<number | null>(null);
  const [chunkSizeMB, setChunkSizeMB] = useState<number | null>(null);

  const step: Step =
    phase === "done" || phase === "launching"
      ? "finish"
      : phase === "benchmark-ready"
        ? "benchmark"
        : phase === "idle"
          ? "welcome"
          : "installing";

  useEffect(() => {
    const unsub = onStatus((event: StatusEvent) => {
      setPhase(event.type as Phase);
      if (event.type === "downloading") {
        setProgress(event.progress ?? 0);
        setDownloaded(event.downloaded ?? 0);
        setTotal(event.total ?? 0);
      }
      if (event.version) setReleaseVersion(event.version);
      if (event.diskReadMBps !== undefined) setDiskReadMBps(event.diskReadMBps);
      if (event.diskWriteMBps !== undefined) setDiskWriteMBps(event.diskWriteMBps);
      if (event.chunkSizeMB !== undefined) setChunkSizeMB(event.chunkSizeMB);
      if (event.type === "error") setError(event.message ?? "Unknown error");
    });

    if (electroview?.rpc?.request) {
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      const rpc = (electroview.rpc as any).request;
      rpc.getSystemInfo().then((info: SystemInfo) => setSysInfo(info)).catch(() => {});
      rpc.getAppInfo().then((info: AppInfo) => setAppInfo(info)).catch(() => {});
    }

    return unsub;
  }, []);

  const acknowledgeBenchmark = useCallback(async () => {
    try {
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      await (electroview.rpc as any).request.acknowledgeBenchmark();
    } catch {
      // ignore
    }
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
    <div className="h-screen w-full bg-background select-none flex flex-col">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Title bar — draggable, no native chrome */}
        <div className="electrobun-webkit-app-region-drag flex items-center justify-between h-9 px-3 border-b border-border bg-secondary/40">
          <div className="electrobun-webkit-app-region-no-drag flex items-center gap-2">
            <button
              onClick={() => {
                // oxlint-disable-next-line @typescript-eslint/no-explicit-any
                void (electroview.rpc as any).request.closeWindow();
              }}
              className="h-3 w-3 rounded-full bg-[#ff5f57] flex items-center justify-center group"
            >
              <X className="h-2 w-2 text-black/40 opacity-0 group-hover:opacity-100" strokeWidth={3} />
            </button>
            <span className="h-3 w-3 rounded-full bg-[#febc2e] opacity-40" />
            <span className="h-3 w-3 rounded-full bg-[#28c840] opacity-40" />
          </div>
          <div className="text-[11px] tracking-wide text-muted-foreground font-mono">
            drop.local · installer
          </div>
          <div className="w-12" />
        </div>

        {/* Body */}
        <div className="relative flex-1 bg-card">
          {step === "welcome" && (
            <WelcomeStep onNext={startInstall} sysInfo={sysInfo} version={appInfo?.installerVersion ?? null} />
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
          {step === "benchmark" && (
            <BenchmarkStep
              diskReadMBps={diskReadMBps}
              diskWriteMBps={diskWriteMBps}
              chunkSizeMB={chunkSizeMB}
              onContinue={acknowledgeBenchmark}
            />
          )}
          {step === "finish" && <FinishStep sysInfo={sysInfo} releaseVersion={releaseVersion} appInfo={appInfo} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 h-10 border-t border-border bg-secondary/30">
          <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
              {appInfo?.installerVersion ?? "v1.0"}
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
