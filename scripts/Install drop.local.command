#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

# Clear quarantine from this script itself
xattr -d com.apple.quarantine "$0" 2>/dev/null || true

# Find the .app bundle next to this script
APP_PATH=$(find "$DIR" -maxdepth 1 -name "*.app" | head -1)
if [ -z "$APP_PATH" ]; then
  echo "❌  No .app found next to this script."
  echo "    Make sure you extracted the full zip before running."
  read -r -p "Press Enter to close…"
  exit 1
fi

APP_NAME=$(basename "$APP_PATH")
echo "→  Found: $APP_NAME"
echo "→  Clearing Gatekeeper quarantine…"
xattr -cr "$APP_PATH"

echo "→  Installing to /Applications…"
if [ -d "/Applications/$APP_NAME" ]; then
  rm -rf "/Applications/$APP_NAME"
fi
cp -R "$APP_PATH" /Applications/

echo "→  Done. Launching $APP_NAME…"
open "/Applications/$APP_NAME"
