#!/usr/bin/env node
// Codable-aware parity check for the four non-Live-Activity surface snapshot
// structs (MS036). Live Activity ContentState already has MS002/MS003/MS004
// via check-activity-attributes.mjs; the other four surfaces had no equivalent
// guard and matched their Zod projection-output schemas only by coincidence.
//
// The hand-maintained Codable structs in
//   apps/mobile/targets/widget/_shared/MobileSurfacesSharedState.swift
// are decoded with JSONDecoder from the App Group container. If a struct's
// field set, JSON key (CodingKeys), Swift type, or optionality drifts from the
// Zod projection-output schema the host writes, JSONDecoder silently fails and
// the widget/control/lock-accessory/StandBy surface renders placeholder data
// forever. No log, no error - exactly the silent-failure class MS003 closes
// for the Lock Screen.
//
// This script compares each struct against its schema and fails loudly and
// specifically on ANY divergence: added field, removed field, renamed JSON
// key, type mismatch, optionality mismatch. Like check-activity-attributes.mjs
// it is failure-safe: a Swift or Zod shape the checker does not understand is
// an ERROR ("teach the checker"), never a silent pass.
//
// Run via `node --experimental-strip-types` so the TS schema imports directly.
// Pass --json to emit a DiagnosticReport.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  liveSurfaceWidgetTimelineEntry,
  liveSurfaceControlValueProvider,
  liveSurfaceLockAccessoryEntry,
  liveSurfaceStandbyEntry,
} from "../packages/surface-contracts/src/schema.ts";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import { parseContentState } from "./lib/swift-content-state.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-surface-snapshots";
const sharedStatePath = path.resolve(
  "apps/mobile/targets/widget/_shared/MobileSurfacesSharedState.swift",
);

// Each entry pairs a Swift Codable struct with the Zod projection-output
// schema it must mirror, and names the projection helper that produces it.
// The helper name appears in failure messages so a contributor knows which
// projection edit broke parity.
const SURFACES = [
  {
    id: "widget-snapshot-parity",
    struct: "MobileSurfacesWidgetSnapshot",
    schema: liveSurfaceWidgetTimelineEntry,
    schemaName: "liveSurfaceWidgetTimelineEntry",
    helper: "toWidgetTimelineEntry",
  },
  {
    id: "control-snapshot-parity",
    struct: "MobileSurfacesControlSnapshot",
    schema: liveSurfaceControlValueProvider,
    schemaName: "liveSurfaceControlValueProvider",
    helper: "toControlValueProvider",
  },
  {
    id: "lock-accessory-snapshot-parity",
    struct: "MobileSurfacesLockAccessorySnapshot",
    schema: liveSurfaceLockAccessoryEntry,
    schemaName: "liveSurfaceLockAccessoryEntry",
    helper: "toLockAccessoryEntry",
  },
  {
    id: "standby-snapshot-parity",
    struct: "MobileSurfacesStandbySnapshot",
    schema: liveSurfaceStandbyEntry,
    schemaName: "liveSurfaceStandbyEntry",
    helper: "toStandbyEntry",
  },
];

const checks = [];

if (!fs.existsSync(sharedStatePath)) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "find-shared-state",
        status: "fail",
        trapId: "MS036",
        summary: `MobileSurfacesSharedState.swift not found at ${path.relative(process.cwd(), sharedStatePath)}`,
      },
    ]),
    { json: values.json },
  );
}

const sharedStateRel = path.relative(process.cwd(), sharedStatePath);
const swiftSource = fs.readFileSync(sharedStatePath, "utf8");

for (const surface of SURFACES) {
  checks.push(checkSurface(surface, swiftSource, sharedStateRel));
}

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });

// ---------- Per-surface check ----------

function checkSurface(surface, swiftSource, swiftRel) {
  const parsed = parseContentState(swiftSource, { structName: surface.struct });
  if (!parsed.ok) {
    return {
      id: surface.id,
      status: "fail",
      trapId: "MS036",
      summary: `Could not parse Swift struct ${surface.struct}: ${parsed.reason}`,
      detail: { paths: [swiftRel] },
    };
  }

  const swiftFields = parsed.fields;

  // Resolve every Zod field to the Swift type it must serialize as. A null
  // expected type means the checker does not understand the Zod shape - that
  // is surfaced as an issue ("teach the checker"), never silently skipped.
  const zodFields = Object.entries(surface.schema.shape).map(
    ([name, schema]) => ({ name, ...expectedSwiftType(schema) }),
  );

  const issues = [];

  // MS036 hinges on the JSON key, not the Swift property name: JSONDecoder
  // keys off the CodingKeys-resolved name. A `case headline = "title"`
  // decouples the two. The shared-state structs currently auto-synthesize
  // CodingKeys (jsonKey == property name), but the parser handles an explicit
  // enum too, so we match Zod keys against Swift jsonKey first.
  const swiftByJsonKey = new Map();
  for (const f of swiftFields) {
    if (f.jsonKey === null) continue;
    swiftByJsonKey.set(f.jsonKey, f);
  }
  const zodKeySet = new Set(zodFields.map((f) => f.name));

  for (const z of zodFields) {
    const swift = swiftByJsonKey.get(z.name);
    if (!swift) {
      issues.push({
        path: z.name,
        message: `Zod ${surface.schemaName} has key "${z.name}", but no field in Swift struct ${surface.struct} serializes to that JSON key. Add it to the struct or update the ${surface.helper} projection.`,
      });
      continue;
    }
    if (z.expected === null) {
      issues.push({
        path: z.name,
        message: `Zod field "${z.name}" uses a shape this checker does not understand (${z.reason}). Extend expectedSwiftType to teach the checker.`,
      });
      continue;
    }
    if (swift.type !== z.expected) {
      issues.push({
        path: `${swiftRel}:${swift.line}`,
        message: `field "${swift.name}" (JSON key "${swift.jsonKey}"): Zod ${surface.schemaName} expects Swift type ${z.expected}, struct ${surface.struct} has ${swift.type}.`,
      });
    }
    if (swift.name !== z.name) {
      issues.push({
        path: `${swiftRel}:${swift.line}`,
        message: `CodingKeys remap: Swift property "${swift.name}" serializes as JSON key "${swift.jsonKey}". Zod ${surface.schemaName} expects "${z.name}" - drop the rename or update the schema.`,
      });
    }
  }

  for (const f of swiftFields) {
    if (f.jsonKey === null) {
      issues.push({
        path: `${swiftRel}:${f.line}`,
        message: `Swift property "${f.name}" in ${surface.struct} is excluded from CodingKeys, so it never decodes from the App Group payload. Add it to CodingKeys or remove the property.`,
      });
      continue;
    }
    if (!zodKeySet.has(f.jsonKey)) {
      issues.push({
        path: `${swiftRel}:${f.line}`,
        message: `Swift property "${f.name}" in ${surface.struct} serializes as JSON key "${f.jsonKey}", which is not present in Zod ${surface.schemaName}. Remove it from the struct or add it to the schema.`,
      });
    }
  }

  return {
    id: surface.id,
    status: issues.length === 0 ? "ok" : "fail",
    trapId: "MS036",
    summary:
      issues.length === 0
        ? `Swift ${surface.struct} matches Zod ${surface.schemaName} (${zodFields.length} fields).`
        : `${issues.length} ${surface.struct} parity issue${issues.length === 1 ? "" : "s"}.`,
    ...(issues.length > 0 ? { detail: { issues } } : {}),
  };
}

// ---------- Helpers ----------

// Resolve a Zod field schema to the Swift type its JSONDecoder counterpart
// must declare. Returns `{ expected, reason }` where `expected` is the Swift
// type string (e.g. "String", "Double", "Bool", "String?") or null when the
// checker does not recognize the shape. `reason` explains a null so the
// caller can emit a "teach the checker" issue rather than passing silently.
//
// The shared-state snapshot structs intentionally use plain Swift scalar
// types - `String` for Zod enums and literals, `Double` for numbers, `Bool`
// for booleans - rather than nominal Swift enums. That keeps JSONDecoder
// tolerant of a host that emits a state value the widget binary predates.
// So enum and string-literal both map to "String" here; that is deliberate
// and differs from the Live Activity Stage handling in
// check-activity-attributes.mjs (which does use a nominal `Stage` enum).
function expectedSwiftType(schema) {
  const def = schema?._zod?.def;
  if (!def) return { expected: null, reason: "no resolvable Zod def" };

  // optional() / nullable() both map to a Swift Optional. The projection
  // helpers use .optional() for genuinely-absent slice fields (widget
  // family/reloadPolicy) and .nullable() for "present but null" projected
  // fields (control value/intent, standby tint). Swift Codable decodes both
  // an absent key and an explicit JSON null into `T?`, so for the wire shape
  // they are equivalent: the inner type must match and the Swift type must
  // be the Optional form.
  if (def.type === "optional" || def.type === "nullable") {
    const inner = expectedSwiftType(def.innerType);
    if (inner.expected === null) {
      return {
        expected: null,
        reason: `${def.type} wrapping an unsupported inner shape (${inner.reason})`,
      };
    }
    if (inner.expected.endsWith("?")) {
      // optional(optional(...)) or nullable(optional(...)): collapses to a
      // single Swift Optional, but this is not a shape the contract uses and
      // we would rather flag it than guess.
      return {
        expected: null,
        reason: `nested ${def.type} is not a shape this checker handles`,
      };
    }
    return { expected: `${inner.expected}?`, reason: null };
  }

  if (def.type === "string") return { expected: "String", reason: null };
  if (def.type === "boolean") return { expected: "Bool", reason: null };
  if (def.type === "number") {
    // z.int() etc. set a numeric format; treat any integer format as Int.
    if (def.format && /int/i.test(String(def.format))) {
      return { expected: "Int", reason: null };
    }
    return { expected: "Double", reason: null };
  }
  if (def.type === "enum") {
    // Snapshot structs render Zod enums as plain Swift String (see note
    // above). Guard that every enum member is a string so a future numeric
    // enum would be flagged rather than silently mapped to String.
    const members = def.entries ? Object.values(def.entries) : [];
    if (members.length > 0 && members.every((v) => typeof v === "string")) {
      return { expected: "String", reason: null };
    }
    return {
      expected: null,
      reason: "enum with non-string members is not handled",
    };
  }
  if (def.type === "literal") {
    // Snapshot structs render literal discriminators (kind: "widget") as
    // plain Swift String. Guard that every literal value is a string.
    const vals = def.values ?? [];
    if (vals.length > 0 && vals.every((v) => typeof v === "string")) {
      return { expected: "String", reason: null };
    }
    return {
      expected: null,
      reason: "literal with non-string value is not handled",
    };
  }

  return { expected: null, reason: `unrecognized Zod type "${def.type}"` };
}
