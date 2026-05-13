// End-to-end tests for scripts/check-ios-gitignore.mjs.
//
// MS029: apps/mobile/ios/ must be gitignored and have no tracked files. The
// two checks are independent; both must be exercised separately, including
// the trickier "ignored but already tracked" state that git's normal
// check-ignore behavior would mask without --no-index.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-ios-gitignore.mjs");

function gitRepo({ gitignore = "", trackedIosPodfile = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-ios-ign-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "test"], { cwd: dir });
  mkdirSync(join(dir, "apps/mobile"), { recursive: true });
  if (gitignore) {
    writeFileSync(join(dir, "apps/mobile/.gitignore"), gitignore);
    spawnSync("git", ["add", "apps/mobile/.gitignore"], { cwd: dir });
  }
  if (trackedIosPodfile) {
    mkdirSync(join(dir, "apps/mobile/ios"), { recursive: true });
    writeFileSync(join(dir, "apps/mobile/ios/Podfile"), "platform :ios\n");
    spawnSync("git", ["add", "-f", "apps/mobile/ios/Podfile"], { cwd: dir });
  }
  spawnSync("git", ["commit", "-q", "-m", "init", "--allow-empty"], { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runCheck(cwd) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

test("baseline: path ignored, no tracked files", () => {
  const ws = gitRepo({ gitignore: "/ios\n" });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /is gitignored/);
    assert.match(r.stdout, /no tracked files/);
  } finally {
    ws.cleanup();
  }
});

test("baseline still passes when the ios/ directory does not yet exist", () => {
  // Clean checkout before first prebuild: the directory is absent on disk
  // but the rule still applies. The check must work via the path string
  // alone, not by stat()ing the dir.
  const ws = gitRepo({ gitignore: "/ios\n" });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    ws.cleanup();
  }
});

test("flags a missing gitignore rule", () => {
  const ws = gitRepo({ gitignore: "" });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /MS029/);
    assert.match(r.stdout + r.stderr, /not gitignored/);
  } finally {
    ws.cleanup();
  }
});

test("flags tracked files even when the ignore rule is in place", () => {
  // This is the dual-state failure: someone added /ios to .gitignore after
  // the files were already tracked. The ignore takes effect for new files
  // only; the existing entries stay tracked until `git rm -r --cached`.
  // The --no-index flag in the check is load-bearing here — without it,
  // git's normal check-ignore would also report "not ignored" because the
  // path is in the index, collapsing both checks into one confusing
  // failure.
  const ws = gitRepo({ gitignore: "/ios\n", trackedIosPodfile: true });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /is gitignored/);
    assert.match(r.stdout + r.stderr, /tracked file/);
    assert.match(r.stdout + r.stderr, /apps\/mobile\/ios\/Podfile/);
  } finally {
    ws.cleanup();
  }
});

test("flags the both-broken state (no ignore + tracked files)", () => {
  const ws = gitRepo({ gitignore: "", trackedIosPodfile: true });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /not gitignored/);
    assert.match(r.stdout + r.stderr, /tracked file/);
  } finally {
    ws.cleanup();
  }
});

test("emits a valid DiagnosticReport in --json mode", () => {
  const ws = gitRepo({ gitignore: "/ios\n" });
  try {
    const r = spawnSync(process.execPath, [SCRIPT, "--json"], {
      cwd: ws.dir,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.schemaVersion, "1");
    assert.equal(report.tool, "check-ios-gitignore");
    assert.equal(report.status, "ok");
    assert.equal(report.checks.length, 2);
    assert.ok(report.checks.every((c) => c.trapId === "MS029"));
  } finally {
    ws.cleanup();
  }
});
