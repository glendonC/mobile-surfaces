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
  addEntitlements: {
    "com.apple.security.application-groups": ["group.com.example.mobilesurfaces"],
  },
  widgetTargetDir: "apps/mobile/targets/widget",
  widgetFiles: ["apps/mobile/targets/widget/Widget.swift"],
};

// Manifest variant matching the real shape: Live Activity + Home + Control
// widget swift files. Used by the surface-picker tests below to verify
// per-selection filtering.
const fullWidgetManifest = {
  ...sampleManifest,
  widgetFiles: [
    "apps/mobile/targets/widget/Assets.xcassets",
    "apps/mobile/targets/widget/Info.plist",
    "apps/mobile/targets/widget/MobileSurfacesActivityAttributes.swift",
    "apps/mobile/targets/widget/MobileSurfacesControlWidget.swift",
    "apps/mobile/targets/widget/MobileSurfacesHomeWidget.swift",
    "apps/mobile/targets/widget/MobileSurfacesLiveActivity.swift",
    "apps/mobile/targets/widget/MobileSurfacesWidgetBundle.swift",
    "apps/mobile/targets/widget/expo-target.config.js",
  ],
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
    assert.deepEqual(plan.entitlementsToAdd, sampleManifest.addEntitlements);
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

  it("dedupes entitlements that already have any value", () => {
    const evidence = evidenceWithJsonConfig({
      ios: {
        bundleIdentifier: "com.acme.partial",
        entitlements: {
          "com.apple.security.application-groups": ["group.com.acme.existing"],
        },
      },
    });
    const plan = planChanges({ evidence, manifest: sampleManifest });
    assert.deepEqual(plan.entitlementsToAdd, {});
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
        entitlements: {
          "com.apple.security.application-groups": ["group.com.example.mobilesurfaces"],
        },
      },
      plugins: ["@bacons/apple-targets", "expo-build-properties"],
    });
    const plan = planChanges({ evidence, manifest: sampleManifest });

    assert.equal(plan.pluginsToAdd.length, 0);
    assert.deepEqual(plan.infoPlistToAdd, {});
    assert.deepEqual(plan.entitlementsToAdd, {});
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
    assert.deepEqual(plan.entitlementsToAdd, sampleManifest.addEntitlements);
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

describe("planChanges — surface picker", () => {
  it("defaults to all surfaces when no selection is provided", () => {
    const evidence = evidenceWithJsonConfig({ ios: { bundleIdentifier: "x" } });
    const plan = planChanges({ evidence, manifest: fullWidgetManifest });
    assert.deepEqual(plan.surfaces, { homeWidget: true, controlWidget: true });
    assert.ok(
      plan.widgetFilesToCopy.some((p) => p.endsWith("MobileSurfacesHomeWidget.swift")),
    );
    assert.ok(
      plan.widgetFilesToCopy.some((p) => p.endsWith("MobileSurfacesControlWidget.swift")),
    );
  });

  it("drops MobileSurfacesHomeWidget.swift from widgetFilesToCopy when homeWidget is off", () => {
    const evidence = evidenceWithJsonConfig({ ios: { bundleIdentifier: "x" } });
    const plan = planChanges({
      evidence,
      manifest: fullWidgetManifest,
      surfaces: { homeWidget: false, controlWidget: true },
    });
    assert.equal(
      plan.widgetFilesToCopy.some((p) => p.endsWith("MobileSurfacesHomeWidget.swift")),
      false,
    );
    assert.ok(
      plan.widgetFilesToCopy.some((p) => p.endsWith("MobileSurfacesControlWidget.swift")),
    );
  });

  it("drops MobileSurfacesControlWidget.swift when controlWidget is off", () => {
    const evidence = evidenceWithJsonConfig({ ios: { bundleIdentifier: "x" } });
    const plan = planChanges({
      evidence,
      manifest: fullWidgetManifest,
      surfaces: { homeWidget: true, controlWidget: false },
    });
    assert.ok(
      plan.widgetFilesToCopy.some((p) => p.endsWith("MobileSurfacesHomeWidget.swift")),
    );
    assert.equal(
      plan.widgetFilesToCopy.some((p) => p.endsWith("MobileSurfacesControlWidget.swift")),
      false,
    );
  });

  it("keeps the LiveActivity, ActivityAttributes, and bundle Swift files regardless of selection", () => {
    const evidence = evidenceWithJsonConfig({ ios: { bundleIdentifier: "x" } });
    const plan = planChanges({
      evidence,
      manifest: fullWidgetManifest,
      surfaces: { homeWidget: false, controlWidget: false },
    });
    const remainingBaseNames = plan.widgetFilesToCopy.map((p) =>
      p.split("/").pop(),
    );
    assert.ok(remainingBaseNames.includes("MobileSurfacesActivityAttributes.swift"));
    assert.ok(remainingBaseNames.includes("MobileSurfacesLiveActivity.swift"));
    assert.ok(remainingBaseNames.includes("MobileSurfacesWidgetBundle.swift"));
  });

  it("threads the selections through to plan.surfaces", () => {
    const evidence = evidenceWithJsonConfig({ ios: { bundleIdentifier: "x" } });
    const plan = planChanges({
      evidence,
      manifest: fullWidgetManifest,
      surfaces: { homeWidget: false, controlWidget: true },
    });
    assert.deepEqual(plan.surfaces, { homeWidget: false, controlWidget: true });
  });
});
