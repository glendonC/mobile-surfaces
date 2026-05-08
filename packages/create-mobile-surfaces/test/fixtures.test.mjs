import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import { detectMode, MODE } from "../src/mode.mjs";
import { planChanges } from "../src/existing-expo.mjs";
import { planMonorepoScaffold } from "../src/existing-monorepo.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

const sampleManifest = {
  cliRequiredNode: ">=24.0.0 <25",
  deploymentTarget: "17.2",
  minimumXcodeMajor: 26,
  addPackages: [
    { name: "@mobile-surfaces/surface-contracts", version: "1.3.0" },
    { name: "@mobile-surfaces/live-activity", version: "1.3.0", workspace: true },
    { name: "@bacons/apple-targets", version: "4.0.6" },
  ],
  addPlugins: [{ name: "@bacons/apple-targets" }],
  addInfoPlist: { NSSupportsLiveActivities: true },
  addEntitlements: {
    "com.apple.security.application-groups": ["group.com.example.mobilesurfaces"],
  },
  widgetTargetDir: "apps/mobile/targets/widget",
  widgetFiles: ["apps/mobile/targets/widget/Widget.swift"],
};

let tmp;
let savedUserAgent;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-fixture-"));
  // detectPackageManager checks the user-agent first; suppress so the
  // fixtures' own files (or absence of a lockfile) are the source of truth.
  savedUserAgent = process.env.npm_config_user_agent;
  delete process.env.npm_config_user_agent;
});

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  if (savedUserAgent !== undefined) {
    process.env.npm_config_user_agent = savedUserAgent;
  }
});

function copyFixture(name) {
  fs.cpSync(path.join(FIXTURES, name), tmp, { recursive: true });
}

describe("fixture: empty-greenfield", () => {
  it("detects greenfield with target=null when no positional name given", () => {
    copyFixture("empty-greenfield");
    const mode = detectMode({ cwd: tmp, targetName: undefined });
    assert.equal(mode.kind, MODE.GREENFIELD);
    assert.equal(mode.target, null);
  });

  it("detects greenfield with derived sibling target when a name is given", () => {
    copyFixture("empty-greenfield");
    const mode = detectMode({ cwd: tmp, targetName: "my-app" });
    assert.equal(mode.kind, MODE.GREENFIELD);
    assert.equal(mode.target, path.join(tmp, "my-app"));
    assert.equal(mode.explicitName, "my-app");
  });
});

describe("fixture: existing-expo-bare", () => {
  it("detects EXISTING_EXPO and surfaces config + bundleId from app.json", () => {
    copyFixture("existing-expo-bare");
    const mode = detectMode({ cwd: tmp, targetName: undefined });
    assert.equal(mode.kind, MODE.EXISTING_EXPO);
    assert.equal(mode.evidence.packageName, "demo-expo-app");
    assert.equal(mode.evidence.expoVersion, "^55.0.0");
    assert.equal(mode.evidence.config?.kind, "json");
    assert.equal(mode.evidence.config?.bundleId, "com.demo.expoapp");
  });

  it("planChanges produces a plan keyed off the fixture's app.json", () => {
    copyFixture("existing-expo-bare");
    const mode = detectMode({ cwd: tmp, targetName: undefined });
    const plan = planChanges({ evidence: mode.evidence, manifest: sampleManifest });
    // Existing config is JSON, not js/ts — plan should NOT route through the
    // appConfigManual branch.
    assert.equal(plan.appConfigManual, false);
    assert.deepEqual(
      plan.pluginsToAdd.map((p) => p.name),
      ["@bacons/apple-targets"],
    );
    // Fixture's app.json has no NSSupportsLiveActivities, so it should be added.
    assert.equal(plan.infoPlistToAdd.NSSupportsLiveActivities, true);
    // Fixture has no ios.deploymentTarget; manifest targets 17.2.
    assert.equal(plan.deploymentTargetTo, "17.2");
  });
});

describe("fixture: existing-monorepo-no-expo", () => {
  it("detects EXISTING_MONOREPO_NO_EXPO via pnpm-workspace.yaml", () => {
    copyFixture("existing-monorepo-no-expo");
    const mode = detectMode({ cwd: tmp, targetName: undefined });
    assert.equal(mode.kind, MODE.EXISTING_MONOREPO_NO_EXPO);
    assert.equal(mode.evidence.workspaceKind, "pnpm-workspace");
    assert.deepEqual(mode.evidence.workspaceGlobs, ["packages/*"]);
    assert.equal(mode.evidence.packageName, "demo-monorepo");
  });

  it("an explicit positional name still routes to monorepo (not greenfield)", () => {
    // Regression guard for the bug noted in mode.mjs: --yes always passes a
    // name, but a workspace-without-Expo cwd should still get the monorepo
    // flow, not be reinterpreted as a sibling-greenfield request.
    copyFixture("existing-monorepo-no-expo");
    const mode = detectMode({ cwd: tmp, targetName: "my-mobile" });
    assert.equal(mode.kind, MODE.EXISTING_MONOREPO_NO_EXPO);
  });

  it("planMonorepoScaffold appends apps/* glob (fixture only declares packages/*)", () => {
    copyFixture("existing-monorepo-no-expo");
    const mode = detectMode({ cwd: tmp, targetName: undefined });
    const plan = planMonorepoScaffold({
      evidence: mode.evidence,
      manifest: sampleManifest,
      config: {
        projectName: "lockscreen-demo",
        scheme: "lockscreendemo",
        bundleId: "com.demo.lockscreen",
        teamId: null,
        surfaces: { homeWidget: true, controlWidget: true },
        installNow: true,
      },
    });
    assert.deepEqual(plan.workspaceGlobsToAdd, ["apps/*"]);
    assert.equal(plan.workspaceKind, "pnpm-workspace");
    assert.equal(plan.appsMobileDest, path.join(tmp, "apps", "mobile"));
    // workspace:true packages should land in packagesSkipped, not packagesToInstall.
    assert.ok(plan.packagesSkipped.includes("@mobile-surfaces/live-activity"));
    assert.ok(plan.packagesToInstall.includes("@mobile-surfaces/surface-contracts"));
    assert.ok(!plan.packagesToInstall.includes("@mobile-surfaces/live-activity"));
  });

  it("planMonorepoScaffold does NOT append apps/* when the fixture already declares it", () => {
    copyFixture("existing-monorepo-no-expo");
    // Edit the workspace file in the tmp copy to also declare apps/*.
    fs.writeFileSync(
      path.join(tmp, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n  - 'apps/*'\n",
    );
    const mode = detectMode({ cwd: tmp, targetName: undefined });
    const plan = planMonorepoScaffold({
      evidence: mode.evidence,
      manifest: sampleManifest,
      config: {
        projectName: "lockscreen-demo",
        scheme: "lockscreendemo",
        bundleId: "com.demo.lockscreen",
        teamId: null,
        surfaces: { homeWidget: true, controlWidget: true },
        installNow: true,
      },
    });
    assert.deepEqual(plan.workspaceGlobsToAdd, []);
  });
});
