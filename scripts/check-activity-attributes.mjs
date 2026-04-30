#!/usr/bin/env node
// Two checks:
//   1. The two `MobileSurfacesActivityAttributes.swift` files (Expo module +
//      widget target) must be byte-identical. ActivityKit binds by matching
//      Codable shape across modules at runtime, so any drift is a silent bug.
//   2. The Swift `ContentState` struct + `Stage` enum must match the Zod
//      `liveSurfaceActivityContentState` + `liveSurfaceStage` source of truth.
//      Adds, removes, renames, and type changes on either side break here.
//
// Run via `node --experimental-strip-types` so the TS schema imports directly.
import fs from "node:fs";
import path from "node:path";
import {
  liveSurfaceActivityContentState,
  liveSurfaceStage,
} from "../packages/surface-contracts/src/schema.ts";

const moduleDir = path.resolve("packages/live-activity/ios");
const widgetDir = path.resolve("apps/mobile/targets/widget");

const modulePath = findAttributesFile(moduleDir);
const widgetPath = findAttributesFile(widgetDir);

if (path.basename(modulePath) !== path.basename(widgetPath)) {
  console.error(
    `ActivityKit attribute filenames differ:\n- ${modulePath}\n- ${widgetPath}`,
  );
  process.exit(1);
}

const moduleSource = fs.readFileSync(modulePath, "utf8");
const widgetSource = fs.readFileSync(widgetPath, "utf8");

if (moduleSource !== widgetSource) {
  console.error("ActivityKit attribute definitions have drifted.");
  console.error(`Expected byte-identical files:\n- ${modulePath}\n- ${widgetPath}`);
  process.exit(1);
}

console.log("ActivityKit attribute definitions are byte-identical.");

// ---------- Structural Swift <-> Zod check ----------

const swiftFields = parseContentState(moduleSource, modulePath);
const swiftStages = parseStageCases(moduleSource, modulePath);

const zodFields = Object.entries(liveSurfaceActivityContentState.shape).map(
  ([name, schema]) => ({ name, expected: expectedSwiftType(name, schema) }),
);
const zodStages = liveSurfaceStage.options;

const errors = [];

// Field set comparison.
const swiftNames = new Set(swiftFields.map((f) => f.name));
const zodNames = new Set(zodFields.map((f) => f.name));
for (const f of zodFields) {
  if (!swiftNames.has(f.name)) {
    errors.push(
      `field "${f.name}": present in Zod liveSurfaceActivityContentState, missing from Swift ContentState (${path.relative(process.cwd(), modulePath)})`,
    );
  }
}
for (const f of swiftFields) {
  if (!zodNames.has(f.name)) {
    errors.push(
      `field "${f.name}": present in Swift ContentState (${path.relative(process.cwd(), modulePath)}:${f.line}), missing from Zod liveSurfaceActivityContentState`,
    );
  }
}

// Field type comparison (only for names that exist in both).
const swiftByName = new Map(swiftFields.map((f) => [f.name, f]));
for (const f of zodFields) {
  const swift = swiftByName.get(f.name);
  if (!swift) continue;
  if (f.expected === null) {
    errors.push(
      `field "${f.name}": Zod schema is unsupported by this checker (extend expectedSwiftType to teach it)`,
    );
    continue;
  }
  if (swift.type !== f.expected) {
    errors.push(
      `field "${f.name}": Zod expects ${f.expected}, Swift has ${swift.type} (${path.relative(process.cwd(), modulePath)}:${swift.line})`,
    );
  }
}

// Stage cases comparison.
const swiftStageNames = new Set(swiftStages.map((s) => s.name));
const zodStageNames = new Set(zodStages);
for (const s of zodStages) {
  if (!swiftStageNames.has(s)) {
    errors.push(
      `stage case "${s}": present in Zod liveSurfaceStage, missing from Swift Stage enum`,
    );
  }
}
for (const s of swiftStages) {
  if (!zodStageNames.has(s.name)) {
    errors.push(
      `stage case "${s.name}": present in Swift Stage enum (${path.relative(process.cwd(), modulePath)}:${s.line}), missing from Zod liveSurfaceStage`,
    );
  }
}

if (errors.length > 0) {
  console.error("Swift ContentState has drifted from Zod liveSurfaceActivityContentState:");
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

console.log(
  `Swift ContentState matches Zod liveSurfaceActivityContentState (${zodFields.length} fields, ${zodStages.length} stages).`,
);

// ---------- Helpers ----------

function findAttributesFile(dir) {
  const matches = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith("ActivityAttributes.swift"))
    .map((f) => path.join(dir, f));
  if (matches.length === 0) {
    console.error(`No *ActivityAttributes.swift found in ${dir}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`Multiple *ActivityAttributes.swift in ${dir}:\n  ${matches.join("\n  ")}`);
    process.exit(1);
  }
  return matches[0];
}

function parseContentState(swiftSrc, sourcePath) {
  const block = swiftSrc.match(
    /public\s+struct\s+ContentState\s*:[^{]*\{([\s\S]*?)\n\s*\}/,
  );
  if (!block) {
    console.error(
      `No \`public struct ContentState\` block in Swift source: ${sourcePath}`,
    );
    process.exit(1);
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
    console.error(`No \`enum Stage\` block in Swift source: ${sourcePath}`);
    process.exit(1);
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
