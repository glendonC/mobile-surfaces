#!/usr/bin/env bash
set -euo pipefail

source scripts/ensure-node-24.sh
node --experimental-strip-types scripts/doctor.mjs
pnpm install
