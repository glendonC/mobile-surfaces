import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  COCOAPODS_MISSING_TAG,
  ensureCocoapodsAvailable,
  ensurePnpmAvailable,
  PNPM_MISSING_TAG,
} from "../src/run-tasks.mjs";

describe("ensurePnpmAvailable", () => {
  it("resolves silently when pnpm -v works", async () => {
    const exec = async (cmd, args) => {
      assert.equal(cmd, "pnpm");
      assert.deepEqual(args, ["-v"]);
      return { stdout: "10.7.1\n", stderr: "" };
    };
    await ensurePnpmAvailable({ exec });
  });

  it("throws a tagged error pointing at corepack when pnpm is missing", async () => {
    const exec = async () => {
      const err = new Error("spawn pnpm ENOENT");
      err.code = "ENOENT";
      throw err;
    };
    let caught;
    try {
      await ensurePnpmAvailable({ exec });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected ensurePnpmAvailable to throw");
    assert.equal(caught.tag, PNPM_MISSING_TAG);
    assert.match(caught.message, /pnpm not found on PATH/);
    assert.match(caught.message, /corepack enable pnpm/);
    // The original ENOENT is preserved as the cause so the install log
    // shows what actually failed.
    assert.ok(caught.cause, "expected the original error to be chained");
    assert.equal(caught.cause.code, "ENOENT");
  });
});

describe("ensureCocoapodsAvailable", () => {
  it("resolves silently when pod --version works", async () => {
    const exec = async (cmd, args) => {
      assert.equal(cmd, "pod");
      assert.deepEqual(args, ["--version"]);
      return { stdout: "1.16.2\n", stderr: "" };
    };
    await ensureCocoapodsAvailable({ exec });
  });

  it("throws a tagged error pointing at brew/gem when pods is missing", async () => {
    const exec = async () => {
      const err = new Error("spawn pod ENOENT");
      err.code = "ENOENT";
      throw err;
    };
    let caught;
    try {
      await ensureCocoapodsAvailable({ exec });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected ensureCocoapodsAvailable to throw");
    assert.equal(caught.tag, COCOAPODS_MISSING_TAG);
    assert.match(caught.message, /CocoaPods not found on PATH/);
    // Both install paths should appear so the user can pick whichever
    // package manager they already use.
    assert.match(caught.message, /brew install cocoapods/);
    assert.match(caught.message, /gem install cocoapods/);
    assert.ok(caught.cause, "expected the original error to be chained");
    assert.equal(caught.cause.code, "ENOENT");
  });
});
