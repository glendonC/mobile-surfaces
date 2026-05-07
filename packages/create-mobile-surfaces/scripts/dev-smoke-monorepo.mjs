#!/usr/bin/env node
// Dev-only smoke for the existing-monorepo-no-Expo flow. Sets up a fake
// TS monorepo (workspaces declared, no Expo, no apps/mobile/), runs the CLI
// non-interactively with --yes --no-install, and asserts the post-state on
// disk matches what the plan promised: apps/mobile/ scaffolded, identity
// renamed, app.json patched, workspace globs merged, package deps rewritten.

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(__dirname, "..", "bin", "index.mjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-monorepo-smoke-"));
console.log(`[smoke-monorepo] running in ${tmp}`);

// 1) Fake TS monorepo: package.json + pnpm-workspace.yaml + a sibling package.
fs.writeFileSync(
  path.join(tmp, "package.json"),
  JSON.stringify(
    {
      name: "fake-host",
      private: true,
      devDependencies: { typescript: "^5.6.0" },
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(tmp, "pnpm-workspace.yaml"),
  "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
);
fs.mkdirSync(path.join(tmp, "apps", "api"), { recursive: true });
fs.writeFileSync(
  path.join(tmp, "apps", "api", "package.json"),
  JSON.stringify({ name: "@host/api", main: "index.ts" }, null, 2),
);
fs.mkdirSync(path.join(tmp, "lib"), { recursive: true });
fs.writeFileSync(path.join(tmp, "lib", "util.ts"), "export const x = 1;\n");

// 2) Run the CLI non-interactively. --no-install skips network so this is
// deterministic and fast; the install + prebuild paths are exercised in a
// separate smoke we run on demand.
const result = spawnSync(
  "node",
  [
    cliBin,
    "--yes",
    "--name=foo",
    "--bundle-id=com.acme.foo",
    "--no-install",
  ],
  {
    cwd: tmp,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  },
);

console.log("\n--- CLI stdout ---");
console.log(result.stdout);
if (result.stderr) {
  console.log("--- CLI stderr ---");
  console.log(result.stderr);
}
console.log(`--- exit ${result.status} ---\n`);

if (result.status !== 0) {
  console.error("[smoke-monorepo] CLI exited non-zero, see output above");
  process.exit(1);
}

// 3) Assertions.
const appsMobile = path.join(tmp, "apps", "mobile");
assert.ok(fs.existsSync(appsMobile), "apps/mobile/ should be created");
assert.ok(
  fs.existsSync(path.join(appsMobile, "app.json")),
  "apps/mobile/app.json should exist",
);

const appJson = JSON.parse(fs.readFileSync(path.join(appsMobile, "app.json"), "utf8"));
assert.equal(appJson.expo.name, "foo", "name should be patched");
assert.equal(appJson.expo.slug, "foo", "slug should be patched");
assert.equal(
  appJson.expo.ios.bundleIdentifier,
  "com.acme.foo",
  "bundle identifier should be patched",
);
assert.equal(
  appJson.expo.scheme,
  "foo",
  "scheme should be derived from name",
);
assert.deepEqual(
  appJson.expo.ios.entitlements["com.apple.security.application-groups"],
  ["group.com.acme.foo"],
  "App Group entitlement should match the new bundle id",
);

// Workspace globs merged.
const yaml = fs.readFileSync(path.join(tmp, "pnpm-workspace.yaml"), "utf8");
assert.match(yaml, /apps\/\*/, "apps/* glob should still be present");
// Identity rewrite — the widget bundle file should be renamed and contents updated.
const widgetDir = path.join(appsMobile, "targets", "widget");
const widgetEntries = fs.readdirSync(widgetDir);
assert.ok(
  widgetEntries.includes("FooWidgetBundle.swift"),
  `expected FooWidgetBundle.swift, got ${widgetEntries.join(", ")}`,
);
assert.ok(
  !widgetEntries.includes("MobileSurfacesWidgetBundle.swift"),
  "old bundled-prefix file should be gone",
);

const bundleSwift = fs.readFileSync(
  path.join(widgetDir, "FooWidgetBundle.swift"),
  "utf8",
);
assert.ok(
  !bundleSwift.includes("MobileSurfaces"),
  "swift bundle should not contain leftover MobileSurfaces literal",
);
assert.ok(bundleSwift.includes("Foo"), "swift bundle should contain new prefix");

// Workspace deps rewritten.
const mobilePkg = JSON.parse(
  fs.readFileSync(path.join(appsMobile, "package.json"), "utf8"),
);
for (const dep of ["@mobile-surfaces/surface-contracts", "@mobile-surfaces/live-activity", "@mobile-surfaces/design-tokens"]) {
  const v = mobilePkg.dependencies?.[dep] ?? mobilePkg.devDependencies?.[dep];
  assert.ok(v, `${dep} should still be in apps/mobile/package.json`);
  assert.ok(!v.startsWith("workspace:"), `${dep} should be rewritten from workspace:* (got ${v})`);
}

// Host's root package.json should not have been clobbered.
const hostPkg = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8"));
assert.equal(hostPkg.name, "fake-host", "host package.json untouched");

// Sibling package preserved.
assert.ok(
  fs.existsSync(path.join(tmp, "apps", "api", "package.json")),
  "sibling app/api should still exist",
);

console.log(`[smoke-monorepo] ✓ scaffold OK`);
console.log(`[smoke-monorepo] artifact: ${tmp}`);
