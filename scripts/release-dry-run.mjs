#!/usr/bin/env node
// `pnpm release:dry-run` — runs every gate CI would run, plus the regen-drift
// check, so a contributor can catch what would fail on a PR before pushing.
//
// Each gate runs in sequence with a clear header. The script exits non-zero
// on the first failure to keep the failure surface narrow; rerun after
// fixing each problem rather than chasing parallel errors.
//
// Gates, in order:
//   1. surface:check         (catalog + schema + parity scripts)
//   2. typecheck             (TS compile across the whole workspace)
//   3. test:scripts          (every scripts/*.test.mjs)
//   4. test:push             (push SDK suite, ~83 tests)
//   5. cli:test              (252 tests including scaffold snapshots — the
//                              one most likely to surface drift after template
//                              file edits)
//   6. site build            (apps/site Astro build; catches markdown/route
//                              issues the rest of CI does not)
//   7. pack-and-install smoke (matches the `Pack-and-install smoke` CI step)
//
// Note: the snapshot test in cli:test compares the materialized scaffold tree
// against committed hashes in test/snapshots/. If template files changed
// without a SNAPSHOT_UPDATE=1 regen, this fails here. Run `pnpm release:fix`
// to regenerate every derived file in one shot.
//
// `--fix` flag: on a clean tree, auto-regenerates scaffold snapshots if they
// drifted, amends the diff into the current HEAD commit, and aborts so the
// developer re-runs `git push` once (the push picks up the amended ref).
// Without --fix the script just fails on drift (matches CI behavior). The
// pre-push hook passes --fix so the common case (developer edited a file
// that ends up in scaffold) becomes edit -> commit -> push -> hook amends ->
// push again, instead of the longer manual fix/amend/push cycle.

import { spawn, execSync, execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values: cliFlags } = parseArgs({
  options: {
    fix: { type: "boolean", default: false },
  },
});

// pack-and-install smoke calls build-template, which refuses dirty trees.
// Mark it `requiresCleanTree` so dry-run can run on a work-in-progress
// branch without that gate failing for the wrong reason. CI always has a
// clean checkout and always runs it via the workflow file.
const GATES = [
  { name: "surface:check", cmd: ["pnpm", "surface:check"] },
  { name: "typecheck", cmd: ["pnpm", "typecheck"] },
  { name: "test:scripts", cmd: ["pnpm", "test:scripts"] },
  { name: "test:push", cmd: ["pnpm", "test:push"] },
  { name: "cli:test (includes scaffold snapshot)", cmd: ["pnpm", "cli:test"] },
  { name: "site build", cmd: ["pnpm", "--filter", "@mobile-surfaces/site", "build"] },
  {
    name: "pack-and-install smoke",
    cmd: ["bash", "scripts/smoke-pack-and-install.sh"],
    requiresCleanTree: true,
  },
];

function isTreeClean() {
  const out = execSync("git status --porcelain", { encoding: "utf8" }).trim();
  return out.length === 0;
}

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

const treeClean = isTreeClean();
const skipped = [];

// On a clean tree, refresh the bundled template tarball before running
// cli:test. Without this, the scaffold snapshot test compares the
// materialized tree (built from a possibly-stale template.tgz on disk)
// against the committed snapshots; if the dev rebuilt the tarball before
// the most recent commit, the local test passes against a tarball that
// does not reflect HEAD, while CI (which has no tarball cached) runs from
// `git archive HEAD` and fails on the same files. CI catches the drift,
// dry-run misses it. Refreshing here closes the hole.
//
// Skipped on a dirty tree because build-template refuses uncommitted
// changes. Local cli:test will then run against whatever tarball is on
// disk; the snapshot test is best-effort in that path. Commit your work
// and rerun release:dry-run for the strict gate.
if (treeClean) {
  console.log(`\n${STAR}\n[setup] refresh bundled template tarball\n${STAR}`);
  try {
    await run(["pnpm", "--filter", "create-mobile-surfaces", "build:template"]);
  } catch {
    console.error("✗ build:template failed; cli:test would run against a stale tarball.");
    process.exit(1);
  }

  // --fix: proactively regenerate scaffold snapshots from the refreshed
  // tarball. If the regen produces a diff, the developer's last commit
  // didn't include up-to-date snapshots — amend them in and abort the
  // push so the next `git push` carries the amended ref. If the regen
  // produces no diff, snapshots were already correct and we continue.
  //
  // Why amend instead of "make a new commit": every PR I open spawning a
  // separate snapshot-regen commit pollutes the log with one-liner
  // bookkeeping. Amending keeps history matching the conceptual unit of
  // work the developer was on.
  if (cliFlags.fix) {
    console.log(`\n${STAR}\n[setup] auto-fix: regenerate scaffold snapshots\n${STAR}`);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn("pnpm", ["cli:test"], {
          stdio: "inherit",
          env: { ...process.env, SNAPSHOT_UPDATE: "1" },
        });
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
        child.on("error", reject);
      });
    } catch {
      console.error("✗ SNAPSHOT_UPDATE=1 cli:test failed; cannot auto-fix.");
      process.exit(1);
    }

    const dirtyAfterRegen = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    if (dirtyAfterRegen.length > 0) {
      console.log(`\n${STAR}\n[setup] auto-fix: snapshots drifted; amending into HEAD\n${STAR}`);
      execFileSync("git", ["add", "packages/create-mobile-surfaces/test/snapshots/"], { stdio: "inherit" });
      // After staging, any files reported by `git status --porcelain` with a
      // non-space char in column 2 (the worktree status) are *unstaged*
      // changes — i.e. files touched by the regen that live outside the
      // snapshots dir we just staged. Bail rather than amend a diff we
      // didn't sanity-check.
      const porcelain = execSync("git status --porcelain", { encoding: "utf8" });
      const unstaged = porcelain
        .split("\n")
        .filter((line) => line.length >= 2 && line[1] !== " ");
      if (unstaged.length > 0) {
        console.error("✗ auto-fix would touch files outside scaffold snapshots; refusing to amend.");
        console.error("  Unstaged changes after regen:");
        console.error(unstaged.join("\n"));
        console.error("  Run `pnpm release:fix --snapshots` manually and inspect the diff.");
        process.exit(1);
      }
      execFileSync("git", ["commit", "--amend", "--no-edit"], { stdio: "inherit" });
      console.log("");
      console.log("✓ snapshots regenerated and amended into HEAD.");
      console.log("  Re-run `git push` to push the amended ref.");
      // Exit non-zero so the pre-push hook aborts this push attempt; the
      // ref the push would have transmitted is the pre-amend SHA. The
      // next `git push` picks up the amended SHA cleanly.
      process.exit(1);
    }
  }
}

let failed = null;
for (let i = 0; i < GATES.length; i += 1) {
  const gate = GATES[i];
  if (gate.requiresCleanTree && !treeClean) {
    console.log(`\n${STAR}\n[${i + 1}/${GATES.length}] ${gate.name} (skipped: dirty tree)\n${STAR}`);
    console.log(`This gate runs build-template, which refuses uncommitted changes.`);
    console.log(`It will run in CI after you push. To exercise it locally,`);
    console.log(`commit your changes and rerun release:dry-run on a clean tree.`);
    skipped.push(gate.name);
    continue;
  }
  console.log(`\n${STAR}\n[${i + 1}/${GATES.length}] ${gate.name}\n${STAR}`);
  try {
    await run(gate.cmd);
    console.log(`✓ ${gate.name}`);
  } catch {
    failed = gate;
    break;
  }
}

console.log(`\n${STAR}`);
if (failed) {
  console.log(`✗ release:dry-run failed at: ${failed.name}`);
  console.log("");
  console.log("If the failure is generated-file drift (CLAUDE.md, AGENTS.md,");
  console.log("trap-bindings, traps-data, surface fixtures, scaffold snapshots),");
  console.log("run `pnpm release:fix` to regenerate every derived file and");
  console.log("retry the dry-run.");
  process.exit(1);
} else if (skipped.length > 0) {
  console.log(`✓ release:dry-run passed (${skipped.length} gate(s) skipped: ${skipped.join(", ")}).`);
  console.log("  Those gates run in CI after you push.");
} else {
  console.log("✓ release:dry-run passed. Safe to push and open a PR.");
}
