#!/usr/bin/env node
// One-shot rebrand. Replace Mobile Surfaces identity with your own across
// app config, native target sources, fixtures, scripts, and docs.
//
// Usage:
//   node scripts/rename-starter.mjs \
//     --name "Foo App" \
//     --scheme foo \
//     --bundle-id com.acme.foo \
//     --widget-target FooWidget
//
// Optional:
//   --slug foo-app                 (defaults: kebab-case of --name)
//   --swift-prefix Foo             (defaults: --widget-target without trailing "Widget")
//   --app-package-name foo-app     (defaults: ${slug}-app)
//   --force                        (run on a dirty git tree)

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    scheme: { type: "string" },
    "bundle-id": { type: "string" },
    "widget-target": { type: "string" },
    slug: { type: "string" },
    "swift-prefix": { type: "string" },
    "app-package-name": { type: "string" },
    force: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help) {
  printHelp();
  process.exit(0);
}

const required = ["name", "scheme", "bundle-id", "widget-target"];
const missing = required.filter((k) => !values[k]);
if (missing.length > 0) {
  console.error(`Missing required option(s): ${missing.map((k) => `--${k}`).join(", ")}\n`);
  printHelp();
  process.exit(2);
}

const newName = values.name;
const newScheme = values.scheme;
const newBundleId = values["bundle-id"];
const newWidgetTarget = values["widget-target"];
const newSlug = values.slug ?? toKebab(newName);
const newSwiftPrefix = values["swift-prefix"] ?? deriveSwiftPrefix(newWidgetTarget);
const newAppPackageName = values["app-package-name"] ?? `${newSlug}-app`;

validateSwiftIdentifier(newWidgetTarget, "--widget-target");
validateSwiftIdentifier(newSwiftPrefix, "--swift-prefix");
validateScheme(newScheme);
validateBundleId(newBundleId);
validateSlug(newSlug, "--slug");
validateSlug(newAppPackageName, "--app-package-name");

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
process.chdir(repoRoot);

if (!values.force) {
  try {
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    if (dirty.length > 0) {
      console.error("Working tree has uncommitted changes. Commit or stash first, or pass --force.");
      process.exit(1);
    }
  } catch {
    // Not a git repo or git missing — proceed.
  }
}

// Order matters: longest/most-specific substitutions first so shorter matches
// don't clobber pieces of a longer one.
const substitutions = [
  ["com.example.mobilesurfaces", newBundleId],
  ["Mobile Surfaces", newName],
  ["MobileSurfacesWidget", newWidgetTarget],
  ["MobileSurfaces", newSwiftPrefix],
  ["mobile-surfaces-app", newAppPackageName],
  ["mobile-surfaces", newSlug],
  ["mobilesurfaces", newScheme],
];

const textTargets = [
  ".env.example",
  "CONTRIBUTING.md",
  "README.md",
  "SECURITY.md",
  "package.json",
  "apps/mobile/App.tsx",
  "apps/mobile/app.json",
  "apps/mobile/eas.json",
  "apps/mobile/index.ts",
  "apps/mobile/package.json",
  "apps/mobile/src/notifications.ts",
  "apps/mobile/src/screens/LiveActivityHarness.tsx",
  "apps/mobile/src/fixtures/surfaceFixtures.ts",
  "apps/mobile/modules/live-activity/expo-module.config.json",
  "apps/mobile/modules/live-activity/index.ts",
  "apps/mobile/modules/live-activity/package.json",
  "apps/mobile/modules/live-activity/src/index.ts",
  "apps/mobile/modules/live-activity/ios/LiveActivityModule.podspec",
  "apps/mobile/modules/live-activity/ios/LiveActivityModule.swift",
  "apps/mobile/modules/live-activity/ios/MobileSurfacesActivityAttributes.swift",
  "apps/mobile/targets/widget/MobileSurfacesActivityAttributes.swift",
  "apps/mobile/targets/widget/MobileSurfacesLiveActivity.swift",
  "apps/mobile/targets/widget/MobileSurfacesWidgetBundle.swift",
  "apps/mobile/targets/widget/expo-target.config.js",
  "docs/README.md",
  "docs/architecture.md",
  "docs/ios-environment.md",
  "docs/roadmap.md",
  "packages/design-tokens/package.json",
  "packages/surface-contracts/package.json",
  "scripts/README.md",
  "scripts/mobile-ios-sim.sh",
  "scripts/push-simulator-notification.sh",
  "scripts/send-apns.mjs",
  ...listJson("data/surface-fixtures").filter((f) => path.basename(f) !== "index.json"),
];

let touched = 0;
for (const rel of textTargets) {
  if (!fs.existsSync(rel)) continue;
  const original = fs.readFileSync(rel, "utf8");
  let updated = original;
  for (const [from, to] of substitutions) {
    updated = updated.split(from).join(to);
  }
  if (updated !== original) {
    fs.writeFileSync(rel, updated);
    touched += 1;
    console.log(`updated ${rel}`);
  }
}

// Rename Swift files whose basenames start with MobileSurfaces.
const renameTargets = [
  "apps/mobile/modules/live-activity/ios/MobileSurfacesActivityAttributes.swift",
  "apps/mobile/targets/widget/MobileSurfacesActivityAttributes.swift",
  "apps/mobile/targets/widget/MobileSurfacesLiveActivity.swift",
  "apps/mobile/targets/widget/MobileSurfacesWidgetBundle.swift",
];
for (const rel of renameTargets) {
  if (!fs.existsSync(rel)) continue;
  const dir = path.dirname(rel);
  const base = path.basename(rel);
  const next = base.replace(/^MobileSurfaces/, newSwiftPrefix);
  if (next === base) continue;
  const dest = path.join(dir, next);
  fs.renameSync(rel, dest);
  console.log(`renamed ${rel} -> ${dest}`);
}

// Regenerate fixtures.ts so the deepLink scheme rewrite is reflected in
// the committed TS surface.
console.log("regenerating fixtures.ts ...");
execSync("node scripts/generate-surface-fixtures.mjs", { stdio: "inherit" });

console.log("verifying surface:check ...");
execSync("node scripts/validate-surface-fixtures.mjs", { stdio: "inherit" });
execSync("node scripts/generate-surface-fixtures.mjs --check", { stdio: "inherit" });
execSync("node scripts/check-activity-attributes.mjs", { stdio: "inherit" });

console.log(`\nRenamed ${touched} text file(s). Identity is now:`);
console.log(`  display name:   ${newName}`);
console.log(`  slug:           ${newSlug}`);
console.log(`  scheme:         ${newScheme}`);
console.log(`  bundle id:      ${newBundleId}`);
console.log(`  widget target:  ${newWidgetTarget}`);
console.log(`  swift prefix:   ${newSwiftPrefix}`);
console.log(`  app package:    ${newAppPackageName}`);
console.log(`\nNext: pnpm install && pnpm mobile:prebuild:ios`);

function deriveSwiftPrefix(widgetTarget) {
  return widgetTarget.endsWith("Widget")
    ? widgetTarget.slice(0, -"Widget".length)
    : widgetTarget;
}

function toKebab(s) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function listJson(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}

function validateSwiftIdentifier(s, label) {
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(s)) {
    console.error(`${label} must be an UpperCamelCase Swift identifier (got ${JSON.stringify(s)})`);
    process.exit(2);
  }
}
function validateScheme(s) {
  if (!/^[a-z][a-z0-9]*$/.test(s)) {
    console.error(`--scheme must be lowercase letters and digits, starting with a letter (got ${JSON.stringify(s)})`);
    process.exit(2);
  }
}
function validateBundleId(s) {
  if (!/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+){1,}$/.test(s)) {
    console.error(`--bundle-id must look like com.acme.foo (got ${JSON.stringify(s)})`);
    process.exit(2);
  }
}
function validateSlug(s, label) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) {
    console.error(`${label} must be kebab-case (got ${JSON.stringify(s)})`);
    process.exit(2);
  }
}

function printHelp() {
  console.log(`Usage: node scripts/rename-starter.mjs \\
  --name "Foo App" \\
  --scheme foo \\
  --bundle-id com.acme.foo \\
  --widget-target FooWidget

Optional:
  --slug foo-app                Defaults to kebab-case of --name.
  --swift-prefix Foo            Defaults to --widget-target without "Widget".
  --app-package-name foo-app    Defaults to \${slug}-app.
  --force                       Run on a dirty git tree.`);
}
