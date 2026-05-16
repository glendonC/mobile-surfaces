// End-to-end tests for scripts/check-app-group-identity.mjs.
//
// MS013 is the App-Group-must-match check. Drift between any of the four
// declaration sites renders widgets blank with no error log, so the script
// must detect every form of mismatch and every form of missing/malformed
// source.
//
// As of v5 the layout is four sources (was five):
//   - apps/mobile/app.json
//   - apps/mobile/targets/widget/generated.entitlements
//   - apps/mobile/targets/_shared/MobileSurfacesAppGroup.swift (generated)
//   - apps/mobile/src/generated/appGroup.ts (generated)

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-app-group-identity.mjs");

const CANONICAL = "group.com.example.mobilesurfaces";

function appJson(group) {
  return JSON.stringify(
    {
      expo: {
        name: "test",
        slug: "test",
        ios: {
          entitlements: {
            "com.apple.security.application-groups": [group],
          },
        },
      },
    },
    null,
    2,
  );
}

function widgetEntitlements(group) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${group}</string>
  </array>
</dict>
</plist>
`;
}

function appGroupSwift(group) {
  return `// GENERATED - DO NOT EDIT. Source: apps/mobile/app.json.
// Regenerate: pnpm surface:codegen

import Foundation

enum MobileSurfacesAppGroup {
  static let identifier = "${group}"
}
`;
}

function appGroupTs(group) {
  return `// GENERATED - DO NOT EDIT. Source: apps/mobile/app.json.
// Regenerate: pnpm surface:codegen

export const APP_GROUP = "${group}" as const;
`;
}

function withWorkspace({
  appGroupApp = CANONICAL,
  appGroupWidgetPlist = CANONICAL,
  appGroupSwiftValue = CANONICAL,
  appGroupTsValue = CANONICAL,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-appgrp-"));
  const writes = {
    "apps/mobile/app.json": appJson(appGroupApp),
    "apps/mobile/targets/widget/generated.entitlements": widgetEntitlements(appGroupWidgetPlist),
    "apps/mobile/targets/_shared/MobileSurfacesAppGroup.swift": appGroupSwift(appGroupSwiftValue),
    "apps/mobile/src/generated/appGroup.ts": appGroupTs(appGroupTsValue),
  };
  for (const [relPath, contents] of Object.entries(writes)) {
    const full = join(dir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runCheck(cwd) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

test("baseline: every source declares the canonical identifier", () => {
  const ws = withWorkspace();
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /All 4 sources resolve to "group\.com\.example\.mobilesurfaces"/);
  } finally {
    ws.cleanup();
  }
});

test("flags a widget plist that declares a different App Group identifier", () => {
  const ws = withWorkspace({ appGroupWidgetPlist: "group.com.example.other" });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /MS013/);
    assert.match(r.stdout + r.stderr, /generated\.entitlements|widget/i);
    assert.match(r.stdout + r.stderr, /group\.com\.example\.other/);
  } finally {
    ws.cleanup();
  }
});

test("flags a generated Swift file declaring a different App Group identifier", () => {
  const ws = withWorkspace({ appGroupSwiftValue: "group.com.example.wrong" });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /MobileSurfacesAppGroup/);
  } finally {
    ws.cleanup();
  }
});

test("flags the generated TS appGroup.ts declaring a different App Group identifier", () => {
  const ws = withWorkspace({ appGroupTsValue: "group.com.example.fork" });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /appGroup\.ts|generated/);
  } finally {
    ws.cleanup();
  }
});

test("flags a missing source file", () => {
  const ws = withWorkspace();
  rmSync(join(ws.dir, "apps/mobile/targets/widget/generated.entitlements"));
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /file not found|generated\.entitlements/);
  } finally {
    ws.cleanup();
  }
});

test("flags an app.json that declares zero App Groups", () => {
  const ws = withWorkspace();
  writeFileSync(
    join(ws.dir, "apps/mobile/app.json"),
    JSON.stringify(
      {
        expo: {
          name: "test",
          slug: "test",
          ios: { entitlements: { "com.apple.security.application-groups": [] } },
        },
      },
      null,
      2,
    ),
  );
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /missing or empty|application-groups/);
  } finally {
    ws.cleanup();
  }
});

test("flags an app.json that declares more than one App Group", () => {
  const ws = withWorkspace();
  writeFileSync(
    join(ws.dir, "apps/mobile/app.json"),
    JSON.stringify(
      {
        expo: {
          name: "test",
          slug: "test",
          ios: {
            entitlements: {
              "com.apple.security.application-groups": [
                "group.com.example.a",
                "group.com.example.b",
              ],
            },
          },
        },
      },
      null,
      2,
    ),
  );
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /expected exactly one|found 2/i);
  } finally {
    ws.cleanup();
  }
});
