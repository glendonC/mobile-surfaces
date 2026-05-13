#!/usr/bin/env node
// `pnpm release:fix` — regenerate every derived file in the repo. Use when
// `pnpm release:dry-run` reports drift on a generated artifact.
//
// Order matters: trap-bindings depends on the catalog, traps-data depends
// on the catalog, build-agents-md depends on the catalog. Surface fixtures
// regenerate from JSON. JSON schema regenerates from the Zod source.
//
// Snapshot regen is a special case: it requires the bundled
// template.tgz/manifest.json to be up to date AND a clean working tree
// (build-template refuses dirty trees). The snapshot regen step is
// therefore opt-in via --snapshots and runs build:template internally.
// Default behavior is to regenerate everything that does NOT need a clean
// tree, since most fix-and-retry loops don't need a fresh tarball.

import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    snapshots: { type: "boolean", default: false },
  },
});

const QUICK_REGENS = [
  {
    name: "JSON schema (build-schema.mjs)",
    cmd: ["node", "--experimental-strip-types", "--no-warnings=ExperimentalWarning", "scripts/build-schema.mjs"],
  },
  {
    name: "TypeScript surface fixtures (generate-surface-fixtures.mjs)",
    cmd: ["node", "--experimental-strip-types", "--no-warnings=ExperimentalWarning", "scripts/generate-surface-fixtures.mjs"],
  },
  {
    name: "Trap bindings (generate-trap-bindings.mjs)",
    cmd: ["node", "--experimental-strip-types", "--no-warnings=ExperimentalWarning", "scripts/generate-trap-bindings.mjs"],
  },
  {
    name: "Traps data export (generate-traps-data.mjs)",
    cmd: ["node", "--experimental-strip-types", "--no-warnings=ExperimentalWarning", "scripts/generate-traps-data.mjs"],
  },
  {
    name: "CLAUDE.md + AGENTS.md (build-agents-md.mjs)",
    cmd: ["node", "--experimental-strip-types", "--no-warnings=ExperimentalWarning", "scripts/build-agents-md.mjs"],
  },
];

function run(cmd) {
  return new Promise((resolve, reject) => {
    const [exe, ...args] = cmd;
    const child = spawn(exe, args, { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`exit ${code}`));
    });
    child.on("error", reject);
  });
}

const STAR = "═".repeat(60);

console.log(`${STAR}\nregenerating derived files\n${STAR}\n`);

for (const step of QUICK_REGENS) {
  console.log(`→ ${step.name}`);
  await run(step.cmd);
}

if (values.snapshots) {
  console.log(`\n${STAR}\nscaffold snapshots (requires clean tree)\n${STAR}\n`);
  const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
  if (dirty.length > 0) {
    console.error("✗ working tree is dirty. Commit the regen output from above,");
    console.error("  then rerun with --snapshots to refresh the bundled");
    console.error("  template tarball and the scaffold snapshot hashes.");
    process.exit(1);
  }
  console.log("→ build:template (regenerate template.tgz + manifest.json)");
  await run(["pnpm", "--filter", "create-mobile-surfaces", "build:template"]);
  console.log("→ SNAPSHOT_UPDATE=1 cli:test (regenerate test/snapshots/*.txt)");
  await new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["cli:test"], {
      stdio: "inherit",
      env: { ...process.env, SNAPSHOT_UPDATE: "1" },
    });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
    child.on("error", reject);
  });
}

console.log(`\n${STAR}\n✓ regen complete. Commit the resulting diff and re-run release:dry-run.\n${STAR}`);

if (!values.snapshots) {
  console.log("\nNote: scaffold snapshots were not regenerated. If release:dry-run");
  console.log("still fails on cli:test snapshot-scaffold, commit this regen first,");
  console.log("then run `pnpm release:fix --snapshots` (requires a clean tree).");
}
