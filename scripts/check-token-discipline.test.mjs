// End-to-end tests for scripts/check-token-discipline.mjs (MS039).
//
// MS039 requires app code under apps/*/src/ to route ActivityKit token
// subscriptions through @mobile-surfaces/tokens rather than calling
// adapter.addListener("onPushToken", ...) directly. The check flags the
// presence of a forbidden call: unlike a required-marker grep, a forbidden
// call that is present is itself the violation, so the check is sound for
// every direct form. Its one known gap is variable-indirected event names,
// documented below with a fixture, the same posture as MS001's boundary check.
//
// The check runs as a subprocess against a synthesized apps/ tree.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-token-discipline.mjs");

// `files` maps a path under apps/mobile/src to its contents. Pass
// files === null to create no apps/ directory at all.
function runCheck(files) {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-token-"));
  try {
    if (files !== null) {
      const srcRoot = join(dir, "apps", "mobile", "src");
      for (const [relPath, contents] of Object.entries(files)) {
        const full = join(srcRoot, relPath);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, contents);
      }
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

test("passes when app code routes token subscriptions through the token store", () => {
  const r = runCheck({
    "screens/Live.tsx":
      'import { useTokenStore } from "@mobile-surfaces/tokens/react";\n' +
      "export function Live() { return useTokenStore(); }\n",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Token discipline intact/);
});

test("flags a direct adapter.addListener(\"onPushToken\", ...) call in app code", () => {
  const r = runCheck({
    "screens/Live.tsx":
      'adapter.addListener("onPushToken", (p) => log(p.token));\n',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /MS039|Live\.tsx/);
});

test("flags each of the three token events", () => {
  for (const event of [
    "onPushToken",
    "onPushToStartToken",
    "onActivityStateChange",
  ]) {
    const r = runCheck({
      "screens/Live.tsx": `adapter.addListener("${event}", handler);\n`,
    });
    assert.notEqual(r.status, 0, `${event} must be flagged`);
  }
});

test("does not flag a subscription that survives only inside a comment", () => {
  const r = runCheck({
    "screens/Live.tsx":
      '// adapter.addListener("onPushToken", handler);\nexport const x = 1;\n',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("does not flag an addListener call that sits entirely inside a string literal", () => {
  const r = runCheck({
    "docs/example.ts":
      'export const snippet = `adapter.addListener("onPushToken", handler)`;\n',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("flags a variable-indirected event name bound to a token event", () => {
  // adapter.addListener(ev, ...) where `ev` is locally bound to a token-event
  // string literal. The earlier check shipped this as a documented gap; the
  // structural hardening resolves locally bound event-name identifiers, so
  // aliasing the event name through a const no longer evades the gate.
  const r = runCheck({
    "screens/Live.tsx":
      'const ev = "onPushToken";\nadapter.addListener(ev, handler);\n',
  });
  assert.notEqual(r.status, 0, "indirected token event must be flagged");
  assert.match(r.stdout, /MS039|Live\.tsx/);
});

test("flags a variable-indirected event name via a namespace-imported adapter", () => {
  // The exact aliased-import shape: `import * as LA` then a token
  // subscription on the namespaced adapter, with the event name itself
  // indirected through a const. Both the alias and the indirection are
  // resolved structurally.
  const r = runCheck({
    "screens/Live.tsx":
      'import * as LA from "@mobile-surfaces/live-activity";\n' +
      'const EV = "onPushToStartToken";\n' +
      "LA.liveActivityAdapter.addListener(EV, handler);\n",
  });
  assert.notEqual(r.status, 0, "namespaced + indirected subscription must be flagged");
  assert.match(r.stdout, /MS039|Live\.tsx/);
});

test("flags a let/typed binding indirected event name", () => {
  const r = runCheck({
    "screens/Live.tsx":
      'let ev: string = "onActivityStateChange";\nadapter.addListener(ev, handler);\n',
  });
  assert.notEqual(r.status, 0);
});

test("does not flag an indirected identifier bound to a NON-token event", () => {
  // The indirection resolver must only fire for the three token events; a
  // const bound to some other event name is not an MS039 violation.
  const r = runCheck({
    "screens/Live.tsx":
      'const ev = "onSomethingElse";\nadapter.addListener(ev, handler);\n',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("does not flag an addListener whose identifier arg is never bound to a token event", () => {
  // A bare-identifier addListener call with no local token-event binding is
  // not resolvable to a token subscription and must not be flagged.
  const r = runCheck({
    "screens/Live.tsx":
      "export function sub(ev) { adapter.addListener(ev, handler); }\n",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("does not flag an indirected event name that survives only inside a comment", () => {
  // stripNonCode integration on the indirect path: a commented-out binding
  // does not make the call a violation.
  const r = runCheck({
    "screens/Live.tsx":
      '// const ev = "onPushToken";\nexport const x = 1;\n',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("ok when there is no apps/ directory", () => {
  const r = runCheck(null);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
