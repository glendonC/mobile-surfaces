#!/usr/bin/env node
// Three checks against the ActivityKit attribute files:
//   1. The two `MobileSurfacesActivityAttributes.swift` files (Expo module +
//      widget target) must be byte-identical (MS002). ActivityKit binds by
//      matching Codable shape across modules at runtime, so any drift is a
//      silent bug.
//   2. The Swift `ContentState` struct must match the Zod
//      `liveSurfaceActivityContentState` source of truth (MS003 / MS022).
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
            "Edit one file, copy verbatim into the other. Until SPM-shared Swift lands, byte-identity is enforced.",
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

const swiftFields = parseContentState(moduleSource, modulePath);
const swiftStages = parseStageCases(moduleSource, modulePath);

const zodFields = Object.entries(liveSurfaceActivityContentState.shape).map(
  ([name, schema]) => ({ name, expected: expectedSwiftType(name, schema) }),
);
const zodStages = liveSurfaceStage.options;

const fieldIssues = [];
const stageIssues = [];

const swiftNames = new Set(swiftFields.map((f) => f.name));
const zodNames = new Set(zodFields.map((f) => f.name));
for (const f of zodFields) {
  if (!swiftNames.has(f.name)) {
    fieldIssues.push({
      path: f.name,
      message: `present in Zod liveSurfaceActivityContentState, missing from Swift ContentState (${path.relative(process.cwd(), modulePath)})`,
    });
  }
}
for (const f of swiftFields) {
  if (!zodNames.has(f.name)) {
    fieldIssues.push({
      path: `${path.relative(process.cwd(), modulePath)}:${f.line}`,
      message: `field "${f.name}" present in Swift ContentState, missing from Zod liveSurfaceActivityContentState`,
    });
  }
}

const swiftByName = new Map(swiftFields.map((f) => [f.name, f]));
for (const f of zodFields) {
  const swift = swiftByName.get(f.name);
  if (!swift) continue;
  if (f.expected === null) {
    fieldIssues.push({
      path: f.name,
      message: `Zod schema is unsupported by this checker (extend expectedSwiftType to teach it)`,
    });
    continue;
  }
  if (swift.type !== f.expected) {
    fieldIssues.push({
      path: `${path.relative(process.cwd(), modulePath)}:${swift.line}`,
      message: `field "${f.name}": Zod expects ${f.expected}, Swift has ${swift.type}`,
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
      path: `${path.relative(process.cwd(), modulePath)}:${s.line}`,
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

function parseContentState(swiftSrc, sourcePath) {
  const block = swiftSrc.match(
    /public\s+struct\s+ContentState\s*:[^{]*\{([\s\S]*?)\n\s*\}/,
  );
  if (!block) {
    emitDiagnosticReport(
      buildReport(TOOL, [
        {
          id: "parse-content-state",
          status: "fail",
          summary: `No \`public struct ContentState\` block in Swift source.`,
          detail: { paths: [sourcePath] },
        },
      ]),
      { json: values.json },
    );
  }
  const body = block[1];
  const startOffset = block.index + block[0].indexOf(body);
  const fields = [];
  for (const m of body.matchAll(/var\s+(\w+)\s*:\s*([\w<>?]+)/g)) {
    const absoluteOffset = startOffset + m.index;
    const line = swiftSrc.slice(0, absoluteOffset).split("\n").length;
    fields.push({ name: m[1], type: m[2], line });
  }
  return fields;
}

function parseStageCases(swiftSrc, sourcePath) {
  const block = swiftSrc.match(
    /enum\s+Stage\s*:[^{]*\{([\s\S]*?)\n\s*\}/,
  );
  if (!block) {
    emitDiagnosticReport(
      buildReport(TOOL, [
        {
          id: "parse-stage",
          status: "fail",
          summary: `No \`enum Stage\` block in Swift source.`,
          detail: { paths: [sourcePath] },
        },
      ]),
      { json: values.json },
    );
  }
  const body = block[1];
  const startOffset = block.index + block[0].indexOf(body);
  const cases = [];
  for (const m of body.matchAll(/case\s+(\w+)/g)) {
    const absoluteOffset = startOffset + m.index;
    const line = swiftSrc.slice(0, absoluteOffset).split("\n").length;
    cases.push({ name: m[1], line });
  }
  return cases;
}

// Resolve a Zod field schema to the Swift type it should serialize as.
// Returns null if we don't know how to map it; the caller surfaces that as a
// "teach the checker" error so we don't silently pass on unknown shapes.
function expectedSwiftType(name, schema) {
  // Stage reference: same instance as liveSurfaceStage -> Swift `Stage`.
  if (schema === liveSurfaceStage) return "Stage";
  const def = schema?._zod?.def;
  if (!def) return null;
  if (def.type === "string") return "String";
  if (def.type === "number") {
    // z.int() etc. set a numeric format; treat any integer format as Int.
    if (def.format && /int/i.test(String(def.format))) return "Int";
    return "Double";
  }
  if (def.type === "enum") {
    // Heuristic: nominal Swift type name matches the field name capitalized.
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return null;
}
