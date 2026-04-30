import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ensurePnpmAvailable, PNPM_MISSING_TAG } from "../src/run-tasks.mjs";

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
