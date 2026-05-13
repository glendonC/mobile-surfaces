// End-to-end tests for scripts/check-app-group-identity.mjs.
//
// MS013 is the App-Group-must-match check. Drift between any of the four
// declaration sites + the two TS consumer files renders widgets blank with
// no error log, so the script needs to detect every form of mismatch and
// every form of consumer regression (re-introduced local literal, missing
// import).

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

function sharedStateSwift(group) {
  return `import Foundation
enum MobileSurfacesSharedState {
  static let appGroup = "${group}"
}
`;
}

function configTs(group) {
  return `export const APP_GROUP = "${group}";\n`;
}

function consumerOk() {
  return 'import { APP_GROUP } from "../config";\nconsole.log(APP_GROUP);\n';
}

function consumerWithLiteral(group) {
  return `const APP_GROUP = "${group}";\nconsole.log(APP_GROUP);\n`;
}

function withWorkspace({
  appGroupApp = CANONICAL,
  appGroupWidgetPlist = CANONICAL,
  appGroupSwift = CANONICAL,
  appGroupConfig = CANONICAL,
  surfaceStorage = consumerOk(),
  checkSetup = consumerOk(),
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-appgrp-"));
  const writes = {
    "apps/mobile/app.json": appJson(appGroupApp),
    "apps/mobile/targets/widget/generated.entitlements": widgetEntitlements(appGroupWidgetPlist),
    "apps/mobile/targets/widget/_shared/MobileSurfacesSharedState.swift": sharedStateSwift(appGroupSwift),
    "apps/mobile/src/config.ts": configTs(appGroupConfig),
    "apps/mobile/src/surfaceStorage/index.ts": surfaceStorage,
    "apps/mobile/src/diagnostics/checkSetup.ts": checkSetup,
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

test("baseline: every source declares the canonical identifier and consumers import it", () => {
  const ws = withWorkspace();
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /All 4 sources resolve to "group\.com\.example\.mobilesurfaces"/);
    assert.match(r.stdout, /TS consumer\(s\) import APP_GROUP from src\/config\.ts/);
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

test("flags a Swift shared-state file declaring a different App Group identifier", () => {
  const ws = withWorkspace({ appGroupSwift: "group.com.example.wrong" });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /MobileSurfacesSharedState/);
  } finally {
    ws.cleanup();
  }
});

test("flags src/config.ts declaring a different App Group identifier", () => {
  const ws = withWorkspace({ appGroupConfig: "group.com.example.fork" });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /config\.ts|src\/config/);
  } finally {
    ws.cleanup();
  }
});

test("flags a TS consumer that re-declares APP_GROUP as a local literal", () => {
  // Regression: consumers must import APP_GROUP from "../config" so the
  // TS layer cannot silently re-fork the identifier.
  const ws = withWorkspace({
    surfaceStorage: consumerWithLiteral(CANONICAL),
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /surfaceStorage/);
    assert.match(r.stdout + r.stderr, /import APP_GROUP from .*config/i);
  } finally {
    ws.cleanup();
  }
});

test("flags a TS consumer that does not import APP_GROUP from ../config", () => {
  const ws = withWorkspace({
    checkSetup: 'console.log("no APP_GROUP usage");\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /checkSetup/);
  } finally {
    ws.cleanup();
  }
});

test("flags a missing source file", () => {
  const ws = withWorkspace();
  // Wipe one declaration site after staging.
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
