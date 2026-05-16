// End-to-end tests for scripts/check-surface-snapshots.mjs (MS036).
//
// We exercise the script as a subprocess against synthesized Swift sources in
// a temp workspace, so the assertions cover the same code path CI runs (struct
// extraction via lib/swift-content-state.mjs, Zod parity, diagnostic
// emission). Each test stages
// apps/mobile/targets/_shared/MobileSurfacesSharedState.swift inside a
// tmp dir; the script is invoked with that dir as cwd. Surface-contracts and
// lib/ resolve relative to the real script location so we do not reimplement
// the schema.
//
// One happy-path test plus one test per divergence mode: added field, removed
// field, renamed JSON key, type mismatch, optionality mismatch, and a
// "teach the checker" guard for an unrecognized Zod-vs-Swift case.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-surface-snapshots.mjs");

// A minimal but faithful copy of the four snapshot structs from the real
// MobileSurfacesSharedState.swift. The enum wrapper and helper methods are
// omitted: the checker only parses the four top-level structs by name, so the
// surrounding file content does not affect the result.
const REAL_SHARED_STATE = `// Auto-generated for tests.
import Foundation
import WidgetKit

struct MobileSurfacesWidgetSnapshot: Codable, Hashable {
  var kind: String
  var snapshotId: String
  var surfaceId: String
  var state: String
  var family: String?
  var reloadPolicy: String?
  var headline: String
  var subhead: String
  var progress: Double
  var deepLink: String
}

struct MobileSurfacesControlSnapshot: Codable, Hashable {
  var kind: String
  var snapshotId: String
  var surfaceId: String
  var controlKind: String
  var value: Bool?
  var intent: String?
  var label: String
  var deepLink: String
}

struct MobileSurfacesLockAccessorySnapshot: Codable, Hashable {
  var kind: String
  var snapshotId: String
  var surfaceId: String
  var state: String
  var family: String
  var headline: String
  var shortText: String?
  var gaugeValue: Double?
  var deepLink: String
}

struct MobileSurfacesStandbySnapshot: Codable, Hashable {
  var kind: String
  var snapshotId: String
  var surfaceId: String
  var state: String
  var presentation: String
  var tint: String?
  var headline: String
  var subhead: String
  var progress: Double
  var deepLink: String
}
`;

// Faithful copy of the notification-content extension's userInfo decoder.
// Lives in a separate Swift file from the four App-Group readers because the
// content extension is a different Apple extension type; MS036's SURFACES
// list points its parity entry at this file via `swiftSource`.
const REAL_NOTIFICATION_VIEW_CONTROLLER = `// Auto-generated for tests.
import Foundation

struct MobileSurfacesNotificationContentEntry: Codable, Hashable {
  let kind: String
  let snapshotId: String
  let surfaceId: String
  let state: String
  let deepLink: String
  let category: String?
}
`;

function withWorkspace(sharedStateSource, notificationVcSource = REAL_NOTIFICATION_VIEW_CONTROLLER) {
  // The script reads apps/mobile/targets/_shared/...swift and
  // apps/mobile/targets/notification-content/...swift relative to its cwd
  // (one path per SURFACES entry), and imports ../packages/surface-contracts
  // and ./lib relative to its own location, so only the two input files
  // need to exist at the tmp cwd.
  const dir = mkdtempSync(join(tmpdir(), "ms-check-snapshots-"));
  const sharedDir = join(dir, "apps", "mobile", "targets", "_shared");
  mkdirSync(sharedDir, { recursive: true });
  writeFileSync(
    join(sharedDir, "MobileSurfacesSharedState.swift"),
    sharedStateSource,
  );
  const notifDir = join(dir, "apps", "mobile", "targets", "notification-content");
  mkdirSync(notifDir, { recursive: true });
  writeFileSync(
    join(notifDir, "MobileSurfacesNotificationViewController.swift"),
    notificationVcSource,
  );
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runCheck(cwd) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", SCRIPT],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0" },
    },
  );
}

test("baseline: faithful snapshot structs pass all five parity checks", () => {
  const ws = withWorkspace(REAL_SHARED_STATE);
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[MS036\] Swift MobileSurfacesWidgetSnapshot matches Zod/);
    assert.match(r.stdout, /\[MS036\] Swift MobileSurfacesControlSnapshot matches Zod/);
    assert.match(r.stdout, /\[MS036\] Swift MobileSurfacesLockAccessorySnapshot matches Zod/);
    assert.match(r.stdout, /\[MS036\] Swift MobileSurfacesStandbySnapshot matches Zod/);
    assert.match(r.stdout, /\[MS036\] Swift MobileSurfacesNotificationContentEntry matches Zod/);
  } finally {
    ws.cleanup();
  }
});

test("added field: a Swift property absent from the Zod schema fails", () => {
  const drifted = REAL_SHARED_STATE.replace(
    "  var deepLink: String\n}\n\nstruct MobileSurfacesControlSnapshot",
    "  var deepLink: String\n  var extraField: String\n}\n\nstruct MobileSurfacesControlSnapshot",
  );
  const ws = withWorkspace(drifted);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, "expected non-zero exit on added field");
    assert.match(r.stdout + r.stderr, /MS036/);
    assert.match(r.stdout + r.stderr, /extraField/);
    assert.match(r.stdout + r.stderr, /not present in Zod/);
  } finally {
    ws.cleanup();
  }
});

test("removed field: a Zod key with no Swift property fails", () => {
  // Drop `subhead` from the widget struct; the Zod schema still has it.
  const drifted = REAL_SHARED_STATE.replace("  var subhead: String\n  var progress: Double\n  var deepLink: String\n}\n\nstruct MobileSurfacesControlSnapshot", "  var progress: Double\n  var deepLink: String\n}\n\nstruct MobileSurfacesControlSnapshot");
  const ws = withWorkspace(drifted);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, "expected non-zero exit on removed field");
    assert.match(r.stdout + r.stderr, /MS036/);
    assert.match(r.stdout + r.stderr, /subhead/);
    assert.match(r.stdout + r.stderr, /no field in Swift struct/);
  } finally {
    ws.cleanup();
  }
});

test("renamed JSON key: a CodingKeys remap decoupling property from wire key fails", () => {
  // Add an explicit CodingKeys enum to the widget struct that remaps
  // `headline` to the JSON key "title". Zod still expects "headline".
  const drifted = REAL_SHARED_STATE.replace(
    "struct MobileSurfacesWidgetSnapshot: Codable, Hashable {\n  var kind: String\n  var snapshotId: String\n  var surfaceId: String\n  var state: String\n  var family: String?\n  var reloadPolicy: String?\n  var headline: String\n  var subhead: String\n  var progress: Double\n  var deepLink: String\n}",
    `struct MobileSurfacesWidgetSnapshot: Codable, Hashable {
  var kind: String
  var snapshotId: String
  var surfaceId: String
  var state: String
  var family: String?
  var reloadPolicy: String?
  var headline: String
  var subhead: String
  var progress: Double
  var deepLink: String

  enum CodingKeys: String, CodingKey {
    case kind
    case snapshotId
    case surfaceId
    case state
    case family
    case reloadPolicy
    case headline = "title"
    case subhead
    case progress
    case deepLink
  }
}`,
  );
  const ws = withWorkspace(drifted);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, "expected non-zero exit on renamed JSON key");
    assert.match(r.stdout + r.stderr, /MS036/);
    assert.match(r.stdout + r.stderr, /headline/);
    assert.match(r.stdout + r.stderr, /title/);
  } finally {
    ws.cleanup();
  }
});

test("type mismatch: a Double field declared as String fails", () => {
  // `progress` is z.number() -> Double; declare it as String in the standby
  // struct.
  const drifted = REAL_SHARED_STATE.replace(
    "struct MobileSurfacesStandbySnapshot: Codable, Hashable {\n  var kind: String\n  var snapshotId: String\n  var surfaceId: String\n  var state: String\n  var presentation: String\n  var tint: String?\n  var headline: String\n  var subhead: String\n  var progress: Double",
    "struct MobileSurfacesStandbySnapshot: Codable, Hashable {\n  var kind: String\n  var snapshotId: String\n  var surfaceId: String\n  var state: String\n  var presentation: String\n  var tint: String?\n  var headline: String\n  var subhead: String\n  var progress: String",
  );
  const ws = withWorkspace(drifted);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, "expected non-zero exit on type mismatch");
    assert.match(r.stdout + r.stderr, /MS036/);
    assert.match(r.stdout + r.stderr, /progress/);
    assert.match(r.stdout + r.stderr, /expects Swift type Double/);
  } finally {
    ws.cleanup();
  }
});

test("optionality mismatch: a nullable Zod field declared non-optional in Swift fails", () => {
  // control `value` is z.boolean().nullable() -> Bool?; declare it as a
  // non-optional Bool.
  const drifted = REAL_SHARED_STATE.replace(
    "  var value: Bool?\n",
    "  var value: Bool\n",
  );
  const ws = withWorkspace(drifted);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, "expected non-zero exit on optionality mismatch");
    assert.match(r.stdout + r.stderr, /MS036/);
    assert.match(r.stdout + r.stderr, /value/);
    assert.match(r.stdout + r.stderr, /expects Swift type Bool\?/);
  } finally {
    ws.cleanup();
  }
});

test("optionality mismatch: a required Zod field declared optional in Swift fails", () => {
  // standby `headline` is z.string() (required) -> String; declare it as
  // String?. Decoding tolerates the optional but the contract does not.
  const drifted = REAL_SHARED_STATE.replace(
    "struct MobileSurfacesStandbySnapshot: Codable, Hashable {\n  var kind: String\n  var snapshotId: String\n  var surfaceId: String\n  var state: String\n  var presentation: String\n  var tint: String?\n  var headline: String\n",
    "struct MobileSurfacesStandbySnapshot: Codable, Hashable {\n  var kind: String\n  var snapshotId: String\n  var surfaceId: String\n  var state: String\n  var presentation: String\n  var tint: String?\n  var headline: String?\n",
  );
  const ws = withWorkspace(drifted);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, "expected non-zero exit on optionality mismatch");
    assert.match(r.stdout + r.stderr, /MS036/);
    assert.match(r.stdout + r.stderr, /headline/);
    assert.match(r.stdout + r.stderr, /expects Swift type String,/);
  } finally {
    ws.cleanup();
  }
});

test("missing struct: a renamed Swift struct fails the parse with a clear message", () => {
  const drifted = REAL_SHARED_STATE.replace(
    "struct MobileSurfacesWidgetSnapshot",
    "struct MobileSurfacesWidgetSnapshotRenamed",
  );
  const ws = withWorkspace(drifted);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, "expected non-zero exit on missing struct");
    assert.match(r.stdout + r.stderr, /MS036/);
    assert.match(
      r.stdout + r.stderr,
      /Could not parse Swift struct MobileSurfacesWidgetSnapshot/,
    );
  } finally {
    ws.cleanup();
  }
});
