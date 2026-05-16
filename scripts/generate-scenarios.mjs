#!/usr/bin/env node
// Generate packages/surface-contracts/src/scenarios.ts from
// data/scenarios/*.json. Each scenario step's five per-surface snapshots
// are parsed through liveSurfaceSnapshot.safeParse at generate time so a
// malformed scenario cannot ship — same discipline applied to the
// per-surface fixture corpus by validate-surface-fixtures.mjs.
//
// The generated TS bundle is consumed by the apps/mobile harness only
// (demo-only sugar). It is NOT re-exported from
// @mobile-surfaces/surface-contracts/src/index.ts so a future consumer
// cannot pick up a public commitment by deep-importing it.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { liveSurfaceSnapshot } from "../packages/surface-contracts/src/schema.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCENARIO_DIR = resolve(REPO_ROOT, "data/scenarios");
const OUT = resolve(REPO_ROOT, "packages/surface-contracts/src/scenarios.ts");

const { values } = parseArgs({
  options: { check: { type: "boolean", default: false } },
});

function loadIndex() {
  const raw = JSON.parse(
    readFileSync(join(SCENARIO_DIR, "index.json"), "utf8"),
  );
  if (!Array.isArray(raw?.scenarios)) {
    throw new Error(
      "data/scenarios/index.json must declare a `scenarios` array.",
    );
  }
  return raw.scenarios;
}

function camelCase(id) {
  return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function loadScenario(file) {
  const path = join(SCENARIO_DIR, file);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const { $schema, ...rest } = raw;
  if (typeof rest.id !== "string" || typeof rest.title !== "string") {
    throw new Error(`${file}: scenario must declare id and title`);
  }
  if (!Array.isArray(rest.steps) || rest.steps.length === 0) {
    throw new Error(`${file}: scenario must declare at least one step`);
  }
  for (const step of rest.steps) {
    if (typeof step.id !== "string" || typeof step.label !== "string") {
      throw new Error(`${file}: every step must declare id and label`);
    }
    const kinds = ["liveActivity", "widget", "control", "lockAccessory", "standby"];
    for (const kind of kinds) {
      const snap = step.snapshots?.[kind];
      if (!snap) {
        throw new Error(
          `${file}: step "${step.id}" is missing the "${kind}" snapshot`,
        );
      }
      const parsed = liveSurfaceSnapshot.safeParse(snap);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ");
        throw new Error(
          `${file}: step "${step.id}" ${kind} snapshot failed validation: ${issues}`,
        );
      }
      if (parsed.data.kind !== kind) {
        throw new Error(
          `${file}: step "${step.id}" expected ${kind}-kind snapshot under .snapshots.${kind}, got ${parsed.data.kind}`,
        );
      }
    }
  }
  return rest;
}

const scenarios = loadIndex().map(loadScenario);

const body = [
  "// Generated from data/scenarios/*.json by scripts/generate-scenarios.mjs.",
  "// Edit the JSON sources and run `pnpm surface:check` (or",
  "// `node --experimental-strip-types scripts/generate-scenarios.mjs`) to",
  "// regenerate. Demo-only: not re-exported from index.ts.",
  "",
  'import type {',
  "  LiveSurfaceSnapshotLiveActivity,",
  "  LiveSurfaceSnapshotWidget,",
  "  LiveSurfaceSnapshotControl,",
  "  LiveSurfaceSnapshotLockAccessory,",
  "  LiveSurfaceSnapshotStandby,",
  '} from "./schema.ts";',
  "",
  "export interface LiveSurfaceScenarioStep {",
  "  readonly id: string;",
  "  readonly label: string;",
  "  readonly snapshots: {",
  "    readonly liveActivity: LiveSurfaceSnapshotLiveActivity;",
  "    readonly widget: LiveSurfaceSnapshotWidget;",
  "    readonly control: LiveSurfaceSnapshotControl;",
  "    readonly lockAccessory: LiveSurfaceSnapshotLockAccessory;",
  "    readonly standby: LiveSurfaceSnapshotStandby;",
  "  };",
  "}",
  "",
  "export interface LiveSurfaceScenario {",
  "  readonly id: string;",
  "  readonly title: string;",
  "  readonly summary: string;",
  "  readonly steps: ReadonlyArray<LiveSurfaceScenarioStep>;",
  "}",
  "",
  "export const surfaceScenarios = {",
];

for (const scenario of scenarios) {
  body.push(`  ${JSON.stringify(camelCase(scenario.id))}: ${JSON.stringify(scenario, null, 2)
    .split("\n")
    .map((line, idx) => (idx === 0 ? line : "  " + line))
    .join("\n")},`);
}

body.push("} as const satisfies Record<string, LiveSurfaceScenario>;");
body.push("");
body.push("export type LiveSurfaceScenarioId = keyof typeof surfaceScenarios;");
body.push("");

const out = body.join("\n");

if (values.check) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    console.error(`Missing ${OUT}; run without --check to generate.`);
    process.exit(1);
  }
  if (current !== out) {
    console.error(
      OUT +
        " is out of date. Run `node --experimental-strip-types scripts/generate-scenarios.mjs` to regenerate.",
    );
    process.exit(1);
  }
  console.log(`Up to date: ${OUT}`);
} else {
  writeFileSync(OUT, out);
  console.log(`Wrote ${OUT}`);
}
