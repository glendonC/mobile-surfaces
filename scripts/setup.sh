#!/usr/bin/env bash
set -euo pipefail

bash scripts/doctor.sh
pnpm install
