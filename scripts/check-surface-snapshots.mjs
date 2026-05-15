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
import {
  parseContentState,
  resolveExpectedSwiftType as expectedSwiftType,
} from "./lib/swift-content-state.mjs";

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

// The shared Zod → Swift type resolver lives in
// scripts/lib/swift-content-state.mjs (imported above as `expectedSwiftType`).
// It is optionality-aware (handles `optional()` / `nullable()` → `T?`) and
// understands enums/literals/numbers/strings/booleans. The shared-state
// snapshot structs use plain Swift scalars rather than nominal enums so the
// resolver maps Zod enums and literals to `String`. The Live Activity Stage
// enum is the only consumer that needs a nominal Swift type, and
// check-activity-attributes.mjs special-cases that before delegating.
