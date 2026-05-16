// @ts-check
//
// Canonical inventory of every check, generator, and probe that participates
// in the Mobile Surfaces invariant chain. Single source of truth for:
//
//   - scripts/surface-check.mjs       (the orchestrator's STEPS list)
//   - scripts/diagnose.mjs            (the redacted bundle's TOOLS list)
//   - scripts/validate-check-registry (the cross-coverage gate against
//                                       data/traps.json)
//
// Before this module existed, the three lists drifted: a check could ship
// in surface-check, be forgotten in diagnose, and miss its trap citation in
// traps.json. Validating against one source closes that hole.
//
// Adding a new check:
//   1. Add the script under scripts/<name>.mjs using buildReport /
//      emitDiagnosticReport from scripts/lib/diagnostics.mjs.
//   2. Add an entry below with the appropriate stage and dependsOn.
//   3. If the check enforces an MS-rule, add the trap to data/traps.json
//      with `enforcement.script` pointing at the same path, and list the
//      trap id in `trapIds` here.
//   4. validate-check-registry asserts (a) every static-detection trap's
//      script is in the registry; (b) every trapIds[] member exists in the
//      catalog and cites this script; (c) every scripts/check-*.mjs file
//      either appears in the registry or on the explicit unregistered
//      allowlist.

/**
 * @typedef {Object} CheckEntry
 * @property {string} id
 *   Stable id used by surface-check --only/--skip filters and the summary
 *   table. Must be unique across the registry.
 * @property {string} label
 *   Human-readable one-liner for surface-check output. Free prose; trap ids
 *   belong in `trapIds`, NOT embedded in the label.
 * @property {number} stage
 *   1-N. Stages run sequentially; entries within a stage run in parallel.
 * @property {string[]} [dependsOn]
 *   Other registry ids that must run earlier. Asserted at import time:
 *   every dep must exist and live in a strictly earlier stage.
 * @property {string} script
 *   Repo-root-relative path to the script.
 * @property {string[]} [args]
 *   Extra argv. --json is added by diagnose; do not include it here.
 * @property {"node-script" | "node-test"} [runner]
 *   "node-script" (default) spawns `node ...flags <script> ...args`.
 *   "node-test" spawns `node ...flags --test <script>` (for the contract
 *   test suite). The test runner emits no DiagnosticReport so it cannot
 *   join the diagnose bundle.
 * @property {boolean} diagnose
 *   Include this entry in the diagnose bundle. Set false for runners that
 *   do not emit a DiagnosticReport (node --test) and for writers (template
 *   builders) that have side effects.
 * @property {string[]} [trapIds]
 *   MS-ids this check enforces. Cross-validated against data/traps.json by
 *   validate-check-registry: every trap with detection: "static" and
 *   enforcement.script === entry.script must appear here, and every id
 *   listed here must exist in the catalog and name this script.
 * @property {"check-mode" | "single-mode"} mode
 *   "check-mode": a generator invoked with --check that regenerates in
 *   memory and diffs the committed file. Must have "--check" in args.
 *   "single-mode": an intrinsic validator. Must NOT have "--check" in args.
 * @property {boolean} [json]
 *   Default true. Set false only for node-test runners which do not emit a
 *   DiagnosticReport. Diagnose skips entries with json === false.
 */

/**
 * @type {readonly CheckEntry[]}
 */
export const checkRegistry = Object.freeze([
  // Self-validation: runs first so every other gate inherits a consistent
  // registry. validate-check-registry asserts three-way closure against
  // data/traps.json and scripts/check-*.mjs.
  {
    id: "validate-check-registry",
    label: "check registry consistent across orchestrator, diagnose, and traps.json",
    stage: 1,
    script: "scripts/validate-check-registry.mjs",
    diagnose: true,
    mode: "single-mode",
  },

  // Stage 1: source-of-truth validation. Read pure source files (Zod
  // schemas, JSON fixtures, the trap catalog) and assert internal
  // consistency. Nothing in stage 1 depends on anything else in this run.
  {
    id: "validate-surface-fixtures",
    label: "validate surface fixtures against Zod",
    stage: 1,
    script: "scripts/validate-surface-fixtures.mjs",
    diagnose: true,
    mode: "single-mode",
    trapIds: ["MS007"],
  },
  {
    id: "validate-trap-catalog",
    label: "validate data/traps.json catalog",
    stage: 1,
    script: "scripts/validate-trap-catalog.mjs",
    diagnose: true,
    mode: "single-mode",
  },

  // Stage 2: generated-file drift checks. --check mode regenerates in
  // memory from the source and diffs the committed file. Read-only and
  // independent; running in parallel is safe.
  {
    id: "build-schema",
    label: "JSON Schema in sync with Zod source",
    stage: 2,
    dependsOn: ["validate-surface-fixtures"],
    script: "scripts/build-schema.mjs",
    args: ["--check"],
    diagnose: true,
    mode: "check-mode",
    trapIds: ["MS006"],
  },
  {
    id: "generate-surface-fixtures",
    label: "TS fixtures in sync with JSON sources",
    stage: 2,
    dependsOn: ["validate-surface-fixtures"],
    script: "scripts/generate-surface-fixtures.mjs",
    args: ["--check"],
    diagnose: true,
    mode: "check-mode",
    trapIds: ["MS009"],
  },
  {
    id: "generate-app-group-constants",
    label: "App Group constants in sync with app.json",
    stage: 2,
    script: "scripts/generate-app-group-constants.mjs",
    args: ["--check"],
    diagnose: false,
    mode: "check-mode",
  },
  {
    id: "generate-scenarios",
    label: "scenarios.ts in sync with data/scenarios/*.json",
    stage: 2,
    dependsOn: ["validate-surface-fixtures"],
    script: "scripts/generate-scenarios.mjs",
    args: ["--check"],
    diagnose: false,
    mode: "check-mode",
  },
  // codegen for both MobileSurfacesActivityAttributes.swift copies. Source
  // of truth is liveSurfaceActivityContentState + liveSurfaceStage. Runs at
  // stage 2 so drift fails before the stage-3 byte-identity + Zod parity
  // gate; when this passes, the two committed files are byte-identical to
  // the codegen output, which means byte-identical to each other and in
  // sync with the Zod source.
  {
    id: "generate-activity-attributes",
    label: "MobileSurfacesActivityAttributes.swift in sync with Zod source",
    stage: 2,
    script: "scripts/generate-activity-attributes.mjs",
    args: ["--check"],
    diagnose: false,
    mode: "check-mode",
  },
  {
    id: "generate-notification-categories",
    label: "notification category outputs in sync with canonical registry",
    stage: 2,
    script: "scripts/generate-notification-categories.mjs",
    args: ["--check"],
    diagnose: true,
    mode: "check-mode",
    trapIds: ["MS037"],
  },
  // Ajv ↔ Zod parity belongs in stage 3 because it depends on build-schema
  // having already passed its --check (stage 2): the gate reads the
  // committed schema.json and asserts every fixture validates identically
  // under Ajv (the validator non-TS consumers pin via unpkg) and Zod (the
  // source of truth). Drift here is the load-bearing failure mode the
  // published artifact is supposed to prevent.

  // Stage 3: Swift parity and boundary checks. Each scans a distinct slice
  // of the repo with no shared mutable state. The activity-attributes and
  // surface-snapshots scripts read the same Zod schema that stage 2
  // validates against the committed JSON Schema; running after stage 2
  // ensures Zod-source issues surface first.
  {
    id: "check-ajv-zod-parity",
    label: "published JSON Schema validates fixtures identically to Zod source",
    stage: 3,
    dependsOn: ["validate-surface-fixtures", "build-schema"],
    script: "scripts/check-ajv-zod-parity.mjs",
    diagnose: true,
    mode: "single-mode",
  },
  {
    id: "check-activity-attributes",
    label: "ActivityKit Swift attributes match Zod",
    stage: 3,
    dependsOn: ["build-schema", "generate-activity-attributes"],
    script: "scripts/check-activity-attributes.mjs",
    diagnose: true,
    mode: "single-mode",
    trapIds: ["MS002", "MS003", "MS004"],
  },
  {
    id: "check-surface-snapshots",
    label: "Swift snapshot structs match Zod projection outputs",
    stage: 3,
    dependsOn: ["build-schema"],
    script: "scripts/check-surface-snapshots.mjs",
    diagnose: true,
    mode: "single-mode",
    trapIds: ["MS036"],
  },
  {
    id: "check-adapter-boundary",
    label: "Live Activity adapter boundary intact",
    stage: 3,
    script: "scripts/check-adapter-boundary.mjs",
    diagnose: true,
    mode: "single-mode",
    trapIds: ["MS001"],
  },
  {
    id: "check-adapter-parses",
    label: "Live Activity adapter parses content state on entry",
    stage: 3,
    script: "scripts/check-adapter-parses.mjs",
    diagnose: true,
    mode: "single-mode",
    trapIds: ["MS038"],
  },
  {
    id: "check-token-discipline",
    label: "ActivityKit token subscriptions routed through @mobile-surfaces/tokens",
    stage: 3,
    script: "scripts/check-token-discipline.mjs",
    diagnose: true,
    mode: "single-mode",
    trapIds: ["MS039"],
  },
  {
    id: "check-validator-sync",
    label: "validator re-exports in sync with source",
    stage: 3,
    script: "scripts/check-validator-sync.mjs",
    diagnose: true,
    mode: "single-mode",
  },
  {
    id: "check-app-group-identity",
    label: "App Group identifier parity across declaration sites",
    stage: 3,
    dependsOn: ["generate-app-group-constants"],
    script: "scripts/check-app-group-identity.mjs",
    diagnose: true,
    mode: "single-mode",
    trapIds: ["MS013"],
  },
  {
    id: "check-ios-gitignore",
    label: "apps/mobile/ios is gitignored and untracked",
    stage: 3,
    script: "scripts/check-ios-gitignore.mjs",
    diagnose: true,
    mode: "single-mode",
    trapIds: ["MS029"],
  },

  // Stage 4: environment/config probes. Read-only inspection of app.json,
  // package.json pins, and doc files for stale schema-version literals.
  {
    id: "check-external-pins",
    label: "external pin discipline",
    stage: 4,
    script: "scripts/check-external-pins.mjs",
    diagnose: true,
    mode: "single-mode",
  },
  {
    id: "probe-app-config",
    label: "app.json + package.json audit",
    stage: 4,
    script: "scripts/probe-app-config.mjs",
    diagnose: true,
    mode: "single-mode",
    trapIds: ["MS012", "MS024", "MS025", "MS027"],
  },
  {
    id: "check-doc-schema-version",
    label: "doc schemaVersion literals match canonical major",
    stage: 4,
    script: "scripts/check-doc-schema-version.mjs",
    diagnose: true,
    mode: "single-mode",
  },

  // Stage 5: full contract test suite. Broadest gate; exercises Zod
  // parsing, projections, migrations, and Standard Schema interop. Runs
  // after stages 1-4 so its output appears after the narrower drift /
  // parity reports it complements.
  {
    id: "surface-contracts-tests",
    label: "surface-contracts.test.mjs (full unit suite)",
    stage: 5,
    dependsOn: ["build-schema"],
    script: "scripts/surface-contracts.test.mjs",
    runner: "node-test",
    diagnose: false,
    mode: "single-mode",
    json: false,
    trapIds: ["MS008"],
  },

  // Stage 6: trap-derived files. The trap catalog must validate before
  // anything that consumes it.
  {
    id: "check-trap-error-binding",
    label: "trap catalog error-class citations resolve",
    stage: 6,
    dependsOn: ["validate-trap-catalog"],
    script: "scripts/check-trap-error-binding.mjs",
    diagnose: true,
    mode: "single-mode",
  },
  {
    id: "generate-traps-package",
    label: "@mobile-surfaces/traps bindings + Swift replicas in sync with traps.json",
    stage: 6,
    dependsOn: ["validate-trap-catalog"],
    script: "scripts/generate-traps-package.mjs",
    args: ["--check"],
    diagnose: true,
    mode: "check-mode",
  },
  {
    id: "check-traps-swift-byte-identity",
    label: "MobileSurfacesTraps.swift byte-identical across the three sites",
    stage: 7,
    dependsOn: ["generate-traps-package"],
    script: "scripts/check-traps-swift-byte-identity.mjs",
    diagnose: true,
    mode: "single-mode",
    trapIds: ["MS040"],
  },
  {
    id: "build-agents-md",
    label: "AGENTS.md / CLAUDE.md in sync with traps.json",
    stage: 6,
    dependsOn: ["validate-trap-catalog"],
    script: "scripts/build-agents-md.mjs",
    args: ["--check"],
    diagnose: false,
    mode: "check-mode",
  },

  // Diagnose-only probes. These do not participate in surface-check (they
  // are not gates — they describe the local environment for paste-in bug
  // reports) but they are part of the diagnose bundle.
  //
  // doctor is the toolchain preflight (MS010); probe-environment captures
  // env-var presence (APNs config), masked.
  {
    id: "doctor",
    label: "toolchain preflight (Node, pnpm, Xcode, simulators)",
    stage: 0,
    script: "scripts/doctor.mjs",
    diagnose: true,
    mode: "single-mode",
    trapIds: ["MS010"],
  },
  {
    id: "probe-environment",
    label: "environment-variable presence (redacted)",
    stage: 0,
    script: "scripts/probe-environment.mjs",
    diagnose: true,
    mode: "single-mode",
  },
]);

// Defense-in-depth: validate the registry at import time so every consumer
// fails fast if the registry is malformed.
{
  const ids = new Set();
  const idToStage = new Map();
  const idToEntry = new Map();
  for (const entry of checkRegistry) {
    if (ids.has(entry.id)) {
      throw new Error(`check-registry: duplicate id "${entry.id}"`);
    }
    ids.add(entry.id);
    idToStage.set(entry.id, entry.stage);
    idToEntry.set(entry.id, entry);
  }
  for (const entry of checkRegistry) {
    for (const dep of entry.dependsOn ?? []) {
      if (!idToStage.has(dep)) {
        throw new Error(
          `check-registry: entry "${entry.id}" depends on unknown id "${dep}"`,
        );
      }
      if (idToStage.get(dep) >= entry.stage) {
        throw new Error(
          `check-registry: entry "${entry.id}" (stage ${entry.stage}) depends on "${dep}" ` +
            `(stage ${idToStage.get(dep)}); dependency must live in an earlier stage.`,
        );
      }
    }
    const hasCheckFlag = (entry.args ?? []).includes("--check");
    if (entry.mode === "check-mode" && !hasCheckFlag) {
      throw new Error(
        `check-registry: entry "${entry.id}" declares mode: "check-mode" but does not pass "--check" in args.`,
      );
    }
    if (entry.mode === "single-mode" && hasCheckFlag) {
      throw new Error(
        `check-registry: entry "${entry.id}" declares mode: "single-mode" but passes "--check" in args.`,
      );
    }
    if (entry.runner === "node-test" && entry.json !== false) {
      throw new Error(
        `check-registry: entry "${entry.id}" uses runner "node-test" and must set json: false ` +
          `(the test runner does not emit a DiagnosticReport).`,
      );
    }
    // Trap ids belong in the trapIds[] array, not embedded in label prose.
    // The diagnose markdown surfaces them per-check; the label is for
    // operators scanning the surface-check log.
    if (/\bMS\d{3}\b/.test(entry.label)) {
      throw new Error(
        `check-registry: entry "${entry.id}" embeds an MS-id in its label ` +
          `("${entry.label}"). Move the id into trapIds[].`,
      );
    }
  }
}

const NODE_FLAGS = ["--experimental-strip-types", "--no-warnings=ExperimentalWarning"];

/**
 * Build the argv for an entry. Returns the array used by spawn / spawnSync.
 *
 * @param {CheckEntry} entry
 * @param {{ json?: boolean }} [opts]
 */
export function buildCommand(entry, opts = {}) {
  const json = opts.json ?? false;
  if (entry.runner === "node-test") {
    // Test runner; --json is meaningless here.
    return ["node", ...NODE_FLAGS, "--test", entry.script];
  }
  const args = [...(entry.args ?? [])];
  if (json && entry.json !== false) {
    args.push("--json");
  }
  return ["node", ...NODE_FLAGS, entry.script, ...args];
}

/**
 * View used by scripts/surface-check.mjs. Returns entries with `stage >= 1`
 * (excludes diagnose-only stage-0 entries) in registry order, with cmd[]
 * pre-built.
 */
export function orchestratorSteps() {
  return checkRegistry
    .filter((entry) => entry.stage >= 1)
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      stage: entry.stage,
      dependsOn: entry.dependsOn,
      cmd: buildCommand(entry, { json: false }),
    }));
}

/**
 * View used by scripts/diagnose.mjs. Returns diagnose-enabled entries in
 * registry order, pre-built with the --json toggle.
 */
export function diagnoseTools() {
  return checkRegistry
    .filter((entry) => entry.diagnose && entry.json !== false)
    .map((entry) => ({
      script: entry.script,
      extra: entry.args ?? [],
      id: entry.id,
    }));
}

/**
 * Lookup helper used by validate-check-registry. Returns the registry
 * entry for a script path, or undefined.
 */
export function findEntryByScript(scriptPath) {
  return checkRegistry.find((entry) => entry.script === scriptPath);
}
