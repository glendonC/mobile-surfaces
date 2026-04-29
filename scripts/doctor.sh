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
