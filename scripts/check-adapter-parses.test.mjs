// End-to-end tests for scripts/check-adapter-parses.mjs (MS038).
//
// The earlier version of this check grepped for four string markers. The
// 2026-05-21 audit defeated it: it replaced the parse-failure throw with a
// permissive cast and parked a dead `if (false) throw` to keep the marker
// present, and the check still passed. These tests pin the rewritten check
// against that exact gutting and every adjacent one.
//
// Each case starts from the real adapter source and applies one targeted
// mutation, so the fixtures cannot drift from the file they guard. The check
// runs as a subprocess against a synthesized workspace, the same code path CI
// runs.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-adapter-parses.mjs");
const REAL_ADAPTER = join(
  REPO_ROOT,
  "packages",
  "live-activity",
  "src",
  "index.ts",
);

const realSource = readFileSync(REAL_ADAPTER, "utf8");

// Run the check against a workspace whose packages/live-activity/src/index.ts
// holds `source`. Pass source === null to omit the file entirely.
function runCheck(source) {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-parses-"));
  try {
    if (source !== null) {
      const srcDir = join(dir, "packages", "live-activity", "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "index.ts"), source);
    }
    return spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Apply a single string mutation and assert it actually changed the source,
// so a fixture cannot silently become a no-op when the adapter is refactored.
function mutate(find, replaceWith, all = false) {
  const out = all
    ? realSource.replaceAll(find, replaceWith)
    : realSource.replace(find, replaceWith);
  assert.notEqual(
    out,
    realSource,
    `fixture mutation did not match the adapter source: ${JSON.stringify(find)}`,
  );
  return out;
}

test("passes against the real adapter source", () => {
  const r = runCheck(realSource);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /MS038/);
});

test("fails the audit gutting: parse-failure throw replaced by a cast on raw input", () => {
  // The exact defeat the 2026-05-21 audit demonstrated: a dead `if (false)`
  // keeps the throw token present, and the brand is cast straight off the raw
  // input instead of the parsed result.
  const gutted = mutate(
    `  if (!parsed.success) {
    throw new InvalidContentStateError(parsed.error.issues);
  }
  return parsed.data as ParsedContentState;`,
    `  if (false) {
    throw new InvalidContentStateError([]);
  }
  return state as ParsedContentState;`,
  );
  const r = runCheck(gutted);
  assert.notEqual(r.status, 0, "gutted adapter must fail the check");
  assert.match(r.stdout, /brand-from-parse/);
});

test("fails when a second `as ParsedContentState` cast bypasses the choke point", () => {
  // A call site mints its own brand instead of routing through parseContentState.
  const gutted = mutate(
    "const parsed = parseContentState(state);",
    "const parsed = state as ParsedContentState;",
  );
  const r = runCheck(gutted);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /brand-minted-once/);
});

test("fails when the native module no longer requires the brand", () => {
  // Dropping the brand from the native signatures removes the compiler-side
  // guarantee; the check must catch it even though the parse code is intact.
  const gutted = mutate(
    "state: ParsedContentState",
    "state: LiveActivityContentState",
    true,
  );
  const r = runCheck(gutted);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /native-requires-brand/);
});

test("fails when the safeParse call survives only inside a comment", () => {
  // stripNonCode integration: a commented-out parse does not satisfy the gate.
  const gutted = mutate(
    "  const parsed = liveSurfaceActivityContentState.safeParse(state);",
    "  // const parsed = liveSurfaceActivityContentState.safeParse(state);",
  );
  const r = runCheck(gutted);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /brand-from-parse/);
});

test("fails when the safeParse failure branch no longer throws", () => {
  const gutted = mutate(
    `  if (!parsed.success) {
    throw new InvalidContentStateError(parsed.error.issues);
  }
`,
    "",
  );
  const r = runCheck(gutted);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /failure-branch-throws/);
});

test("fails cleanly when the adapter file is missing", () => {
  const r = runCheck(null);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /not found/);
});
