#!/usr/bin/env node
// One-shot rebrand. Replace the project's current identity (mobile-surfaces by
// default, or whatever was stamped by a previous run) with a new identity
// across app config, native target sources, fixtures, scripts, and docs.
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
//   --dry-run                      (print would-be changes without writing)

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// Default identity matches the upstream mobile-surfaces project. On a fresh
// checkout we substitute these literals; after the first run, the manifest at
// .mobile-surfaces-identity.json takes over so subsequent renames don't need
// to know the original strings.
export const DEFAULT_IDENTITY = Object.freeze({
  name: "Mobile Surfaces",
  scheme: "mobilesurfaces",
  bundleId: "com.example.mobilesurfaces",
  widgetTarget: "MobileSurfacesWidget",
  swiftPrefix: "MobileSurfaces",
  slug: "mobile-surfaces",
  appPackageName: "mobile-surfaces-app",
});

export const IDENTITY_MANIFEST_FILE = ".mobile-surfaces-identity.json";

// Read a stamped identity manifest if one exists. The manifest is written at
// the end of a successful (non-dry-run) rename so the next run can target
// whatever identity is actually on disk.
export function loadCurrentIdentity(repoRoot) {
  const manifestPath = path.join(repoRoot, IDENTITY_MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    return { ...DEFAULT_IDENTITY };
  }
  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    name: parsed.name,
    scheme: parsed.scheme,
    bundleId: parsed.bundleId,
    widgetTarget: parsed.widgetTarget,
    swiftPrefix: parsed.swiftPrefix,
    slug: parsed.slug,
    appPackageName: parsed.appPackageName,
  };
}

// Order matters: longest/most-specific substitutions first so shorter matches
// don't clobber pieces of a longer one. (e.g. "Mobile Surfaces" must run
// before "mobile-surfaces", and "MobileSurfacesWidget" before "MobileSurfaces".)
export function buildSubstitutions(currentIdentity, newIdentity) {
  return [
    [currentIdentity.bundleId, newIdentity.bundleId],
    [currentIdentity.name, newIdentity.name],
    [currentIdentity.widgetTarget, newIdentity.widgetTarget],
    [currentIdentity.swiftPrefix, newIdentity.swiftPrefix],
    [currentIdentity.appPackageName, newIdentity.appPackageName],
    [currentIdentity.slug, newIdentity.slug],
    [currentIdentity.scheme, newIdentity.scheme],
  ];
}

// Returns true when every from === to (running the rename would be a no-op).
export function isIdempotent(substitutions) {
  return substitutions.every(([from, to]) => from === to);
}

function main() {
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
      "dry-run": { type: "boolean", default: false },
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

  const dryRun = values["dry-run"];
  const newIdentity = {
    name: values.name,
    scheme: values.scheme,
    bundleId: values["bundle-id"],
    widgetTarget: values["widget-target"],
    slug: values.slug ?? toKebab(values.name),
    swiftPrefix: values["swift-prefix"] ?? deriveSwiftPrefix(values["widget-target"]),
    appPackageName: values["app-package-name"] ?? `${values.slug ?? toKebab(values.name)}-app`,
  };

  validateSwiftIdentifier(newIdentity.widgetTarget, "--widget-target");
  validateSwiftIdentifier(newIdentity.swiftPrefix, "--swift-prefix");
  validateScheme(newIdentity.scheme);
  validateBundleId(newIdentity.bundleId);
  validateSlug(newIdentity.slug, "--slug");
  validateSlug(newIdentity.appPackageName, "--app-package-name");

  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  process.chdir(repoRoot);

  if (!values.force && !dryRun) {
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

  const currentIdentity = loadCurrentIdentity(repoRoot);
  const substitutions = buildSubstitutions(currentIdentity, newIdentity);

  if (isIdempotent(substitutions)) {
    console.log("Identity unchanged. Nothing to do.");
    process.exit(0);
  }

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
    "packages/live-activity/expo-module.config.json",
    "packages/live-activity/index.ts",
    "packages/live-activity/package.json",
    "packages/live-activity/src/index.ts",
    "packages/live-activity/ios/LiveActivityModule.podspec",
    "packages/live-activity/ios/LiveActivityModule.swift",
    `packages/live-activity/ios/${currentIdentity.swiftPrefix}ActivityAttributes.swift`,
    `apps/mobile/targets/widget/${currentIdentity.swiftPrefix}ActivityAttributes.swift`,
    `apps/mobile/targets/widget/${currentIdentity.swiftPrefix}LiveActivity.swift`,
    `apps/mobile/targets/widget/${currentIdentity.swiftPrefix}WidgetBundle.swift`,
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
    let count = 0;
    for (const [from, to] of substitutions) {
      if (from === to) continue;
      const parts = updated.split(from);
      if (parts.length > 1) {
        count += parts.length - 1;
        updated = parts.join(to);
      }
    }
    if (updated !== original) {
      if (dryRun) {
        console.log(`[dry-run] would rewrite ${rel} (${count} substitutions)`);
      } else {
        fs.writeFileSync(rel, updated);
        console.log(`updated ${rel}`);
      }
      touched += 1;
    }
  }

  // Rename Swift files whose basenames start with the current swift prefix.
  const renameTargets = [
    `packages/live-activity/ios/${currentIdentity.swiftPrefix}ActivityAttributes.swift`,
    `apps/mobile/targets/widget/${currentIdentity.swiftPrefix}ActivityAttributes.swift`,
    `apps/mobile/targets/widget/${currentIdentity.swiftPrefix}LiveActivity.swift`,
    `apps/mobile/targets/widget/${currentIdentity.swiftPrefix}WidgetBundle.swift`,
  ];
  for (const rel of renameTargets) {
    if (!fs.existsSync(rel)) continue;
    const dir = path.dirname(rel);
    const base = path.basename(rel);
    const fromPrefixRe = new RegExp(`^${escapeRegex(currentIdentity.swiftPrefix)}`);
    const next = base.replace(fromPrefixRe, newIdentity.swiftPrefix);
    if (next === base) continue;
    const dest = path.join(dir, next);
    if (dryRun) {
      console.log(`[dry-run] would rename ${rel} → ${dest}`);
    } else {
      fs.renameSync(rel, dest);
      console.log(`renamed ${rel} -> ${dest}`);
    }
  }

  if (dryRun) {
    console.log(`[dry-run] ${touched} files would be touched. Pass without --dry-run to apply.`);
    process.exit(0);
  }

  // Regenerate fixtures.ts so the deepLink scheme rewrite is reflected in
  // the committed TS surface.
  console.log("regenerating fixtures.ts ...");
  execSync("node scripts/generate-surface-fixtures.mjs", { stdio: "inherit" });

  console.log("verifying surface:check ...");
  execSync("node scripts/validate-surface-fixtures.mjs", { stdio: "inherit" });
  execSync("node scripts/generate-surface-fixtures.mjs --check", { stdio: "inherit" });
  execSync("node scripts/check-activity-attributes.mjs", { stdio: "inherit" });

  // Stamp the manifest so the next run knows what identity is on disk.
  const manifest = {
    version: 1,
    ranAt: new Date().toISOString(),
    ...newIdentity,
  };
  fs.writeFileSync(
    path.join(repoRoot, IDENTITY_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(`\nRenamed ${touched} text file(s). Identity is now:`);
  console.log(`  display name:   ${newIdentity.name}`);
  console.log(`  slug:           ${newIdentity.slug}`);
  console.log(`  scheme:         ${newIdentity.scheme}`);
  console.log(`  bundle id:      ${newIdentity.bundleId}`);
  console.log(`  widget target:  ${newIdentity.widgetTarget}`);
  console.log(`  swift prefix:   ${newIdentity.swiftPrefix}`);
  console.log(`  app package:    ${newIdentity.appPackageName}`);
  console.log(`\nNext: pnpm install && pnpm mobile:prebuild:ios`);
}

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

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
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
  if (/^com\.example\./i.test(s)) {
    console.error(`--bundle-id com.example.* is a placeholder Apple rejects on upload. Use your real reverse-DNS prefix (e.g. com.acme.myapp).`);
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
  --force                       Run on a dirty git tree.
  --dry-run                     Print every substitution and rename without writing.`);
}

// Only run the CLI when this file is the entry point. Test files import the
// helpers above without firing the rename.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
