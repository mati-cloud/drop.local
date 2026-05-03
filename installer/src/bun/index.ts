import { BrowserWindow, BrowserView } from "electrobun/bun";
import os from "os";
import path from "path";
import { mkdir, rm, chmod, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { spawnSync, spawn } from "child_process";

const GITHUB_REPO = "mati-cloud/drop.local"; // update if needed
const APP_NAME = "drop.local";

// ── Platform detection ────────────────────────────────────────────────────────

type Platform = "mac" | "linux" | "win";
type Arch = "x86_64" | "arm64";

function detectPlatform(): Platform {
  switch (process.platform) {
    case "darwin":
      return "mac";
    case "linux":
      return "linux";
    case "win32":
      return "win";
    default:
      return "linux";
  }
}

function detectArch(): Arch {
  return process.arch === "arm64" ? "arm64" : "x86_64";
}

function artifactName(platform: Platform, arch: Arch): string {
  return `drop-local-${platform === "mac" ? "macos" : platform}-${arch}`;
}

function artifactExt(platform: Platform): string {
  if (platform === "mac") return ".zip";  // .app bundle must be zipped for download
  if (platform === "win") return ".exe";
  return ""; // Linux: raw binary, no extension
}

// ── Install path per platform ─────────────────────────────────────────────────

function installDir(platform: Platform): string {
  switch (platform) {
    case "mac":
      return "/Applications";
    case "linux":
      return path.join(os.homedir(), ".local", "share", "drop-local");
    case "win":
      return path.join(
        process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local"),
        "drop-local",
      );
  }
}

function launchTarget(platform: Platform, dir: string): string {
  switch (platform) {
    case "mac":
      return path.join(dir, "drop-local.app");
    case "linux":
      return path.join(dir, "drop-local");
    case "win":
      return path.join(dir, "drop-local.exe");
  }
}

// ── RPC ───────────────────────────────────────────────────────────────────────

let windowRef: BrowserWindow | null = null;

function sendStatus(type: string, payload: Record<string, unknown> = {}) {
  try {
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = windowRef?.webview?.rpc as any;
    rpc?.send?.onStatus({ type, ...payload });
  } catch {
    // window may not be ready yet
  }
}

// Resolver set by runInstall() after benchmark — frontend calls acknowledgeBenchmark to unblock it
let benchmarkAckResolve: (() => void) | null = null;

const installerRPC = BrowserView.defineRPC({
  handlers: {
    requests: {
      closeWindow: () => {
        setTimeout(() => process.exit(0), 80);
        return {};
      },
      getSystemInfo: () => ({
        platform: detectPlatform(),
        arch: detectArch(),
        hostname: os.hostname(),
      }),
      getAppInfo: () => ({
        installerVersion: "1.0.0",
        repo: GITHUB_REPO,
        udpPort: 50002,
        tcpPort: 50004,
      }),
      startInstall: async () => {
        // Fire-and-forget — progress comes back via onStatus messages
        runInstall().catch((err) => {
          sendStatus("error", { message: String(err) });
        });
        return { started: true };
      },
      acknowledgeBenchmark: () => {
        benchmarkAckResolve?.();
        benchmarkAckResolve = null;
        return {};
      },
    },
    messages: {},
  },
});

// ── Disk benchmark ───────────────────────────────────────────────────────────

function perfConfigPath(): string {
  const platform = detectPlatform();
  switch (platform) {
    case "mac":
      return path.join(os.homedir(), "Library", "Application Support", "drop-local", "perf.json");
    case "linux":
      return path.join(
        process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"),
        "drop-local",
        "perf.json",
      );
    case "win":
      return path.join(
        process.env["APPDATA"] ?? path.join(os.homedir(), "AppData", "Roaming"),
        "drop-local",
        "perf.json",
      );
  }
}

interface DiskPerf {
  diskReadMBps: number;
  diskWriteMBps: number;
}

async function runDiskBenchmark(): Promise<DiskPerf> {
  const tmpFile = path.join(os.tmpdir(), `drop-local-bench-${Date.now()}.tmp`);
  const SIZE = 64 * 1024 * 1024; // 64 MB
  const buf = Buffer.allocUnsafe(SIZE);

  try {
    // Write benchmark
    const writeStart = performance.now();
    await Bun.write(tmpFile, buf);
    const writeElapsed = (performance.now() - writeStart) / 1000;
    const diskWriteMBps = Math.round(SIZE / 1024 / 1024 / writeElapsed);

    // Read benchmark
    const readStart = performance.now();
    await Bun.file(tmpFile).arrayBuffer();
    const readElapsed = (performance.now() - readStart) / 1000;
    const diskReadMBps = Math.round(SIZE / 1024 / 1024 / readElapsed);

    return { diskReadMBps, diskWriteMBps };
  } catch {
    return { diskReadMBps: 500, diskWriteMBps: 200 }; // safe fallback
  } finally {
    await rm(tmpFile, { force: true }).catch(() => {});
  }
}

async function writePerfConfig(perf: DiskPerf): Promise<void> {
  const configPath = perfConfigPath();
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({ ...perf, benchmarkedAt: Date.now() }, null, 2),
  );
  console.log(`✓ perf.json written: read=${perf.diskReadMBps} MB/s write=${perf.diskWriteMBps} MB/s → ${configPath}`);
}

// ── Install logic ─────────────────────────────────────────────────────────────

async function runInstall() {
  const platform = detectPlatform();
  const arch = detectArch();

  sendStatus("detecting", { platform, arch });

  // 1. Fetch latest release from GitHub
  sendStatus("fetching-release");
  const releasesUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const releaseResp = await fetch(releasesUrl, {
    headers: { "User-Agent": `${APP_NAME}-installer` },
  });
  if (!releaseResp.ok) {
    throw new Error(`GitHub API error: ${releaseResp.status} ${releaseResp.statusText}`);
  }
  const release = (await releaseResp.json()) as {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string; size: number }>;
  };

  const name = artifactName(platform, arch);
  const ext = artifactExt(platform);
  const assetName = `${name}${ext}`;
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new Error(`No asset found for ${assetName} in release ${release.tag_name}`);
  }

  sendStatus("asset-found", { version: release.tag_name, assetName, size: asset.size });

  // 2. Stream download with progress
  sendStatus("downloading", { progress: 0, total: asset.size });
  const dlResp = await fetch(asset.browser_download_url);
  if (!dlResp.ok || !dlResp.body) {
    throw new Error(`Download failed: ${dlResp.status}`);
  }

  const tmpDir = path.join(os.tmpdir(), `drop-local-install-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  console.log(tmpDir, assetName)
  const archivePath = path.join(tmpDir, assetName);

  const reader = dlResp.body.getReader();
  const writer = Bun.file(archivePath).writer();
  let downloaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await writer.write(value);
    downloaded += value.length;
    const progress = asset.size > 0 ? Math.round((downloaded / asset.size) * 100) : 0;
    sendStatus("downloading", { progress, downloaded, total: asset.size });
  }
  await writer.flush();
  void writer.end();

  sendStatus("installing");

  // 3. Install — format-aware: macOS unzips .app, Linux/Windows are raw files
  const target = installDir(platform);

  if (platform === "mac") {
    // Unzip .app bundle, clear quarantine
    const extractDir = path.join(tmpDir, "extracted");
    await mkdir(extractDir, { recursive: true });
    const unzip = spawnSync("unzip", ["-q", archivePath, "-d", extractDir], { stdio: "inherit" });
    console.log('archivePath:', archivePath);
    console.log('UNZIP STATUS:', unzip.status);
    console.log('extractDir:', extractDir);
    if (unzip.status !== 0) throw new Error("unzip failed");
    const appInExtract = path.join(extractDir, "drop-local.app");
    console.log('extractDir:', extractDir);
    const dest = path.join(target, "drop-local.app");
    if (existsSync(dest)) await rm(dest, { recursive: true });
    spawnSync("cp", ["-R", appInExtract, dest], { stdio: "inherit" });
    try { spawnSync("xattr", ["-cr", dest], { stdio: "inherit" }); } catch { /* ignore */ }
  } else if (platform === "linux") {
    // Raw binary — just move it into place and chmod +x
    await mkdir(target, { recursive: true });
    const dest = launchTarget(platform, target);
    if (existsSync(dest)) await rm(dest);
    spawnSync("mv", [archivePath, dest], { stdio: "inherit" });
    await chmod(dest, 0o755);
  } else {
    // Windows raw .exe — move into install dir
    await mkdir(target, { recursive: true });
    const dest = launchTarget(platform, target);
    if (existsSync(dest)) await rm(dest);
    spawnSync(
      "powershell",
      ["-Command", `Move-Item -Path "${archivePath}" -Destination "${dest}" -Force`],
      { stdio: "inherit" },
    );
  }

  // Cleanup tmp
  await rm(tmpDir, { recursive: true }).catch(() => {});

  // 5. Disk benchmark — runs before launch so perf.json is ready when app starts
  sendStatus("benchmarking");
  let perf: DiskPerf | undefined;
  try {
    perf = await runDiskBenchmark();
    await writePerfConfig(perf);
  } catch {
    // non-fatal — main app falls back to default chunk size
  }

  // Pause and wait for user to acknowledge benchmark results before launching
  await new Promise<void>((resolve) => {
    benchmarkAckResolve = resolve;
    const r = perf?.diskReadMBps;
    const w = perf?.diskWriteMBps;
    sendStatus("benchmark-ready", {
      diskReadMBps: r ?? null,
      diskWriteMBps: w ?? null,
      chunkSizeMB: r === undefined ? 4 : r < 200 ? 1 : r < 800 ? 4 : 8,
    });
  });

  sendStatus("launching");

  // 6. Launch the installed app (detached — survives installer exit)
  const launch = launchTarget(platform, installDir(platform));
  let child;
  if (platform === "mac") {
    child = spawn("open", [launch], { detached: true, stdio: "ignore" });
  } else if (platform === "linux") {
    child = spawn(launch, [], { detached: true, stdio: "ignore" });
  } else {
    child = spawn("cmd", ["/c", "start", "", launch], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
  }
  child.unref();

  sendStatus("done", { version: release.tag_name, ...(perf && { diskReadMBps: perf.diskReadMBps, diskWriteMBps: perf.diskWriteMBps }) });

  // Quit installer after a delay so user can read the finish screen
  setTimeout(() => process.exit(0), 4000);
}

// ── Window ────────────────────────────────────────────────────────────────────

const mainWindow = new BrowserWindow({
  title: `Install ${APP_NAME}`,
  url: "views://mainview/index.html",
  frame: {
    width: 720,
    height: 420,
    x: 400,
    y: 200,
  },
  titleBarStyle: "hidden",
  styleMask: {
    Resizable: false,
    Miniaturizable: false,
    Borderless: false,
    Titled: false,
    FullSizeContentView: true,
  },
  rpc: installerRPC,
});

// eslint-disable-next-line no-useless-assignment
windowRef = mainWindow;
mainWindow.show();
