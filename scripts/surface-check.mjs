#!/usr/bin/env node
// `pnpm surface:check` — orchestrator for every static gate that protects the
// Mobile Surfaces contract (Zod source of truth, generated derivatives,
// Swift parity, App Group identity, trap catalog, doc snapshots).
//
// Replaces a 19-step `&&` chain. Each step is a named object so a failure
// surfaces a clear "which gate failed" header instead of a bare exit code,
// and so contributors can scope a run with `--only` / `--skip`.
//
// All steps in this chain run in `--check` mode (or are intrinsically
// read-only validators). They do not mutate the working tree, so they are
// safe to run concurrently. Steps are grouped into stages purely so output
// stays legible: every step inside a stage runs in parallel; stages run in
// sequence. The intra-stage grouping mirrors the conceptual layers
// (source-of-truth validation -> generated-file drift checks -> parity and
// boundary checks -> environment/config probes -> tests and trap catalog ->
// trap-derived generated files), which preserves the original chain's order
// as a contract.
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

const NODE_FLAGS = ["--experimental-strip-types", "--no-warnings=ExperimentalWarning"];

// Helper for the common pattern: invoke node on a script under scripts/ with
// the project's standard --experimental-strip-types flags.
function nodeStep(scriptPath, scriptArgs = []) {
  return ["node", ...NODE_FLAGS, scriptPath, ...scriptArgs];
}

// Step inventory. `stage` controls execution grouping (sequential between
// stages, parallel within). `dependsOn` is informational/asserted: every id
// in `dependsOn` must appear in an earlier stage. The chain's load-bearing
// ordering is encoded by stage assignment.
const STEPS = [
  // Stage 1: source-of-truth validation. Nothing here depends on anything
  // else in this run; these read pure source files (Zod schemas, JSON
  // fixtures, the trap catalog) and assert internal consistency.
  {
    id: "validate-surface-fixtures",
    label: "validate surface fixtures against Zod",
    stage: 1,
    cmd: nodeStep("scripts/validate-surface-fixtures.mjs"),
  },
  {
    id: "validate-trap-catalog",
    label: "validate data/traps.json catalog",
    stage: 1,
    cmd: nodeStep("scripts/validate-trap-catalog.mjs"),
  },

  // Stage 2: generated-file drift checks. Each --check mode regenerates in
  // memory from its source and diffs the committed file. They are read-only
  // and independent of each other; running in parallel is safe.
  {
    id: "build-schema",
    label: "JSON Schema in sync with Zod source",
    stage: 2,
    cmd: nodeStep("scripts/build-schema.mjs", ["--check"]),
    dependsOn: ["validate-surface-fixtures"],
  },
  {
    id: "generate-surface-fixtures",
    label: "TS fixtures in sync with JSON sources",
    stage: 2,
    cmd: nodeStep("scripts/generate-surface-fixtures.mjs", ["--check"]),
    dependsOn: ["validate-surface-fixtures"],
  },
  {
    id: "generate-app-group-constants",
    label: "App Group constants in sync with app.json",
    stage: 2,
    cmd: nodeStep("scripts/generate-app-group-constants.mjs", ["--check"]),
  },

  // Stage 3: Swift parity and boundary checks. Each scans a distinct slice
  // of the repo; no shared mutable state. The activity-attributes and
  // surface-snapshots scripts read the same Zod schema the stage-2 check
  // validates against the committed JSON Schema, so they conceptually run
  // after stage 2 to ensure we report Zod-source issues first.
  {
    id: "check-activity-attributes",
    label: "ActivityKit Swift attributes match Zod (MS002/MS003/MS004)",
    stage: 3,
    cmd: nodeStep("scripts/check-activity-attributes.mjs"),
    dependsOn: ["build-schema"],
  },
  {
    id: "check-surface-snapshots",
    label: "Swift snapshot structs match Zod projection outputs (MS036)",
    stage: 3,
    cmd: nodeStep("scripts/check-surface-snapshots.mjs"),
    dependsOn: ["build-schema"],
  },
  {
    id: "check-adapter-boundary",
    label: "Live Activity adapter boundary intact (MS001)",
    stage: 3,
    cmd: nodeStep("scripts/check-adapter-boundary.mjs"),
  },
  {
    id: "check-validator-sync",
    label: "validator re-exports in sync with source",
    stage: 3,
    cmd: nodeStep("scripts/check-validator-sync.mjs"),
  },
  {
    id: "check-app-group-identity",
    label: "App Group identifier parity across 4 sources (MS013)",
    stage: 3,
    cmd: nodeStep("scripts/check-app-group-identity.mjs"),
    dependsOn: ["generate-app-group-constants"],
  },
  {
    id: "check-ios-gitignore",
    label: "apps/mobile/ios is gitignored and untracked (MS029)",
    stage: 3,
    cmd: nodeStep("scripts/check-ios-gitignore.mjs"),
  },

  // Stage 4: environment/config probes. Read-only inspection of app.json,
  // package.json pins, and doc files for stale schema-version literals.
  {
    id: "check-external-pins",
    label: "external pin discipline (MS010/MS026)",
    stage: 4,
    cmd: nodeStep("scripts/check-external-pins.mjs"),
  },
  {
    id: "probe-app-config",
    label: "app.json + package.json audit (MS012/MS018/MS024/MS025/MS027)",
    stage: 4,
    cmd: nodeStep("scripts/probe-app-config.mjs"),
  },
  {
    id: "check-doc-schema-version",
    label: "doc schemaVersion literals match canonical major",
    stage: 4,
    cmd: nodeStep("scripts/check-doc-schema-version.mjs"),
  },

  // Stage 5: full contract test suite. This is the broadest gate; it
  // exercises Zod parsing, projections, migrations, and Standard Schema
  // interop. Runs after stage 1-4 so its output appears after the
  // narrower drift/parity reports it complements.
  {
    id: "surface-contracts-tests",
    label: "surface-contracts.test.mjs (full unit suite)",
    stage: 5,
    cmd: ["node", ...NODE_FLAGS, "--test", "scripts/surface-contracts.test.mjs"],
    dependsOn: ["build-schema"],
  },

  // Stage 6: trap-derived files. The trap catalog must validate before
  // anything that consumes it.
  {
    id: "check-trap-error-binding",
    label: "trap catalog error-class citations resolve",
    stage: 6,
    cmd: nodeStep("scripts/check-trap-error-binding.mjs"),
    dependsOn: ["validate-trap-catalog"],
  },
  {
    id: "generate-trap-bindings",
    label: "packages/push/src/trap-bindings.ts in sync with traps.json",
    stage: 6,
    cmd: nodeStep("scripts/generate-trap-bindings.mjs", ["--check"]),
    dependsOn: ["validate-trap-catalog"],
  },
  {
    id: "generate-traps-data",
    label: "packages/surface-contracts/src/traps-data.ts in sync",
    stage: 6,
    cmd: nodeStep("scripts/generate-traps-data.mjs", ["--check"]),
    dependsOn: ["validate-trap-catalog"],
  },
  {
    id: "build-agents-md",
    label: "AGENTS.md / CLAUDE.md in sync with traps.json",
    stage: 6,
    cmd: nodeStep("scripts/build-agents-md.mjs", ["--check"]),
    dependsOn: ["validate-trap-catalog"],
  },
];

// Defense-in-depth: assert dependsOn references resolve and never point
// forward (i.e., every dependency lives in an earlier stage). Catches
// future edits that accidentally invert the order.
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
// `bail` defaults true; --no-bail flips it off.
const bail = cli["no-bail"] ? false : cli.bail;

// Validate --only / --skip ids against the inventory; a typo should fail
// loud, not silently run nothing.
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

// Group selected steps by stage, preserving stage ordering.
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

  // Emit per-step output in stage order so the log is deterministic across
  // runs even though execution was concurrent.
  for (const r of stageResults) {
    const ok = r.code === 0;
    const tag = ok ? "PASS" : "FAIL";
    console.log(`\n[${tag}] ${r.step.id}  (${formatMs(r.ms)})  -- ${r.step.label}`);
    if (r.output.trim().length > 0) {
      // Indent script output two spaces so it visually nests under the step
      // header without losing copy-pastable file paths.
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

// Final summary table.
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
