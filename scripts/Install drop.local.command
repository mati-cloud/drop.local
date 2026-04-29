#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PATH="$DIR/drop-local.app"
if [ ! -d "$APP_PATH" ]; then
  echo "Error: drop-local.app not found next to this script."
  read -p "Press Enter to close..."
  exit 1
fi
echo "Clearing Gatekeeper quarantine..."
xattr -cr "$APP_PATH"
echo "Installing to /Applications..."
cp -R "$APP_PATH" /Applications/
echo "Done. Launching drop.local..."
open /Applications/drop-local.app
