#!/usr/bin/env bash
set -euo pipefail

DEVICE="${DEVICE:-iPhone 17 Pro}"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: pnpm mobile:sim"
  echo
  echo "Environment:"
  echo "  DEVICE=\"iPhone 17 Pro Max\"  Override the simulator/device name"
  exit 0
fi

source scripts/ensure-node-24.sh

echo "Using Node $(node -v)"
echo "Launching Mobile Surfaces on $DEVICE"

pnpm --dir apps/mobile exec expo run:ios --device "$DEVICE"
