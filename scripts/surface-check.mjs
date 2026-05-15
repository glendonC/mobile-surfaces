#!/usr/bin/env node
// `pnpm surface:check` — orchestrator for every static gate that protects the
// Mobile Surfaces contract (Zod source of truth, generated derivatives,
// Swift parity, App Group identity, trap catalog, doc snapshots).
//
// Each step is a named registry entry so a failure surfaces a clear "which
// gate failed" header instead of a bare exit code, and so contributors can
// scope a run with `--only` / `--skip`.
//
// All steps in this chain run in `--check` mode (or are intrinsically
// read-only validators). They do not mutate the working tree, so they are
// safe to run concurrently. Steps are grouped into stages purely so output
// stays legible: every step inside a stage runs in parallel; stages run in
// sequence.
//
// The step inventory lives in scripts/lib/check-registry.mjs — the single
// source of truth for surface-check, diagnose, and validate-check-registry.
// Adding a new check means adding one entry to that file.
//
// Flags:
//   --only=id1,id2     Run only the listed step ids (comma separated).
//   --skip=id1,id2     Skip the listed step ids.
//   --no-bail          Run every (selected) step, even after a failure, then
//                       exit non-zero. Default bails on the first stage that
//                       produces a failure.
//   --list             Print the step inventory and exit.
//   --serial           Disable intra-stage parallelism (debug aid).
//
// Exit code is non-zero if any selected step failed.

import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";

import { orchestratorSteps } from "./lib/check-registry.mjs";

// Step inventory from the registry. The registry runs its own integrity
// checks at import time (id uniqueness, dependsOn cycles, mode/args
// coherence) so surface-check fails fast if a contributor adds a malformed
// entry.
const STEPS = orchestratorSteps();

// Defense-in-depth: assert dependsOn references resolve and point only at
// earlier stages. The registry already enforces this; surface-check repeats
// the assertion so a future change that bypasses the helper still fails
// loud here.
{
  const idToStage = new Map(STEPS.map((s) => [s.id, s.stage]));
  for (const step of STEPS) {
    for (const dep of step.dependsOn ?? []) {
      if (!idToStage.has(dep)) {
        throw new Error(`Step "${step.id}" depends on unknown id "${dep}".`);
      }
      if (idToStage.get(dep) >= step.stage) {
        throw new Error(
          `Step "${step.id}" (stage ${step.stage}) depends on "${dep}" (stage ${idToStage.get(dep)}); dependency must be in an earlier stage.`,
        );
      }
    }
  }
}

const { values: cli } = parseArgs({
  options: {
    only: { type: "string" },
    skip: { type: "string" },
    "no-bail": { type: "boolean", default: false },
    bail: { type: "boolean", default: true },
    list: { type: "boolean", default: false },
    serial: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (cli.help) {
  console.log(
    "Usage: node scripts/surface-check.mjs [--only=id,...] [--skip=id,...] [--no-bail] [--list] [--serial]",
  );
  process.exit(0);
}

if (cli.list) {
  console.log("Steps (stage / id / label):");
  for (const s of STEPS) {
    console.log(`  ${s.stage}  ${s.id.padEnd(34)} ${s.label}`);
  }
  process.exit(0);
}

const onlySet = cli.only ? new Set(cli.only.split(",").map((s) => s.trim()).filter(Boolean)) : null;
const skipSet = cli.skip ? new Set(cli.skip.split(",").map((s) => s.trim()).filter(Boolean)) : new Set();
const bail = cli["no-bail"] ? false : cli.bail;

const knownIds = new Set(STEPS.map((s) => s.id));
for (const id of [...(onlySet ?? []), ...skipSet]) {
  if (!knownIds.has(id)) {
    console.error(`Unknown step id: "${id}". Run --list for the inventory.`);
    process.exit(2);
  }
}

const selected = STEPS.filter((s) => {
  if (onlySet && !onlySet.has(s.id)) return false;
  if (skipSet.has(s.id)) return false;
  return true;
});

if (selected.length === 0) {
  console.error("No steps selected.");
  process.exit(2);
}

const HR = "─".repeat(72);

function runOne(step) {
  return new Promise((resolve) => {
    const start = performance.now();
    const [exe, ...args] = step.cmd;
    const chunks = [];
    const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (b) => chunks.push({ stream: "out", b }));
    child.stderr.on("data", (b) => chunks.push({ stream: "err", b }));
    child.on("error", (err) => {
      resolve({
        step,
        code: 1,
        ms: performance.now() - start,
        output: `spawn error: ${err.message}\n`,
      });
    });
    child.on("close", (code) => {
      const output = chunks.map((c) => c.b.toString("utf8")).join("");
      resolve({ step, code: code ?? 1, ms: performance.now() - start, output });
    });
  });
}

function formatMs(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const stages = new Map();
for (const step of selected) {
  if (!stages.has(step.stage)) stages.set(step.stage, []);
  stages.get(step.stage).push(step);
}
const stageOrder = [...stages.keys()].sort((a, b) => a - b);

const results = [];
let failed = false;

for (const stageId of stageOrder) {
  const stageSteps = stages.get(stageId);
  console.log(`\n${HR}\nstage ${stageId} (${stageSteps.length} step${stageSteps.length === 1 ? "" : "s"})\n${HR}`);

  const stageResults = cli.serial
    ? await stageSteps.reduce(async (acc, step) => {
        const arr = await acc;
        const r = await runOne(step);
        return [...arr, r];
      }, Promise.resolve([]))
    : await Promise.all(stageSteps.map(runOne));

  for (const r of stageResults) {
    const ok = r.code === 0;
    const tag = ok ? "PASS" : "FAIL";
    console.log(`\n[${tag}] ${r.step.id}  (${formatMs(r.ms)})  -- ${r.step.label}`);
    if (r.output.trim().length > 0) {
      const indented = r.output.replace(/\r?\n$/, "").split("\n").map((l) => `  ${l}`).join("\n");
      console.log(indented);
    }
    if (!ok) failed = true;
    results.push(r);
  }

  if (failed && bail) {
    break;
  }
}

console.log(`\n${HR}\nsurface:check summary\n${HR}`);
const totalMs = results.reduce((a, r) => a + r.ms, 0);
const passCount = results.filter((r) => r.code === 0).length;
const failCount = results.length - passCount;
const skipCount = selected.length - results.length;

for (const r of results) {
  const mark = r.code === 0 ? "OK  " : "FAIL";
  console.log(`  ${mark}  ${r.step.id.padEnd(34)} ${formatMs(r.ms).padStart(7)}`);
}
if (skipCount > 0) {
  for (const step of selected.slice(results.length)) {
    console.log(`  SKIP  ${step.id.padEnd(34)}    --   (bailed before stage ${step.stage})`);
  }
}
console.log(`\n  ${passCount} passed, ${failCount} failed${skipCount > 0 ? `, ${skipCount} skipped` : ""}  (wall-clock summed: ${formatMs(totalMs)})`);

if (failed) {
  console.log("\nFAIL: one or more surface:check gates failed. Re-run with");
  console.log("`pnpm surface:check --only=<id>` to iterate on a single gate,");
  console.log("or `--no-bail` to see every failure in one pass.");
  process.exit(1);
}
console.log("\nOK: every selected surface:check gate passed.");
