#!/usr/bin/env node
// Dev-only smoke test for the add-to-existing-Expo apply pipeline. Sets up
// a fake existing Expo project in /tmp, runs detectMode + planChanges +
// applyToExisting, and asserts the post-state on disk matches what we
// promised in the plan (app.json patched, widget target dir copied).
//
// Skips the actual `<pm> add` step by overriding plan.packagesToAdd to
// empty — the smoke is about file mutations the CLI applies directly,
// not third-party install behavior.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyToExisting } from "../src/apply-existing.mjs";
import { planChanges } from "../src/existing-expo.mjs";
import { detectMode, MODE } from "../src/mode.mjs";
import { loadTemplateManifest } from "../src/template-manifest.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-existing-smoke-"));
console.log(`[smoke-existing] running in ${tmp}`);

// 1) Fake existing Expo app: package.json (with expo) + app.json (no plugins).
fs.writeFileSync(
  path.join(tmp, "package.json"),
  JSON.stringify(
    {
      name: "fake-host",
      dependencies: { expo: "~54.0.0", "expo-router": "^4.0.0" },
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(tmp, "app.json"),
  JSON.stringify(
    {
      expo: {
        name: "Fake Host",
        slug: "fake-host",
        ios: { bundleIdentifier: "com.acme.fakehost", deploymentTarget: "15.0" },
      },
    },
    null,
    2,
  ),
);

// 2) Run mode detection — same call the entrypoint makes.
const mode = detectMode({ cwd: tmp });
assert.equal(mode.kind, MODE.EXISTING_EXPO, "expected existing-expo detection");
console.log(`[smoke-existing] mode: ${mode.kind}, expo: ${mode.evidence.expoVersion}`);

// 3) Plan + filter packagesToAdd to only the workspace ones — they get
// skipped at apply time (no npm hit), so the smoke covers the workspace
// followup path without us mocking the install command.
const manifest = loadTemplateManifest();
const plan = planChanges({ evidence: mode.evidence, manifest });
plan.packagesToAdd = plan.packagesToAdd.filter((p) => p.workspace);

// 4) Apply — file changes only, no network.
const summary = await applyToExisting({
  evidence: mode.evidence,
  plan,
  packageManager: "pnpm",
  manifest,
});

// 5) Assertions — what should be true on disk?
const appJson = JSON.parse(fs.readFileSync(path.join(tmp, "app.json"), "utf8"));
assert.equal(appJson.expo.ios.deploymentTarget, "16.2", "deploymentTarget should be bumped");
assert.equal(
  appJson.expo.ios.infoPlist.NSSupportsLiveActivities,
  true,
  "NSSupportsLiveActivities should be set",
);
const pluginNames = (appJson.expo.plugins ?? []).map((p) =>
  Array.isArray(p) ? p[0] : p,
);
assert.ok(pluginNames.includes("@bacons/apple-targets"), "apple-targets plugin missing");
assert.ok(pluginNames.includes("expo-build-properties"), "expo-build-properties plugin missing");

const widgetDest = path.join(tmp, "targets", "widget");
assert.ok(fs.existsSync(widgetDest), "widget dest should exist");
const widgetFiles = fs.readdirSync(widgetDest);
assert.ok(widgetFiles.length > 0, "widget dest should have files");
assert.ok(
  widgetFiles.some((f) => f.endsWith(".swift")),
  "widget dest should have at least one .swift file",
);

assert.ok(
  summary.followups.some((f) => f.includes("aren't on npm yet")),
  "expected a followup mentioning the workspace packages were skipped",
);

console.log(`[smoke-existing] summary:`, {
  appJsonPatched: summary.appJsonPatched,
  widgetCopied: summary.widgetCopied,
  packagesSkipped: summary.packagesSkipped,
  followups: summary.followups,
});
console.log(`[smoke-existing] ✓ apply pipeline OK`);

// Don't clean up — leave the artifact so the user can inspect it. The path
// is logged above and tmp dirs get reaped by the OS.
