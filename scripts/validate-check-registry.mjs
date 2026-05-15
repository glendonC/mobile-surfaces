#!/usr/bin/env node
// Cross-validates scripts/lib/check-registry.mjs against data/traps.json and
// the on-disk scripts/check-*.mjs corpus. Closes the historical drift hole
// where a check could land in surface-check, be forgotten in diagnose, and
// miss its trap citation in the catalog. With this gate in place, the
// registry is the single source of truth and every consumer derives from it
// — but a new MS-rule cited in traps.json with no registry entry, or a new
// check-*.mjs file with no registry entry, fails CI.
//
// Checks (each emitted as its own DiagnosticReport entry):
//   - registry-import: the registry module imported without throwing. The
//     registry's own import-time defense covers id uniqueness, dependsOn
//     cycles, mode/args coherence, and forbidden trap-id substrings in
//     labels; this check just surfaces the failure cleanly in diagnose.
//   - traps-to-registry: every trap in data/traps.json with detection:
//     "static" cites an enforcement.script that exists in the registry,
//     AND the corresponding registry entry's trapIds[] includes the trap.
//   - registry-to-traps: every registry entry's trapIds[] member exists in
//     the catalog and names the same script as its enforcement.script.
//   - unregistered-check-scripts: every scripts/check-*.mjs / validate-*.mjs
//     / probe-*.mjs file (excluding *.test.mjs) is either in the registry
//     or on the explicit allowlist (initially empty).

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS_DIR = resolve(REPO_ROOT, "scripts");

const { values } = parseArgs({
  options: {
    json: { type: "boolean", default: false },
  },
});

// Scripts that are intentionally not in the registry (one-off helpers,
// shell wrappers, etc.). Keep empty; explicit additions only.
const UNREGISTERED_ALLOWLIST = new Set([
  // e.g. "scripts/check-something-special.mjs"
]);

const checks = [];

// 1. Registry import.
let registry;
try {
  ({ checkRegistry: registry } = await import("./lib/check-registry.mjs"));
  checks.push({
    id: "registry-import",
    status: "ok",
    summary: "scripts/lib/check-registry.mjs imports cleanly.",
  });
} catch (err) {
  checks.push({
    id: "registry-import",
    status: "fail",
    summary: "scripts/lib/check-registry.mjs failed import-time validation.",
    detail: { message: String(err?.message ?? err) },
  });
  emitDiagnosticReport(buildReport("validate-check-registry", checks), {
    json: values.json,
  });
  process.exit(0); // emitDiagnosticReport exits on fail
}

// Load the trap catalog once.
const trapsJsonPath = resolve(REPO_ROOT, "data/traps.json");
const trapsRaw = JSON.parse(readFileSync(trapsJsonPath, "utf8"));
const trapEntries = Array.isArray(trapsRaw)
  ? trapsRaw
  : Array.isArray(trapsRaw?.entries)
    ? trapsRaw.entries
    : [];
const staticTraps = trapEntries.filter((t) => t.detection === "static");

// 2. traps → registry: every static trap's enforcement.script is in the
//    registry AND that entry's trapIds includes the trap.
{
  const issues = [];
  for (const trap of staticTraps) {
    const script = trap.enforcement?.script;
    if (!script) {
      issues.push({
        path: trap.id,
        message: `trap declares detection: "static" but has no enforcement.script`,
      });
      continue;
    }
    const entry = registry.find((e) => e.script === script);
    if (!entry) {
      issues.push({
        path: trap.id,
        message: `trap cites ${script}, which is not in scripts/lib/check-registry.mjs`,
      });
      continue;
    }
    if (!entry.trapIds?.includes(trap.id)) {
      issues.push({
        path: trap.id,
        message: `registry entry "${entry.id}" enforces this trap but does not list ${trap.id} in trapIds[]`,
      });
    }
  }
  checks.push({
    id: "traps-to-registry",
    status: issues.length === 0 ? "ok" : "fail",
    summary:
      issues.length === 0
        ? `${staticTraps.length} static-detection traps map to registry entries.`
        : `${issues.length} static trap(s) drift from the registry.`,
    ...(issues.length === 0 ? {} : { detail: { issues } }),
  });
}

// 3. registry → traps: every trapIds[] member exists in the catalog and
//    points back at this script.
{
  const issues = [];
  const trapById = new Map(trapEntries.map((t) => [t.id, t]));
  for (const entry of registry) {
    for (const trapId of entry.trapIds ?? []) {
      const trap = trapById.get(trapId);
      if (!trap) {
        issues.push({
          path: entry.id,
          message: `claims trapId "${trapId}" which does not exist in data/traps.json`,
        });
        continue;
      }
      if (trap.enforcement?.script !== entry.script) {
        issues.push({
          path: entry.id,
          message: `claims trapId "${trapId}" but the catalog cites ${trap.enforcement?.script ?? "(no script)"} for that trap, not ${entry.script}`,
        });
      }
    }
  }
  checks.push({
    id: "registry-to-traps",
    status: issues.length === 0 ? "ok" : "fail",
    summary:
      issues.length === 0
        ? `every registry trapIds[] member resolves in data/traps.json.`
        : `${issues.length} registry entry trapIds[] member(s) drift from the catalog.`,
    ...(issues.length === 0 ? {} : { detail: { issues } }),
  });
}

// 4. unregistered-check-scripts: every check / validate / probe under
//    scripts/ is in the registry or on the explicit allowlist.
{
  const missing = [];
  const scriptsOnDisk = readdirSync(SCRIPTS_DIR)
    .filter((f) => /^(check|validate|probe)-.*\.mjs$/.test(f))
    .filter((f) => !f.endsWith(".test.mjs"))
    .map((f) => `scripts/${f}`);
  const registryScripts = new Set(registry.map((e) => e.script));
  for (const path of scriptsOnDisk) {
    if (registryScripts.has(path)) continue;
    if (UNREGISTERED_ALLOWLIST.has(path)) continue;
    missing.push(path);
  }
  checks.push({
    id: "unregistered-check-scripts",
    status: missing.length === 0 ? "ok" : "fail",
    summary:
      missing.length === 0
        ? `every check/validate/probe script under scripts/ is registered.`
        : `${missing.length} script(s) on disk are not in scripts/lib/check-registry.mjs.`,
    ...(missing.length === 0
      ? {}
      : { detail: { paths: missing } }),
  });
}

emitDiagnosticReport(buildReport("validate-check-registry", checks), {
  json: values.json,
});
