import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { applyAppJsonPatches, runStreamed } from "../src/scaffold.mjs";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-scaffold-"));
});

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
});

function writeAppJson(contents) {
  const p = path.join(tmp, "apps", "mobile", "app.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(contents, null, 2) + "\n");
  return p;
}

describe("applyAppJsonPatches - teamId", () => {
  it("writes the team id when one is provided", () => {
    const p = writeAppJson({ expo: { ios: { bundleIdentifier: "com.acme.foo" } } });
    const ok = applyAppJsonPatches({ target: tmp, teamId: "ABCDE12345" });
    assert.equal(ok, true);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.equal(j.expo.ios.appleTeamId, "ABCDE12345");
  });

  it("strips the XXXXXXXXXX placeholder when no team id is provided", () => {
    const p = writeAppJson({
      expo: {
        ios: {
          bundleIdentifier: "com.acme.foo",
          appleTeamId: "XXXXXXXXXX",
        },
      },
    });
    const ok = applyAppJsonPatches({ target: tmp, teamId: null });
    assert.equal(ok, true);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.ok(!("appleTeamId" in j.expo.ios), "placeholder should be stripped");
    assert.equal(
      j.expo.ios.bundleIdentifier,
      "com.acme.foo",
      "siblings preserved",
    );
  });

  it("leaves a real team id alone when no team id is provided", () => {
    // Defensive: if someone re-runs the rename on a project that already has
    // a real team id and they don't pass --team-id, don't accidentally wipe
    // the existing value. Only the literal placeholder is stripped.
    writeAppJson({
      expo: { ios: { appleTeamId: "REALTEAM01" } },
    });
    const ok = applyAppJsonPatches({ target: tmp, teamId: null });
    assert.equal(ok, false, "no-op when not placeholder and no new value");
    const j = JSON.parse(
      fs.readFileSync(path.join(tmp, "apps/mobile/app.json"), "utf8"),
    );
    assert.equal(j.expo.ios.appleTeamId, "REALTEAM01");
  });

  it("returns false when apps/mobile/app.json is missing", () => {
    assert.equal(
      applyAppJsonPatches({ target: tmp, teamId: "ABCDE12345" }),
      false,
    );
  });
});

describe("runStreamed - error shape", () => {
  // bin/index.mjs branches on err.exitCode and err.command to render the
  // right user-facing failure copy (install vs prebuild vs template extract).
  // Pin both fields so a refactor can't silently drop one.
  it("rejects with exitCode and command set when the child exits non-zero", async () => {
    let caught;
    try {
      await runStreamed("node", ["-e", "process.exit(7)"]);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected runStreamed to reject");
    assert.equal(caught.exitCode, 7);
    assert.equal(caught.command, "node -e process.exit(7)");
    assert.match(caught.message, /node exited with code 7/);
  });

  it("resolves silently on exit code 0", async () => {
    await runStreamed("node", ["-e", "process.exit(0)"]);
  });
});

describe("applyAppJsonPatches - newArchEnabled", () => {
  it("writes expo.newArchEnabled when set to true", () => {
    const p = writeAppJson({ expo: { name: "foo" } });
    const ok = applyAppJsonPatches({ target: tmp, newArchEnabled: true });
    assert.equal(ok, true);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.equal(j.expo.newArchEnabled, true);
  });

  it("writes expo.newArchEnabled when set to false (legacy bridge opt-out)", () => {
    const p = writeAppJson({ expo: { name: "foo" } });
    const ok = applyAppJsonPatches({ target: tmp, newArchEnabled: false });
    assert.equal(ok, true);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.equal(j.expo.newArchEnabled, false);
  });

  it("returns false when apps/mobile/app.json is missing", () => {
    assert.equal(
      applyAppJsonPatches({ target: tmp, newArchEnabled: true }),
      false,
    );
  });
});

describe("applyAppJsonPatches - combined", () => {
  // The production caller (renameIdentity in scaffold.mjs) passes both
  // teamId and newArchEnabled in one call. Pin that they coalesce into
  // a single read-modify-write rather than two.
  it("writes both teamId and newArchEnabled in a single pass", () => {
    const p = writeAppJson({ expo: { ios: { bundleIdentifier: "com.acme.foo" } } });
    const ok = applyAppJsonPatches({
      target: tmp,
      teamId: "ABCDE12345",
      newArchEnabled: false,
    });
    assert.equal(ok, true);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.equal(j.expo.ios.appleTeamId, "ABCDE12345");
    assert.equal(j.expo.newArchEnabled, false);
  });
});
