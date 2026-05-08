import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { applyAppleTeamId, applyNewArchEnabled } from "../src/scaffold.mjs";

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

describe("applyAppleTeamId", () => {
  it("writes the team id when one is provided", () => {
    const p = writeAppJson({ expo: { ios: { bundleIdentifier: "com.acme.foo" } } });
    const ok = applyAppleTeamId({ target: tmp, teamId: "ABCDE12345" });
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
    const ok = applyAppleTeamId({ target: tmp, teamId: null });
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
    const ok = applyAppleTeamId({ target: tmp, teamId: null });
    assert.equal(ok, false, "no-op when not placeholder and no new value");
    const j = JSON.parse(
      fs.readFileSync(path.join(tmp, "apps/mobile/app.json"), "utf8"),
    );
    assert.equal(j.expo.ios.appleTeamId, "REALTEAM01");
  });

  it("returns false when apps/mobile/app.json is missing", () => {
    assert.equal(
      applyAppleTeamId({ target: tmp, teamId: "ABCDE12345" }),
      false,
    );
  });
});

describe("applyNewArchEnabled", () => {
  it("writes expo.newArchEnabled when set to true", () => {
    const p = writeAppJson({ expo: { name: "foo" } });
    const ok = applyNewArchEnabled({ target: tmp, newArchEnabled: true });
    assert.equal(ok, true);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.equal(j.expo.newArchEnabled, true);
  });

  it("writes expo.newArchEnabled when set to false (legacy bridge opt-out)", () => {
    const p = writeAppJson({ expo: { name: "foo" } });
    const ok = applyNewArchEnabled({ target: tmp, newArchEnabled: false });
    assert.equal(ok, true);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.equal(j.expo.newArchEnabled, false);
  });

  it("returns false when apps/mobile/app.json is missing", () => {
    assert.equal(
      applyNewArchEnabled({ target: tmp, newArchEnabled: true }),
      false,
    );
  });
});
