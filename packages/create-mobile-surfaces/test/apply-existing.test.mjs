import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  applyWidgetRename,
  buildPatchedAppJson,
  deriveSwiftPrefixFromEvidence,
  formatPackageSpec,
  installablePackages,
  patchAppJson,
  renameWidgetFilename,
  renderManualSnippet,
  resolveAppRoot,
  rewriteContent,
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

describe("buildPatchedAppJson — appleTeamId", () => {
  it("writes expo.ios.appleTeamId when given a teamId and the existing config has none", () => {
    const existing = JSON.stringify({ expo: { name: "Host" } });
    const patched = JSON.parse(
      buildPatchedAppJson({ existing, plan: samplePlan, teamId: "ABCDE12345" }),
    );
    assert.equal(patched.expo.ios.appleTeamId, "ABCDE12345");
  });

  it("overwrites the placeholder XXXXXXXXXX team id", () => {
    const existing = JSON.stringify({
      expo: { ios: { appleTeamId: "XXXXXXXXXX" } },
    });
    const patched = JSON.parse(
      buildPatchedAppJson({ existing, plan: samplePlan, teamId: "ABCDE12345" }),
    );
    assert.equal(patched.expo.ios.appleTeamId, "ABCDE12345");
  });

  it("does NOT overwrite an existing real team id different from the input", () => {
    const existing = JSON.stringify({
      expo: { ios: { appleTeamId: "REALTEAM01" } },
    });
    const patched = JSON.parse(
      buildPatchedAppJson({ existing, plan: samplePlan, teamId: "OTHERTEAM2" }),
    );
    assert.equal(patched.expo.ios.appleTeamId, "REALTEAM01");
  });

  it("leaves appleTeamId untouched when teamId is null", () => {
    const existing = JSON.stringify({
      expo: { ios: { appleTeamId: "REALTEAM01" } },
    });
    const patched = JSON.parse(
      buildPatchedAppJson({ existing, plan: samplePlan, teamId: null }),
    );
    assert.equal(patched.expo.ios.appleTeamId, "REALTEAM01");
  });
});

describe("renderManualSnippet — appleTeamId", () => {
  it("includes appleTeamId in the ios block when teamId is provided", () => {
    const snippet = JSON.parse(
      renderManualSnippet(samplePlan, { teamId: "ABCDE12345" }),
    );
    assert.equal(snippet.ios.appleTeamId, "ABCDE12345");
  });

  it("omits appleTeamId when teamId is null", () => {
    const snippet = JSON.parse(renderManualSnippet(samplePlan, { teamId: null }));
    assert.equal(snippet.ios.appleTeamId, undefined);
  });

  it("creates the ios block solely for appleTeamId when there are no other ios additions", () => {
    const empty = {
      ...samplePlan,
      pluginsToAdd: [],
      infoPlistToAdd: {},
      deploymentTargetTo: null,
    };
    const snippet = JSON.parse(renderManualSnippet(empty, { teamId: "ABCDE12345" }));
    assert.deepEqual(snippet, { ios: { appleTeamId: "ABCDE12345" } });
  });
});

describe("renameWidgetFilename", () => {
  it("rewrites the MobileSurfaces prefix only at the start of the basename", () => {
    assert.equal(renameWidgetFilename("MobileSurfacesWidget.swift", "Acme"), "AcmeWidget.swift");
    assert.equal(
      renameWidgetFilename("MobileSurfacesActivityAttributes.swift", "Acme"),
      "AcmeActivityAttributes.swift",
    );
    assert.equal(renameWidgetFilename("MobileSurfacesLiveActivity.swift", "Acme"), "AcmeLiveActivity.swift");
  });

  it("returns null for files that don't start with MobileSurfaces", () => {
    assert.equal(renameWidgetFilename("Info.plist", "Acme"), null);
    assert.equal(renameWidgetFilename("expo-target.config.js", "Acme"), null);
    assert.equal(renameWidgetFilename("Assets.xcassets", "Acme"), null);
  });
});

describe("rewriteContent", () => {
  it("rewrites struct MobileSurfacesActivityAttributes → struct AcmeActivityAttributes", () => {
    const source = "struct MobileSurfacesActivityAttributes: ActivityAttributes { }";
    const out = rewriteContent({
      source,
      swiftPrefix: "Acme",
      widgetTarget: "AcmeWidget",
    });
    assert.equal(out, "struct AcmeActivityAttributes: ActivityAttributes { }");
  });

  it("rewrites the more-specific widget target before the generic prefix", () => {
    const source =
      'name: "MobileSurfacesWidget"\nstruct MobileSurfacesWidgetBundle: WidgetBundle { }';
    const out = rewriteContent({
      source,
      swiftPrefix: "Acme",
      widgetTarget: "AcmeWidget",
    });
    assert.match(out, /name: "AcmeWidget"/);
    assert.match(out, /struct AcmeWidgetBundle: WidgetBundle/);
  });

  it("is a no-op when the source contains no MobileSurfaces tokens", () => {
    const source = "import SwiftUI\n// nothing to see here\n";
    const out = rewriteContent({
      source,
      swiftPrefix: "Acme",
      widgetTarget: "AcmeWidget",
    });
    assert.equal(out, source);
  });
});

describe("deriveSwiftPrefixFromEvidence", () => {
  it("prefers expo.name from a json config", () => {
    const evidence = {
      packageName: "fallback",
      config: { kind: "json", parsed: { name: "Acme App" } },
    };
    assert.equal(deriveSwiftPrefixFromEvidence(evidence), "AcmeApp");
  });

  it("falls back to packageName when config is js/ts", () => {
    const evidence = {
      packageName: "acme-mobile",
      config: { kind: "ts", path: "/x/app.config.ts" },
    };
    assert.equal(deriveSwiftPrefixFromEvidence(evidence), "AcmeMobile");
  });

  it("returns null when nothing usable is found", () => {
    assert.equal(deriveSwiftPrefixFromEvidence({}), null);
    assert.equal(deriveSwiftPrefixFromEvidence({ packageName: "" }), null);
  });
});

describe("applyWidgetRename — filesystem pass", () => {
  function seedFakeWidget(dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "MobileSurfacesActivityAttributes.swift"),
      "struct MobileSurfacesActivityAttributes: ActivityAttributes { }",
    );
    fs.writeFileSync(
      path.join(dir, "MobileSurfacesWidgetBundle.swift"),
      "struct MobileSurfacesWidgetBundle: WidgetBundle { var body: some Widget { MobileSurfacesLiveActivity() } }",
    );
    fs.writeFileSync(
      path.join(dir, "MobileSurfacesLiveActivity.swift"),
      'struct MobileSurfacesLiveActivity: Widget { var body: some WidgetConfiguration { ActivityConfiguration(for: MobileSurfacesActivityAttributes.self) { _ in EmptyView() } } }',
    );
    fs.writeFileSync(
      path.join(dir, "expo-target.config.js"),
      'module.exports = { type: "widget", name: "MobileSurfacesWidget" };',
    );
    fs.writeFileSync(path.join(dir, "Info.plist"), "<plist></plist>\n");
  }

  it("renames MobileSurfacesWidget.swift family to <prefix>... .swift", () => {
    const dir = path.join(tmp, "targets", "widget");
    seedFakeWidget(dir);
    const result = applyWidgetRename({ destDir: dir, swiftPrefix: "Acme" });
    assert.equal(result.renamed, true);
    const files = fs.readdirSync(dir).sort();
    assert.deepEqual(files, [
      "AcmeActivityAttributes.swift",
      "AcmeLiveActivity.swift",
      "AcmeWidgetBundle.swift",
      "Info.plist",
      "expo-target.config.js",
    ]);
  });

  it("rewrites struct MobileSurfacesActivityAttributes to struct <prefix>ActivityAttributes", () => {
    const dir = path.join(tmp, "targets", "widget");
    seedFakeWidget(dir);
    applyWidgetRename({ destDir: dir, swiftPrefix: "Acme" });
    const swift = fs.readFileSync(path.join(dir, "AcmeActivityAttributes.swift"), "utf8");
    assert.match(swift, /struct AcmeActivityAttributes: ActivityAttributes/);
    assert.equal(/MobileSurfaces/.test(swift), false);
  });

  it("rewrites name: \"MobileSurfacesWidget\" in expo-target.config.js to <prefix>Widget", () => {
    const dir = path.join(tmp, "targets", "widget");
    seedFakeWidget(dir);
    applyWidgetRename({ destDir: dir, swiftPrefix: "Acme" });
    const cfg = fs.readFileSync(path.join(dir, "expo-target.config.js"), "utf8");
    assert.match(cfg, /name: "AcmeWidget"/);
  });

  it("returns reason=no-swift-prefix when prefix is empty", () => {
    const dir = path.join(tmp, "targets", "widget");
    seedFakeWidget(dir);
    const result = applyWidgetRename({ destDir: dir, swiftPrefix: "" });
    assert.equal(result.renamed, false);
    assert.equal(result.reason, "no-swift-prefix");
    // Files untouched.
    assert.ok(fs.existsSync(path.join(dir, "MobileSurfacesActivityAttributes.swift")));
  });

  it("returns reason=already-matches when the user's prefix is already MobileSurfaces", () => {
    const dir = path.join(tmp, "targets", "widget");
    seedFakeWidget(dir);
    const result = applyWidgetRename({ destDir: dir, swiftPrefix: "MobileSurfaces" });
    assert.equal(result.renamed, false);
    assert.equal(result.reason, "already-matches");
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
