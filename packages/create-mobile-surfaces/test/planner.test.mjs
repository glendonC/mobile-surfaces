import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { planChanges } from "../src/existing-expo.mjs";

const sampleManifest = {
  cliRequiredNode: ">=24.0.0 <25",
  deploymentTarget: "17.2",
  minimumXcodeMajor: 26,
  addPackages: [
    { name: "@mobile-surfaces/surface-contracts", version: "workspace:*" },
    { name: "@bacons/apple-targets", version: "4.0.6" },
  ],
  addPlugins: [
    { name: "@bacons/apple-targets" },
    { name: "expo-build-properties", config: { ios: { deploymentTarget: "17.2" } } },
  ],
  addInfoPlist: {
    NSSupportsLiveActivities: true,
    NSSupportsLiveActivitiesFrequentUpdates: true,
  },
  widgetTargetDir: "apps/mobile/targets/widget",
  widgetFiles: ["apps/mobile/targets/widget/Widget.swift"],
};

function evidenceWithJsonConfig(parsed) {
  return {
    cwd: "/test",
    packageName: "test",
    expoVersion: "~54.0.0",
    config: { kind: "json", path: "/test/app.json", parsed },
    packageManager: "pnpm",
    hasIosDir: false,
    pluginsPresent: (parsed.plugins ?? []).map((p) =>
      Array.isArray(p) ? p[0] : p,
    ),
  };
}

describe("planChanges — clean Expo app", () => {
  it("plans full additions when nothing is wired", () => {
    const evidence = evidenceWithJsonConfig({
      name: "Clean App",
      ios: { bundleIdentifier: "com.acme.clean" },
    });
    const plan = planChanges({ evidence, manifest: sampleManifest });

    assert.equal(plan.packagesToAdd.length, 2);
    assert.equal(plan.pluginsToAdd.length, 2);
    assert.deepEqual(plan.infoPlistToAdd, sampleManifest.addInfoPlist);
    assert.equal(plan.deploymentTargetTo, "17.2");
    assert.equal(plan.appConfigManual, false);
  });
});

describe("planChanges — partial existing wiring", () => {
  it("dedupes plugins that are already present", () => {
    const evidence = evidenceWithJsonConfig({
      ios: { bundleIdentifier: "com.acme.partial" },
      plugins: ["@bacons/apple-targets"],
    });
    const plan = planChanges({ evidence, manifest: sampleManifest });
    assert.equal(plan.pluginsToAdd.length, 1);
    assert.equal(plan.pluginsToAdd[0].name, "expo-build-properties");
  });

  it("handles array-form plugin entries (with config) when deduping", () => {
    const evidence = evidenceWithJsonConfig({
      plugins: [["@bacons/apple-targets", { extraConfig: true }]],
    });
    const plan = planChanges({ evidence, manifest: sampleManifest });
    assert.deepEqual(
      plan.pluginsToAdd.map((p) => p.name),
      ["expo-build-properties"],
    );
  });

  it("dedupes Info.plist keys that already have any value", () => {
    const evidence = evidenceWithJsonConfig({
      ios: {
        bundleIdentifier: "com.acme.partial",
        infoPlist: { NSSupportsLiveActivities: true },
      },
    });
    const plan = planChanges({ evidence, manifest: sampleManifest });
    assert.deepEqual(Object.keys(plan.infoPlistToAdd), [
      "NSSupportsLiveActivitiesFrequentUpdates",
    ]);
  });

  it("does not bump deployment target when current is equal", () => {
    const evidence = evidenceWithJsonConfig({
      ios: { bundleIdentifier: "com.acme.x", deploymentTarget: "17.2" },
    });
    const plan = planChanges({ evidence, manifest: sampleManifest });
    assert.equal(plan.deploymentTargetTo, null);
  });

  it("does not bump deployment target when current is higher", () => {
    const evidence = evidenceWithJsonConfig({
      ios: { bundleIdentifier: "com.acme.x", deploymentTarget: "18.0" },
    });
    const plan = planChanges({ evidence, manifest: sampleManifest });
    assert.equal(plan.deploymentTargetTo, null);
  });

  it("bumps deployment target when current is lower", () => {
    const evidence = evidenceWithJsonConfig({
      ios: { bundleIdentifier: "com.acme.x", deploymentTarget: "15.0" },
    });
    const plan = planChanges({ evidence, manifest: sampleManifest });
    assert.equal(plan.deploymentTargetTo, "17.2");
  });
});

describe("planChanges — already fully wired (no-op delta)", () => {
  it("produces an empty additions plan", () => {
    const evidence = evidenceWithJsonConfig({
      ios: {
        bundleIdentifier: "com.acme.full",
        deploymentTarget: "17.2",
        infoPlist: {
          NSSupportsLiveActivities: true,
          NSSupportsLiveActivitiesFrequentUpdates: true,
        },
      },
      plugins: ["@bacons/apple-targets", "expo-build-properties"],
    });
    const plan = planChanges({ evidence, manifest: sampleManifest });

    assert.equal(plan.pluginsToAdd.length, 0);
    assert.deepEqual(plan.infoPlistToAdd, {});
    assert.equal(plan.deploymentTargetTo, null);
  });
});

describe("planChanges — manual patch path", () => {
  it("flags app.config.ts as needing a hand-applied diff", () => {
    const evidence = {
      cwd: "/test",
      packageName: "test",
      expoVersion: "~54.0.0",
      config: { kind: "ts", path: "/test/app.config.ts" },
      packageManager: "pnpm",
      hasIosDir: false,
      pluginsPresent: [],
    };
    const plan = planChanges({ evidence, manifest: sampleManifest });
    assert.equal(plan.appConfigManual, true);
    assert.equal(plan.pluginsToAdd.length, 2);
    assert.deepEqual(plan.infoPlistToAdd, sampleManifest.addInfoPlist);
    assert.match(
      plan.manualFollowups[0],
      /Apply the app\.config\.ts changes/,
    );
  });

  it("flags missing config the same way", () => {
    const evidence = {
      cwd: "/test",
      packageName: "test",
      expoVersion: "~54.0.0",
      config: null,
      packageManager: "pnpm",
      hasIosDir: false,
      pluginsPresent: [],
    };
    const plan = planChanges({ evidence, manifest: sampleManifest });
    assert.equal(plan.appConfigManual, true);
    assert.match(plan.manualFollowups[0], /Create an app\.json/);
  });
});

describe("planChanges — ios/ folder warning", () => {
  it("adds a manual followup when ios/ already exists", () => {
    const evidence = evidenceWithJsonConfig({ ios: { bundleIdentifier: "x" } });
    evidence.hasIosDir = true;
    const plan = planChanges({ evidence, manifest: sampleManifest });
    assert.ok(
      plan.manualFollowups.some((f) => f.includes("ios/ folder will be regenerated")),
    );
  });
});
