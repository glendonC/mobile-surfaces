// End-to-end tests for scripts/check-activity-attributes.mjs.
//
// We exercise the script as a subprocess against synthesized Swift sources
// in a temp workspace, so the assertions cover the same code path CI runs
// (regex extraction, CodingKeys parsing, Zod parity, diagnostic emission).
// Each test stages packages/live-activity/ios/<name> and
// apps/mobile/targets/widget/<name> Swift files inside a tmp dir; the script
// is invoked with that dir as cwd. Surface-contracts and lib/ resolve
// through symlinks to the real repo so we don't reimplement the schema.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-activity-attributes.mjs");

const REAL_ATTRIBUTES = `// Auto-generated for tests.
import ActivityKit

struct MobileSurfacesActivityAttributes: ActivityAttributes, Sendable {
  public struct ContentState: Codable, Hashable, Sendable {
    var headline: String
    var subhead: String
    var progress: Double
    var stage: Stage
  }

  enum Stage: String, Codable, Hashable, Sendable {
    case prompted
    case inProgress
    case completing
  }

  var surfaceId: String
  var modeLabel: String
}
`;

function withWorkspace(swiftSourceModule, swiftSourceWidget = swiftSourceModule) {
  // The script imports ../packages/surface-contracts/src/schema.ts and
  // ./lib/* relative to its own location, so we only need the input files
  // to exist at the tmp cwd; lib resolves against the real repo.
  const dir = mkdtempSync(join(tmpdir(), "ms-check-attrs-"));
  const moduleDir = join(dir, "packages", "live-activity", "ios");
  const widgetDir = join(dir, "apps", "mobile", "targets", "widget");
  mkdirSync(moduleDir, { recursive: true });
  mkdirSync(widgetDir, { recursive: true });
  writeFileSync(join(moduleDir, "MobileSurfacesActivityAttributes.swift"), swiftSourceModule);
  writeFileSync(join(widgetDir, "MobileSurfacesActivityAttributes.swift"), swiftSourceWidget);
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

test("baseline: byte-identical canonical sources pass", () => {
  const ws = withWorkspace(REAL_ATTRIBUTES);
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[MS002\] ActivityKit attribute definitions are byte-identical/);
    assert.match(r.stdout, /\[MS003\] Swift ContentState matches Zod/);
    assert.match(r.stdout, /\[MS004\] Swift Stage matches Zod/);
  } finally {
    ws.cleanup();
  }
});

test("MS003 catches a CodingKeys raw-value remap on a single property", () => {
  // The whole point of MS003: a `case headline = "title"` decouples Swift
  // identifier from APNs JSON key. Both files stay byte-identical so MS002
  // would not catch it - only the Codable-aware MS003 check does.
  const remapped = REAL_ATTRIBUTES.replace(
    /  public struct ContentState: Codable, Hashable, Sendable \{\n([\s\S]*?)\n  \}/,
    `  public struct ContentState: Codable, Hashable, Sendable {
    var headline: String
    var subhead: String
    var progress: Double
    var stage: Stage

    enum CodingKeys: String, CodingKey {
      case headline = "title"
      case subhead
      case progress
      case stage
    }
  }`,
  );
  const ws = withWorkspace(remapped);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, "expected non-zero exit on MS003 drift");
    assert.match(r.stdout + r.stderr, /MS003/);
    // The Zod side expects "headline"; Swift now serializes it as "title".
    assert.match(r.stdout + r.stderr, /headline/);
    assert.match(r.stdout + r.stderr, /title/);
  } finally {
    ws.cleanup();
  }
});

test("MS003 catches a property excluded from a partial CodingKeys enum", () => {
  const partial = REAL_ATTRIBUTES.replace(
    /  public struct ContentState: Codable, Hashable, Sendable \{\n([\s\S]*?)\n  \}/,
    `  public struct ContentState: Codable, Hashable, Sendable {
    var headline: String
    var subhead: String
    var progress: Double
    var stage: Stage

    enum CodingKeys: String, CodingKey {
      case headline
      case subhead
      case progress
    }
  }`,
  );
  const ws = withWorkspace(partial);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(
      r.stdout + r.stderr,
      /stage|CodingKeys|never reaches the wire/i,
    );
  } finally {
    ws.cleanup();
  }
});

test("MS002 catches drift when only one of the two files is edited", () => {
  const other = REAL_ATTRIBUTES.replace("var headline: String", "var headline: String // edit");
  const ws = withWorkspace(REAL_ATTRIBUTES, other);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /MS002|byte-identical|drifted/i);
  } finally {
    ws.cleanup();
  }
});

test("MS003 still passes when both files are byte-identical AND use CodingKeys with default raw values", () => {
  // CodingKeys present but every case keeps the default jsonKey: this is a
  // no-op-style change that should NOT trip MS003.
  const noOpCodingKeys = REAL_ATTRIBUTES.replace(
    /  public struct ContentState: Codable, Hashable, Sendable \{\n([\s\S]*?)\n  \}/,
    `  public struct ContentState: Codable, Hashable, Sendable {
    var headline: String
    var subhead: String
    var progress: Double
    var stage: Stage

    enum CodingKeys: String, CodingKey {
      case headline
      case subhead
      case progress
      case stage
    }
  }`,
  );
  const ws = withWorkspace(noOpCodingKeys);
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    ws.cleanup();
  }
});

test("MS004 catches an added Stage case missing from Zod", () => {
  const extraCase = REAL_ATTRIBUTES.replace(
    /case completing\n  \}/,
    `case completing
    case extraCase
  }`,
  );
  const ws = withWorkspace(extraCase);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /MS004|stage case|Stage enum/i);
  } finally {
    ws.cleanup();
  }
});
