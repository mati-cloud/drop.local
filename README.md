# @mati.cloud/drop.local

Fast, offline LAN file sharing. No cloud, no accounts, no internet.

Built with [Electrobun](https://blackboard.sh/electrobun) + Bun + Next.js.

## Why

Every cloud-based sharing tool - AirDrop alternatives, clipboard sync apps, "zero-knowledge" services - has one thing in common: your data touches someone else's server. It doesn't matter what the privacy policy says. The moment a file or a password leaves your machine and hits an external relay, you've lost control of it.

I built drop.local because I kept needing to move things between my own machines quickly: a 128-character generated password I didn't want to type, a screenshot, a config file, a quick note. Reaching for a cloud service every time felt wrong - not just slow, but unnecessary. These machines are on the same network. The data should never leave it.

With drop.local, nothing does.

_also i hated to keep creating accounts for such services lmao i just wanna share files, and not sharing my name, email n shit_

## How it works

- Devices on the same Wi-Fi/LAN auto-discover each other via UDP broadcast
- Files transfer directly over TCP — no relay, no internet
- Received files land in `~/Downloads/drop.local/`

## Supported platforms

| Platform | Architecture          |
| -------- | --------------------- |
| macOS    | arm64 (Apple Silicon) |
| Linux    | arm64, x86_64         |
| Windows  | arm64, x86_64         |

## Install

Download the latest release for your platform from [Releases](../../releases).

**macOS:** Open the `.zip` — allow Terminal to open it via `xattr -cr ~/Downloads/drop-local-installer.app`, which will clear Gatekeeper quarantine, and launch it. One-time setup.

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

| Port  | Protocol | Purpose                    |
| ----- | -------- | -------------------------- |
| 50002 | UDP      | Device discovery broadcast |
| 50004 | TCP      | File transfer              |

## License

AGPL-3.0
