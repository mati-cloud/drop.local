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
  return platform === "linux" ? ".tar.gz" : ".zip";
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

function launchTarget(platform: Platform, installDir: string): string {
  switch (platform) {
    case "mac":
      return path.join(installDir, "drop-local.app");
    case "linux":
      return path.join(installDir, "bin", "launcher");
    case "win":
      return path.join(installDir, "bin", "launcher.exe");
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
        installerVersion: "0.1.0",
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

async function runDiskBenchmark(): Promise<number> {
  const tmpFile = path.join(os.tmpdir(), `drop-local-bench-${Date.now()}.tmp`);
  const SIZE = 64 * 1024 * 1024; // 64 MB write + read
  const buf = Buffer.allocUnsafe(SIZE);

  try {
    // Write
    await Bun.write(tmpFile, buf);
    // Read and time
    const start = performance.now();
    await Bun.file(tmpFile).arrayBuffer();
    const elapsed = (performance.now() - start) / 1000; // seconds
    const mbps = Math.round(SIZE / 1024 / 1024 / elapsed);
    return mbps;
  } catch {
    return 500; // safe fallback (4MB chunk)
  } finally {
    await rm(tmpFile, { force: true }).catch(() => {});
  }
}

async function writePerfConfig(diskReadMBps: number): Promise<void> {
  const configPath = perfConfigPath();
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({ diskReadMBps, benchmarkedAt: Date.now() }, null, 2),
  );
  console.log(`✓ perf.json written: ${diskReadMBps} MB/s → ${configPath}`);
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

  sendStatus("extracting");

  // 3. Extract
  const extractDir = path.join(tmpDir, "extracted");
  await mkdir(extractDir, { recursive: true });

  if (ext === ".tar.gz") {
    const result = spawnSync("tar", ["-xzf", archivePath, "-C", extractDir], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("tar extraction failed");
  } else {
    // zip — use unzip on mac/linux, Expand-Archive on win
    if (platform === "win") {
      const result = spawnSync(
        "powershell",
        [
          "-Command",
          `Expand-Archive -Path "${archivePath}" -DestinationPath "${extractDir}" -Force`,
        ],
        { stdio: "inherit" },
      );
      if (result.status !== 0) throw new Error("Expand-Archive failed");
    } else {
      const result = spawnSync("unzip", ["-q", archivePath, "-d", extractDir], {
        stdio: "inherit",
      });
      if (result.status !== 0) throw new Error("unzip failed");
    }
  }

  sendStatus("installing");

  // 4. Move to install location
  const target = installDir(platform);

  if (platform === "mac") {
    const appInExtract = path.join(extractDir, "drop-local.app");
    const dest = path.join(target, "drop-local.app");
    if (existsSync(dest)) await rm(dest, { recursive: true });
    spawnSync("cp", ["-R", appInExtract, dest], { stdio: "inherit" });
    // Clear quarantine
    try {
      spawnSync("xattr", ["-cr", dest], { stdio: "inherit" });
    } catch {
      /* ignore */
    }
  } else if (platform === "linux") {
    await mkdir(target, { recursive: true });
    if (existsSync(target)) await rm(target, { recursive: true });
    spawnSync("mv", [extractDir, target], { stdio: "inherit" });
    const bin = launchTarget(platform, target);
    if (existsSync(bin)) await chmod(bin, 0o755);
  } else {
    await mkdir(target, { recursive: true });
    if (existsSync(target)) await rm(target, { recursive: true });
    spawnSync(
      "powershell",
      ["-Command", `Move-Item -Path "${extractDir}" -Destination "${target}" -Force`],
      { stdio: "inherit" },
    );
  }

  // Cleanup tmp
  await rm(tmpDir, { recursive: true }).catch(() => {});

  sendStatus("launching");

  // 5. Launch the installed app (detached — survives installer exit)
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

  // 6. Disk benchmark — writes perf.json so main app can pick optimal chunk size
  sendStatus("benchmarking");
  try {
    const diskReadMBps = await runDiskBenchmark();
    await writePerfConfig(diskReadMBps);
    sendStatus("done", { version: release.tag_name, diskReadMBps });
  } catch {
    sendStatus("done", { version: release.tag_name });
  }

  // Quit installer after a brief delay so user can see "done"
  setTimeout(() => process.exit(0), 2500);
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
