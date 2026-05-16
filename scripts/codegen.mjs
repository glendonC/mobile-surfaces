#!/usr/bin/env node
// Single entrypoint for every contract-protecting generator. Reads the
// canonical inventory from scripts/lib/check-registry.mjs (the same source
// surface-check uses) and fans out to every entry whose `mode === "check-mode"`.
//
// Before this script existed, `pnpm surface:codegen` only ran one generator
// (generate-app-group-constants), the activity-attributes generator hid behind
// its own pnpm script, and release:version chained seven different scripts by
// hand. Each new generator multiplied the drift surface across three call
// sites: surface-check, the release script, and contributor muscle memory.
// One orchestrator collapses that to a single command.
//
// Modes:
//   default     write every generator's output. Equivalent to running every
//               codegen script in the registry without arguments.
//   --check     run every generator with --check (regenerate-in-memory, diff
//               against committed file, exit non-zero on drift). What CI runs
//               via surface-check.
//   --only=<id>[,<id>...]
//               run only the listed registry ids. Useful for iteration.
//
// Order matches the registry's stage order, so generators that consume the
// output of earlier generators (e.g. build-agents-md reads data/traps.json
// which generate-traps-data writes) run in the right sequence.
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { checkRegistry, buildCommand } from "./lib/check-registry.mjs";

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    only: { type: "string" },
  },
  allowPositionals: false,
});

const onlySet = values.only
  ? new Set(values.only.split(",").map((s) => s.trim()).filter(Boolean))
  : null;

if (onlySet) {
  const known = new Set(checkRegistry.map((e) => e.id));
  for (const id of onlySet) {
    if (!known.has(id)) {
      console.error(`codegen: --only id "${id}" is not in the registry.`);
      process.exit(2);
    }
  }
}

const generators = checkRegistry
  .filter((entry) => entry.mode === "check-mode")
  .filter((entry) => (onlySet ? onlySet.has(entry.id) : true));

if (generators.length === 0) {
  console.error("codegen: no generators selected.");
  process.exit(2);
}

let failures = 0;
for (const entry of generators) {
  // Strip --check from the entry's args in write mode, leave it in check mode.
  // The registry pins --check in args[] for all check-mode entries because
  // surface-check is its primary consumer; the codegen orchestrator is the
  // secondary consumer that wants the same scripts in write mode by default.
  const baseArgs = entry.args ?? [];
  const args = values.check
    ? baseArgs
    : baseArgs.filter((a) => a !== "--check");

  const cmd = buildCommand({ ...entry, args }, { json: false });
  const [exe, ...rest] = cmd;
  const tag = values.check ? `${entry.id} --check` : entry.id;
  console.log(`[codegen] ${tag}`);
  const result = spawnSync(exe, rest, { stdio: "inherit" });
  if (result.status !== 0) {
    failures += 1;
    console.error(
      `[codegen] ${entry.id} exited with status ${result.status}.`,
    );
    if (values.check) {
      // In --check mode the first failure is informative on its own; keep
      // going so the user sees every drift in one pass.
      continue;
    }
    // In write mode a failure mid-chain may leave the working tree in a
    // partially-regenerated state; bail rather than compound the mess.
    break;
  }
}

process.exit(failures > 0 ? 1 : 0);
