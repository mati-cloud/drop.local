import { useState, useEffect, useCallback } from "react";
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

interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
}

const PHASE_LABELS: Record<Phase, string> = {
  idle: "Ready to install",
  detecting: "Detecting your system…",
  "fetching-release": "Fetching latest release…",
  downloading: "Downloading…",
  extracting: "Extracting…",
  installing: "Installing…",
  launching: "Launching drop.local…",
  done: "Installed successfully",
  error: "Something went wrong",
};

const PLATFORM_LABELS: Record<string, string> = {
  mac: "macOS",
  linux: "Linux",
  win: "Windows",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [version, setVersion] = useState<string | null>(null);
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    // Fetch system info as soon as possible
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

  const isDone = phase === "done";
  const isError = phase === "error";
  const isActive = !["idle", "done", "error"].includes(phase);

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] text-white select-none">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-7 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight text-white">drop.local</p>
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">installer</p>
        </div>
        {version && (
          <span className="ml-auto rounded-full bg-white/[0.06] px-2.5 py-1 font-mono text-[10px] text-white/50">
            {version}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-10">
        {/* Logo area */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/[0.06] ring-1 ring-white/10">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">drop.local</h1>
            <p className="mt-0.5 text-sm text-white/40">
              Share files instantly on your local network
            </p>
          </div>
        </div>

        {/* System info pill */}
        {sysInfo && (
          <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="font-mono text-xs text-white/60">
              {PLATFORM_LABELS[sysInfo.platform] ?? sysInfo.platform} · {sysInfo.arch} ·{" "}
              {sysInfo.hostname}
            </span>
          </div>
        )}

        {/* Progress area */}
        <div className="w-full space-y-3">
          {/* Status label */}
          <div className="flex items-center justify-between">
            <p
              className={`text-sm font-medium ${isError ? "text-red-400" : isDone ? "text-emerald-400" : "text-white/80"}`}
            >
              {PHASE_LABELS[phase]}
            </p>
            {phase === "downloading" && total > 0 && (
              <p className="font-mono text-xs text-white/40">
                {formatBytes(downloaded)} / {formatBytes(total)}
              </p>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isError ? "bg-red-500" : isDone ? "bg-emerald-500" : "bg-white"
              }`}
              style={{
                width: isDone
                  ? "100%"
                  : isError
                    ? "100%"
                    : isActive && phase !== "downloading"
                      ? "66%"
                      : `${progress}%`,
                opacity: isActive || isDone || isError ? 1 : 0,
              }}
            />
          </div>

          {/* Error detail */}
          {isError && error && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 font-mono text-[11px] text-red-400">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* Footer / CTA */}
      <div className="border-t border-white/[0.06] px-7 py-5">
        {isDone ? (
          <p className="text-center text-sm text-white/40">
            drop.local is launching — this window will close shortly.
          </p>
        ) : isError ? (
          <button
            onClick={startInstall}
            className="w-full rounded-xl bg-white/10 py-3 text-sm font-medium text-white transition-opacity hover:opacity-80 active:scale-[0.99]"
          >
            Retry
          </button>
        ) : isActive ? (
          <div className="flex items-center justify-center gap-2 text-white/30">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
            <span className="text-sm">Installing…</span>
          </div>
        ) : (
          <button
            onClick={startInstall}
            className="w-full rounded-xl bg-white py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 active:scale-[0.99]"
          >
            Install drop.local
          </button>
        )}
      </div>
    </div>
  );
}
