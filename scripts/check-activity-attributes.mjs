#!/usr/bin/env node
// Three checks against the ActivityKit attribute files:
//   1. The two `MobileSurfacesActivityAttributes.swift` files (Expo module +
//      widget target) must be byte-identical (MS002). ActivityKit binds by
//      matching Codable shape across modules at runtime, so any drift is a
//      silent bug.
//   2. The Swift `ContentState` struct must match the Zod
//      `liveSurfaceActivityContentState` source of truth (MS003 — covers
//      both the field set and the JSON-key wire shape that ActivityKit
//      decodes; MS022 was merged into MS003 in 2.2 since both fired for the
//      same class of edit and named the same enforcer).
//   3. The Swift `Stage` enum cases must match the Zod `liveSurfaceStage`
//      options (MS004).
//
// Run via `node --experimental-strip-types` so the TS schema imports
// directly. Pass --json to emit a DiagnosticReport.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  liveSurfaceActivityContentState,
  liveSurfaceStage,
} from "../packages/surface-contracts/src/schema.ts";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import {
  parseContentState,
  parseStageCases,
  resolveExpectedSwiftType,
} from "./lib/swift-content-state.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-activity-attributes";
const moduleDir = path.resolve("packages/live-activity/ios");
const widgetDir = path.resolve("apps/mobile/targets/widget");
const checks = [];

const modulePath = findAttributesFile(moduleDir);
const widgetPath = findAttributesFile(widgetDir);

if (modulePath === null || widgetPath === null) {
  // findAttributesFile already emitted on failure.
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

const filenamesMatch = path.basename(modulePath) === path.basename(widgetPath);
const moduleSource = fs.readFileSync(modulePath, "utf8");
const widgetSource = fs.readFileSync(widgetPath, "utf8");
const byteIdentical = filenamesMatch && moduleSource === widgetSource;

checks.push({
  id: "attributes-byte-identity",
  status: byteIdentical ? "ok" : "fail",
  trapId: "MS002",
  summary: byteIdentical
    ? "ActivityKit attribute definitions are byte-identical."
    : filenamesMatch
      ? "ActivityKit attribute definitions have drifted."
      : "ActivityKit attribute filenames differ between module and widget target.",
  ...(byteIdentical
    ? {}
    : {
        detail: {
          message:
            "Both files are generated from packages/surface-contracts/src/schema.ts. Edit the Zod source if a field changed; otherwise rerun: pnpm codegen:activity-attributes. (The codegen-drift gate at stage 2 normally catches this earlier; if you see this message, codegen was bypassed or one file was hand-edited.)",
          paths: [
            path.relative(process.cwd(), modulePath),
            path.relative(process.cwd(), widgetPath),
          ],
        },
      }),
});

// Bail before parsing if we can't trust the source files.
if (!byteIdentical) {
  emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
}

// ---------- Structural Swift <-> Zod check ----------

const moduleRel = path.relative(process.cwd(), modulePath);
const parsed = parseContentState(moduleSource);
if (!parsed.ok) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "parse-content-state",
        status: "fail",
        summary: `Could not parse ContentState in Swift source: ${parsed.reason}`,
        detail: { paths: [moduleRel] },
      },
    ]),
    { json: values.json },
  );
}
const swiftFields = parsed.fields;
const swiftStages = parseStageCases(moduleSource) ?? [];

const zodFields = Object.entries(liveSurfaceActivityContentState.shape).map(
  ([name, schema]) => ({ name, ...expectedSwiftType(name, schema) }),
);
const zodStages = liveSurfaceStage.options;

const fieldIssues = [];
const stageIssues = [];

// MS003 hinges on the JSON key, not the Swift property name: ActivityKit
// decodes the push payload through Codable, which keys off the
// CodingKeys-resolved name. A `case headline = "title"` decouples the two,
// so an MS003 check that compares Swift identifiers misses it. We match
// Zod keys against Swift jsonKey first, then surface property/type drift
// against the Swift property that owns that jsonKey.
const swiftByJsonKey = new Map();
for (const f of swiftFields) {
  if (f.jsonKey === null) continue;
  swiftByJsonKey.set(f.jsonKey, f);
}
const zodKeySet = new Set(zodFields.map((f) => f.name));

for (const z of zodFields) {
  const swift = swiftByJsonKey.get(z.name);
  if (!swift) {
    fieldIssues.push({
      path: z.name,
      message: `Zod liveSurfaceActivityContentState has key "${z.name}", but no Swift property in ${moduleRel} serializes to that JSON key.`,
    });
    continue;
  }
  if (z.expected === null) {
    fieldIssues.push({
      path: z.name,
      message: `Zod field "${z.name}" uses a shape this checker does not understand (${z.reason}). Extend resolveExpectedSwiftType in scripts/lib/swift-content-state.mjs to teach the checker.`,
    });
    continue;
  }
  if (swift.type !== z.expected) {
    fieldIssues.push({
      path: `${moduleRel}:${swift.line}`,
      message: `field "${swift.name}" (JSON key "${swift.jsonKey}"): Zod expects ${z.expected}, Swift has ${swift.type}`,
    });
  }
  if (swift.name !== z.name) {
    fieldIssues.push({
      path: `${moduleRel}:${swift.line}`,
      message: `CodingKeys remap: Swift property "${swift.name}" serializes as JSON key "${swift.jsonKey}". Zod expects "${z.name}" -> drop the rename or update Zod to match.`,
    });
  }
}

for (const f of swiftFields) {
  if (f.jsonKey === null) {
    fieldIssues.push({
      path: `${moduleRel}:${f.line}`,
      message: `Swift property "${f.name}" is excluded from CodingKeys, so it never reaches the wire. Add it to CodingKeys or remove the property.`,
    });
    continue;
  }
  if (!zodKeySet.has(f.jsonKey)) {
    fieldIssues.push({
      path: `${moduleRel}:${f.line}`,
      message: `Swift property "${f.name}" serializes as JSON key "${f.jsonKey}", which is not present in Zod liveSurfaceActivityContentState.`,
    });
  }
}

const swiftStageNames = new Set(swiftStages.map((s) => s.name));
const zodStageNames = new Set(zodStages);
for (const s of zodStages) {
  if (!swiftStageNames.has(s)) {
    stageIssues.push({
      path: s,
      message: `present in Zod liveSurfaceStage, missing from Swift Stage enum`,
    });
  }
}
for (const s of swiftStages) {
  if (!zodStageNames.has(s.name)) {
    stageIssues.push({
      path: `${moduleRel}:${s.line}`,
      message: `stage case "${s.name}" present in Swift Stage enum, missing from Zod liveSurfaceStage`,
    });
  }
}

checks.push({
  id: "content-state-parity",
  status: fieldIssues.length === 0 ? "ok" : "fail",
  trapId: "MS003",
  summary:
    fieldIssues.length === 0
      ? `Swift ContentState matches Zod liveSurfaceActivityContentState (${zodFields.length} fields).`
      : `${fieldIssues.length} ContentState parity issue${fieldIssues.length === 1 ? "" : "s"}.`,
  ...(fieldIssues.length > 0 ? { detail: { issues: fieldIssues } } : {}),
});

checks.push({
  id: "stage-parity",
  status: stageIssues.length === 0 ? "ok" : "fail",
  trapId: "MS004",
  summary:
    stageIssues.length === 0
      ? `Swift Stage matches Zod liveSurfaceStage (${zodStages.length} cases).`
      : `${stageIssues.length} Stage enum parity issue${stageIssues.length === 1 ? "" : "s"}.`,
  ...(stageIssues.length > 0 ? { detail: { issues: stageIssues } } : {}),
});

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });

// ---------- Helpers ----------

function findAttributesFile(dir) {
  const matches = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith("ActivityAttributes.swift"))
    .map((f) => path.join(dir, f));
  if (matches.length === 0) {
    emitDiagnosticReport(
      buildReport(TOOL, [
        {
          id: "find-attributes",
          status: "fail",
          summary: `No *ActivityAttributes.swift found in ${dir}`,
        },
      ]),
      { json: values.json },
    );
    return null;
  }
  if (matches.length > 1) {
    emitDiagnosticReport(
      buildReport(TOOL, [
        {
          id: "find-attributes",
          status: "fail",
          summary: `Multiple *ActivityAttributes.swift in ${dir}.`,
          detail: { paths: matches },
        },
      ]),
      { json: values.json },
    );
    return null;
  }
  return matches[0];
}

// Resolve a Zod field schema to the Swift type it should serialize as,
// using the shared optionality-aware resolver in
// scripts/lib/swift-content-state.mjs. The Live Activity ContentState's
// `stage` field maps to a nominal Swift `Stage` enum, not the plain
// `String` the shared resolver emits for a generic Zod enum. We special-
// case by field name (the only enum in liveSurfaceActivityContentState is
// `stage`, and `.describe()` makes identity checks against
// `liveSurfaceStage` unreliable). Returns `{ expected, reason }` matching
// the shared resolver's contract.
function expectedSwiftType(name, schema) {
  if (name === "stage" && isStageEnum(schema)) {
    return { expected: "Stage", reason: null };
  }
  return resolveExpectedSwiftType(schema);
}

// Defense-in-depth: confirm the schema we're about to map to `Stage` really
// is the Stage enum (i.e. has the same option set as liveSurfaceStage). A
// future widening of liveSurfaceActivityContentState that adds a different
// enum literal under the field name "stage" would otherwise be silently
// mapped to the wrong Swift type.
function isStageEnum(schema) {
  const def = schema?._zod?.def;
  if (!def || def.type !== "enum") return false;
  const want = new Set(liveSurfaceStage.options);
  const got = new Set(def.entries ? Object.values(def.entries) : []);
  if (want.size !== got.size) return false;
  for (const v of want) if (!got.has(v)) return false;
  return true;
}
