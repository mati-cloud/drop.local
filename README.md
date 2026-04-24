# @mati.cloud/drop.local

Fast, offline LAN file sharing. No cloud, no accounts, no internet.

Built with [Electrobun](https://blackboard.sh/electrobun) + Bun + Next.js.

## How it works

- Devices on the same Wi-Fi/LAN auto-discover each other via UDP broadcast
- Files transfer directly over TCP — no relay, no internet
- Received files land in `~/Downloads/drop.local/`

## Supported platforms

| Platform | Architecture |
|---|---|
| macOS | arm64 (Apple Silicon) |
| Linux | arm64, x86_64 |
| Windows | arm64, x86_64 |

## Install

Download the latest release for your platform from [Releases](../../releases).

**macOS:** Open the `.zip` — double-click `Install drop.local.command`, allow Terminal to open it, and it will clear Gatekeeper quarantine, copy the app to `/Applications`, and launch it. One-time setup, no Apple account needed.

**Linux:** Extract the `.tar.gz`, make executable and run.

**Windows:** Extract the `.zip` and run the `.exe`.

## Development

**Prerequisites:** [Bun](https://bun.sh) and [Electrobun](https://blackboard.sh/electrobun) installed.

```bash
bun install
bun run start          # Vite build + Electrobun dev mode
```

**Run CI checks locally:**

```bash
bun run check          # type check + lint + test + build
```

**Build a native binary:**

```bash
bun run build:electrobun
```

## Ports used

| Port | Protocol | Purpose |
|---|---|---|
| 50002 | UDP | Device discovery broadcast |
| 50004 | TCP | File transfer |

## License

AGPL-3.0
