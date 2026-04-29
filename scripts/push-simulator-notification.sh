#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ID="${1:-com.example.mobilesurfaces}"

xcrun simctl push booted "$BUNDLE_ID" - <<'JSON'
{
  "aps": {
    "alert": {
      "title": "Mobile Surfaces",
      "body": "Simulator push path is wired."
    },
    "sound": "default"
  },
  "liveSurface": {
    "kind": "smoke_test"
  }
}
JSON
