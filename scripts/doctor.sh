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
echo "Xcode: $(xcodebuild -version | tr '\n' ' ')"

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
