import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  buildPatchedAppJson,
  formatPackageSpec,
  installablePackages,
  patchAppJson,
  renderManualSnippet,
  resolveAppRoot,
  widgetCopyDecision,
} from "../src/apply-existing.mjs";

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-apply-"));
});
afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
});

const samplePlan = {
  packagesToAdd: [],
  appConfigKind: "json",
  appConfigPath: "/test/app.json",
  pluginsToAdd: [
    { name: "@bacons/apple-targets" },
    { name: "expo-build-properties", config: { ios: { deploymentTarget: "16.2" } } },
  ],
  infoPlistToAdd: {
    NSSupportsLiveActivities: true,
    UIBackgroundModes: ["remote-notification"],
  },
  deploymentTargetTo: "16.2",
  appConfigManual: false,
  widgetTargetDir: "apps/mobile/targets/widget",
  widgetFilesToCopy: [],
  willPrebuild: true,
  manualFollowups: [],
};

describe("buildPatchedAppJson — additions", () => {
  it("appends string and array-form plugins after existing entries", () => {
    const existing = JSON.stringify({
      expo: { name: "Host", plugins: ["expo-router"] },
    });
    const patched = JSON.parse(buildPatchedAppJson({ existing, plan: samplePlan }));
    assert.deepEqual(patched.expo.plugins, [
      "expo-router",
      "@bacons/apple-targets",
      ["expo-build-properties", { ios: { deploymentTarget: "16.2" } }],
    ]);
  });

  it("creates expo.ios when missing and writes deploymentTarget + infoPlist", () => {
    const existing = JSON.stringify({ expo: { name: "Host" } });
    const patched = JSON.parse(buildPatchedAppJson({ existing, plan: samplePlan }));
    assert.equal(patched.expo.ios.deploymentTarget, "16.2");
    assert.equal(patched.expo.ios.infoPlist.NSSupportsLiveActivities, true);
    assert.deepEqual(patched.expo.ios.infoPlist.UIBackgroundModes, ["remote-notification"]);
  });

  it("merges into existing infoPlist without dropping pre-existing keys", () => {
    const existing = JSON.stringify({
      expo: {
        ios: {
          deploymentTarget: "15.0",
          infoPlist: { ITSAppUsesNonExemptEncryption: false },
        },
      },
    });
    const patched = JSON.parse(buildPatchedAppJson({ existing, plan: samplePlan }));
    assert.equal(patched.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption, false);
    assert.equal(patched.expo.ios.infoPlist.NSSupportsLiveActivities, true);
    assert.equal(patched.expo.ios.deploymentTarget, "16.2");
  });

  it("is a no-op when the plan has no additions", () => {
    const empty = {
      ...samplePlan,
      pluginsToAdd: [],
      infoPlistToAdd: {},
      deploymentTargetTo: null,
    };
    const existing = JSON.stringify({ expo: { name: "Host" } });
    const patched = JSON.parse(buildPatchedAppJson({ existing, plan: empty }));
    assert.deepEqual(patched, { expo: { name: "Host" } });
  });

  it("ends with a trailing newline (so editors don't fight us on save)", () => {
    const existing = JSON.stringify({ expo: { name: "Host" } });
    const patched = buildPatchedAppJson({ existing, plan: samplePlan });
    assert.equal(patched.endsWith("\n"), true);
  });
});

describe("renderManualSnippet", () => {
  it("emits only the keys that have additions", () => {
    const empty = {
      ...samplePlan,
      pluginsToAdd: [],
      infoPlistToAdd: {},
      deploymentTargetTo: null,
    };
    const snippet = JSON.parse(renderManualSnippet(empty));
    assert.deepEqual(snippet, {});
  });

  it("renders array-form plugins with their config", () => {
    const snippet = JSON.parse(renderManualSnippet(samplePlan));
    assert.deepEqual(snippet.plugins, [
      "@bacons/apple-targets",
      ["expo-build-properties", { ios: { deploymentTarget: "16.2" } }],
    ]);
    assert.equal(snippet.ios.deploymentTarget, "16.2");
  });
});

describe("formatPackageSpec / installablePackages", () => {
  it("formats real versions as name@version", () => {
    assert.equal(formatPackageSpec({ name: "expo-application", version: "~7.0.8" }), "expo-application@~7.0.8");
    assert.equal(formatPackageSpec({ name: "@bacons/apple-targets", version: "4.0.6" }), "@bacons/apple-targets@4.0.6");
  });

  it("drops the version segment for placeholder versions", () => {
    assert.equal(formatPackageSpec({ name: "foo", version: "latest" }), "foo");
    assert.equal(formatPackageSpec({ name: "foo", version: "" }), "foo");
    assert.equal(formatPackageSpec({ name: "foo", version: "workspace" }), "foo");
  });

  it("filters workspace-marked packages out of the install list", () => {
    const plan = {
      packagesToAdd: [
        { name: "@mobile-surfaces/surface-contracts", version: "workspace:*", workspace: true },
        { name: "@bacons/apple-targets", version: "4.0.6" },
        { name: "expo-application", version: "~7.0.8" },
      ],
    };
    assert.deepEqual(installablePackages(plan), [
      "@bacons/apple-targets@4.0.6",
      "expo-application@~7.0.8",
    ]);
  });
});

describe("resolveAppRoot", () => {
  it("uses the directory of evidence.config.path when present", () => {
    assert.equal(
      resolveAppRoot({ cwd: "/wrong", config: { path: "/right/app.json" } }),
      "/right",
    );
  });

  it("falls back to cwd when there's no config", () => {
    assert.equal(resolveAppRoot({ cwd: "/here", config: null }), "/here");
  });
});

describe("patchAppJson — file I/O", () => {
  it("round-trips: read → patch → write produces parseable JSON with the additions", () => {
    const appJsonPath = path.join(tmp, "app.json");
    fs.writeFileSync(
      appJsonPath,
      JSON.stringify({ expo: { name: "Host", ios: { bundleIdentifier: "com.acme" } } }, null, 2),
    );
    patchAppJson({ appJsonPath, plan: samplePlan });
    const reread = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    assert.equal(reread.expo.name, "Host");
    assert.equal(reread.expo.ios.bundleIdentifier, "com.acme");
    assert.equal(reread.expo.ios.deploymentTarget, "16.2");
    assert.equal(reread.expo.plugins.length, 2);
  });
});

describe("widgetCopyDecision", () => {
  it("returns fresh when the dest doesn't exist", () => {
    const dest = path.join(tmp, "targets", "widget");
    assert.equal(widgetCopyDecision({ destDir: dest }).kind, "fresh");
  });

  it("returns empty when the dest exists but has no entries", () => {
    const dest = path.join(tmp, "targets", "widget");
    fs.mkdirSync(dest, { recursive: true });
    assert.equal(widgetCopyDecision({ destDir: dest }).kind, "empty");
  });

  it("returns conflict when the dest has existing files", () => {
    const dest = path.join(tmp, "targets", "widget");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "Existing.swift"), "// hi");
    const decision = widgetCopyDecision({ destDir: dest });
    assert.equal(decision.kind, "conflict");
    assert.deepEqual(decision.entries, ["Existing.swift"]);
  });
});
