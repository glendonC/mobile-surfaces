#!/usr/bin/env node
// End-to-end scaffold smoke: scaffold a greenfield project into /tmp, run
// pnpm install on the result, then run pnpm surface:check and typecheck
// inside the scaffolded copy. Catches the class of bug the other smokes
// can't: a template that's structurally valid (files-in-place, hashes
// pinned) but functionally broken (drift between an API the template
// imports and the version of @mobile-surfaces/* it pins, dep-resolution
// failure, TypeScript regression at the contract boundary).
//
// Deliberately slow: pnpm install + tsc + surface:check on a fresh tree
// is minutes, not seconds. Lives outside the default cli:smoke chain;
// invoked by ci.yml on macos-26 where the runtime budget is acceptable.
//
// Usage:
//   node packages/create-mobile-surfaces/scripts/dev-smoke-e2e.mjs
//
// Env:
//   MS_SMOKE_KEEP=1   Leave the scaffolded tempdir on disk for inspection.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as logger from "../src/logger.mjs";
import { runTasks } from "../src/run-tasks.mjs";
import { targetDirState } from "../src/scaffold.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keep = process.env.MS_SMOKE_KEEP === "1";

const stamp = Date.now().toString(36);
const projectName = `ms-e2e-${stamp}`;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "create-mobile-surfaces-e2e-"));

process.chdir(tmpRoot);
console.log(`[e2e] running in ${tmpRoot}`);

const dirState = targetDirState(projectName);
if (!dirState.ok) {
  console.error(`[e2e] target ${dirState.target} not empty; aborting`);
  process.exit(1);
}

logger.open();
console.log(`[e2e] log at ${logger.getPath()}`);

// installNow: false. We drive `pnpm install` ourselves so we can also run
// surface:check + typecheck on the scaffolded copy without going through
// expo prebuild (which would need Xcode on the runner).
const config = {
  projectName,
  scheme: "e2esmoke",
  bundleId: `com.acme.${projectName.replace(/-/g, "")}`,
  teamId: null,
  installNow: false,
};

console.log(`[e2e] config:`, config);

try {
  await runTasks({ config, target: dirState.target });
  console.log(`[e2e] ✓ scaffold complete at ${dirState.target}`);
} catch (err) {
  console.error(`[e2e] ✗ scaffold failed:`, err.message);
  console.error(`[e2e] log: ${logger.getPath()}`);
  process.exit(1);
}

// Run a command in the scaffolded project, streaming stdio. Fail-fast on
// any non-zero exit; print which step blew up.
function run(cmd, args, label) {
  console.log(`\n[e2e] → ${label}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: dirState.target,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`[e2e] ✗ ${label} exited with status ${r.status}`);
    if (!keep) {
      // Leave the tree on disk when something fails so the failure is
      // inspectable. The success path cleans up at the end.
      console.error(`[e2e] artifact preserved at ${tmpRoot}`);
    }
    process.exit(r.status ?? 1);
  }
}

// A fresh scaffold isn't a git repo by default; `check-ios-gitignore.mjs`
// shells out to `git check-ignore` and bails without one. Real forks
// `git init` early; mirror that here so surface:check can run.
run("git", ["init", "-q", "."], "git init");
run("git", ["add", "-A"], "git add -A");
run("git", ["-c", "user.email=ci@local", "-c", "user.name=ci", "commit", "-qm", "initial scaffold"], "git commit");

run("pnpm", ["install", "--frozen-lockfile=false"], "pnpm install");

// Forks rename @mobile-surfaces/* to @<project>/*, which drops the upstream
// unpkg $id from packages/surface-contracts/schema.json (forks aren't
// published to unpkg). Regenerate before surface:check so the scaffolded
// tree is self-consistent with what build-schema.mjs would emit for a fork.
// The rename pass already does this via dropSchemaId; the explicit regen
// here is defense-in-depth in case the scaffold + rename path ever skips
// that step.
run(
  "node",
  [
    "--experimental-strip-types",
    "--no-warnings=ExperimentalWarning",
    "scripts/build-schema.mjs",
  ],
  "regen schema.json (fork $id)",
);
run(
  "node",
  [
    "--experimental-strip-types",
    "--no-warnings=ExperimentalWarning",
    "scripts/generate-surface-fixtures.mjs",
  ],
  "regen fixtures.ts",
);

run("pnpm", ["surface:check"], "pnpm surface:check");
run("pnpm", ["typecheck"], "pnpm typecheck");

console.log(`\n[e2e] ✓ scaffold + install + surface:check + typecheck`);

if (keep) {
  console.log(`[e2e] artifact preserved at ${tmpRoot} (MS_SMOKE_KEEP=1)`);
} else {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`[e2e] cleaned up ${tmpRoot}`);
}
