#!/usr/bin/env bash
set -euo pipefail

source scripts/ensure-node-24.sh

DEVICE="${DEVICE:-iPhone 17 Pro}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is not installed or is not on PATH."
  echo "Install via Corepack: corepack enable pnpm"
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild is not on PATH. Install Xcode and run: sudo xcodebuild -runFirstLaunch"
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun is not on PATH. Install Xcode command line tools."
  exit 1
fi

echo "Node: $(node -v)"
echo "pnpm: $(pnpm -v)"
XCODE_LINE=$(xcodebuild -version | head -n 1)
echo "Xcode: $(xcodebuild -version | tr '\n' ' ')"

XCODE_MAJOR=$(printf '%s' "$XCODE_LINE" | sed -nE 's/^Xcode[[:space:]]+([0-9]+).*/\1/p')
if [ -n "$XCODE_MAJOR" ] && [ "$XCODE_MAJOR" -lt 26 ]; then
  echo "Xcode: $XCODE_LINE is below the required Xcode 26. Update via the Mac App Store before running iOS prebuild or device builds."
  exit 1
fi

if xcrun simctl list devices available | grep -q "$DEVICE"; then
  echo "Simulator: $DEVICE available"
else
  echo "Simulator: $DEVICE not found. Set DEVICE=\"<simulator name>\" when running pnpm mobile:sim."
fi

APP_JSON="apps/mobile/app.json"
if [ -f "$APP_JSON" ]; then
  TEAM_ID=$(node -e "const j=require('./$APP_JSON');process.stdout.write(j.expo?.ios?.appleTeamId||'')" 2>/dev/null || true)
  if [ -z "$TEAM_ID" ]; then
    echo "Apple Team ID: not set. Add expo.ios.appleTeamId to $APP_JSON before running expo run:ios --device."
  elif [ "$TEAM_ID" = "XXXXXXXXXX" ]; then
    echo "Apple Team ID: placeholder still in $APP_JSON. Replace expo.ios.appleTeamId with your 10-character team id (Xcode → Signing & Capabilities → Team, or developer.apple.com → Membership)."
  else
    echo "Apple Team ID: $TEAM_ID"
  fi
fi
