// Atomicity contract for the greenfield path: a partial failure must never
// leave a half-formed project at the user's chosen path. We exercise the
// failure path by feeding promoteStaging/rollbackStaging directly — the
// scaffold pipeline itself is covered by the dev-smoke script and the
// existing run-tasks tests, so here we focus on the
// stage → promote-or-rollback edges.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  makeStagingPath,
  promoteStaging,
  rollbackStaging,
} from "../src/scaffold.mjs";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-atomicity-"));
});

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("makeStagingPath", () => {
  it("returns a sibling temp dir that exists and is empty", () => {
    const target = path.join(tmp, "my-project");
    const staging = makeStagingPath(target);
    assert.equal(path.dirname(staging), tmp, "staging must be sibling of target");
    assert.ok(fs.existsSync(staging), "staging dir should exist");
    assert.ok(fs.statSync(staging).isDirectory());
    assert.deepEqual(fs.readdirSync(staging), [], "staging should start empty");
  });

  it("uses a hidden basename so the staging dir doesn't visually clutter cwd", () => {
    const target = path.join(tmp, "my-project");
    const staging = makeStagingPath(target);
    assert.match(
      path.basename(staging),
      /^\.my-project\.staging-/,
      "basename should start with .<name>.staging-",
    );
  });

  it("two calls produce distinct paths so concurrent runs can't collide", () => {
    const target = path.join(tmp, "my-project");
    const a = makeStagingPath(target);
    const b = makeStagingPath(target);
    assert.notEqual(a, b);
  });
});

describe("promoteStaging", () => {
  it("renames staging to target so the final path holds the real tree", () => {
    const target = path.join(tmp, "my-project");
    const staging = makeStagingPath(target);
    fs.writeFileSync(path.join(staging, "marker.txt"), "scaffold");

    promoteStaging({ stagingPath: staging, target });

    assert.ok(fs.existsSync(target), "target should exist after promote");
    assert.ok(!fs.existsSync(staging), "staging should be gone after promote");
    assert.equal(
      fs.readFileSync(path.join(target, "marker.txt"), "utf8"),
      "scaffold",
    );
  });

  it("throws when target already exists (caller is responsible for the empty-dir check)", () => {
    const target = path.join(tmp, "my-project");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "existing.txt"), "user");
    const staging = makeStagingPath(target);

    assert.throws(() => promoteStaging({ stagingPath: staging, target }));
    // Staging stays put on failure so the caller can roll it back.
    assert.ok(fs.existsSync(staging));
    assert.equal(fs.readFileSync(path.join(target, "existing.txt"), "utf8"), "user");
  });
});

describe("rollbackStaging", () => {
  it("removes the staging tree so a partial failure leaves no residue", () => {
    const target = path.join(tmp, "my-project");
    const staging = makeStagingPath(target);
    fs.writeFileSync(path.join(staging, "marker.txt"), "halfway");
    fs.mkdirSync(path.join(staging, "subdir"));
    fs.writeFileSync(path.join(staging, "subdir/nested.txt"), "deep");

    rollbackStaging({ stagingPath: staging });

    assert.ok(!fs.existsSync(staging), "staging should be gone after rollback");
    assert.ok(!fs.existsSync(target), "target was never created — should still be absent");
  });

  it("is silent when staging is already gone (e.g. a prior cleanup ran)", () => {
    // Idempotency matters here because rollback can fire from multiple error
    // paths in bin/index.mjs — never let cleanup itself crash and mask the
    // real error.
    const target = path.join(tmp, "my-project");
    const staging = makeStagingPath(target);
    fs.rmSync(staging, { recursive: true, force: true });
    rollbackStaging({ stagingPath: staging });
    assert.ok(!fs.existsSync(staging));
  });

  it("invokes the log callback when removal fails (instead of throwing)", () => {
    // Stuff a value that isn't a real path into the rollback to force the
    // catch branch. The real-world hit is a permission denial; we don't
    // want to muck with chmod in a test on macOS where root tests vary.
    const messages = [];
    rollbackStaging({
      stagingPath: "\0not-a-valid-path",
      log: (msg) => messages.push(msg),
    });
    assert.equal(messages.length, 1, "log should be called once on failure");
    assert.match(messages[0], /Failed to roll back/);
  });
});
