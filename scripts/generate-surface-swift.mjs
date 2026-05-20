#!/usr/bin/env node
// Codegen for the Swift types that mirror the Zod contract.
//
// Source of truth: the Zod schemas in packages/surface-contracts/src/schema.ts.
//
// Emits three generated files:
//
//   1. MobileSurfacesActivityAttributes.swift  (byte-identical to TWO paths)
//      The ActivityKit ContentState + Stage enum. ActivityKit silently fails
//      when the ContentState shape drifts between the Expo module's binary
//      and the widget extension's binary (MS002/MS003/MS004); the two copies
//      have to be byte-identical and match liveSurfaceActivityContentState.
//
//   2. MobileSurfacesSurfaceSnapshots.swift   (single copy, _shared target)
//      The four Codable structs that decode the App Group snapshot payloads
//      for the widget, control, lock-accessory, and StandBy surfaces. A drift
//      from the Zod projection-output schema makes JSONDecoder silently fail
//      and the surface render placeholder data forever (MS036).
//
//   3. MobileSurfacesNotificationContentEntry.swift  (notification-content)
//      The Codable sidecar the notification-content extension decodes from the
//      wire payload's `liveSurface` key. Same MS036 parity concern, different
//      Xcode target — so it gets its own file in that target's directory.
//
// Why codegen rather than a hand-written struct plus a parity checker: the
// structs become correct by construction. The only failure mode left is
// "forgot to rerun codegen", which --check catches as a byte diff. MS036 is
// enforced by this generator's --check; there is no separate semantic gate.
//
// The outer Attributes fields (`surfaceId`, `modeLabel`) are Swift-side
// metadata passed to `Activity.request(attributes:)`. They are not part of
// the wire payload pushed via APNs (only ContentState is), so they are not in
// the Zod schema; they live in the fixed template surface below.
//
// Run modes:
//   default     write every generated file
//   --check     exit 1 if any committed file differs from the generator
//               output; --json emits a DiagnosticReport
//   --print     dump every generated file to stdout without writing
//
// Run via `node --experimental-strip-types` so the TS schema imports directly.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  liveSurfaceActivityContentState,
  liveSurfaceStage,
  liveSurfaceWidgetTimelineEntry,
  liveSurfaceControlValueProvider,
  liveSurfaceLockAccessoryEntry,
  liveSurfaceStandbyEntry,
  liveSurfaceNotificationContentEntry,
} from "../packages/surface-contracts/src/schema.ts";
import { resolveExpectedSwiftType } from "./lib/swift-content-state.mjs";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const TOOL = "generate-surface-swift";

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    print: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

// Each target is one generated file rendered once and written to >=1 path.
// `trapId` (when set) tags the target's --check diagnostic; the ActivityKit
// attributes carry no trapId here because MS002/MS003/MS004 are enforced by
// the separate semantic gate check-activity-attributes.mjs — this generator's
// --check only guards drift-from-codegen for that file.
const TARGETS = [
  {
    id: "activity-attributes",
    label: "ActivityKit attributes",
    paths: [
      "packages/live-activity/ios/MobileSurfacesActivityAttributes.swift",
      "apps/mobile/targets/widget/MobileSurfacesActivityAttributes.swift",
    ],
    render: renderActivityAttributes,
  },
  {
    id: "surface-snapshots",
    label: "surface snapshot structs",
    paths: ["apps/mobile/targets/_shared/MobileSurfacesSurfaceSnapshots.swift"],
    render: renderSurfaceSnapshots,
    trapId: "MS036",
  },
  {
    id: "notification-content-entry",
    label: "notification content entry struct",
    paths: [
      "apps/mobile/targets/notification-content/MobileSurfacesNotificationContentEntry.swift",
    ],
    render: renderNotificationContentEntry,
    trapId: "MS036",
  },
];

const rendered = TARGETS.map((t) => ({ target: t, contents: t.render() }));

if (values.print) {
  for (const { target, contents } of rendered) {
    process.stdout.write(`// ===== ${target.id} =====\n${contents}\n`);
  }
  process.exit(0);
}

if (values.check) {
  const checks = rendered.map(({ target, contents }) => {
    const drifted = target.paths.filter((p) => {
      const abs = resolve(p);
      const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
      return current !== contents;
    });
    return {
      id: `${target.id}-sync`,
      status: drifted.length === 0 ? "ok" : "fail",
      ...(target.trapId ? { trapId: target.trapId } : {}),
      summary:
        drifted.length === 0
          ? `${target.label} in sync with the Zod source of truth.`
          : `${drifted.length} ${target.label} file(s) out of sync with the Zod source of truth.`,
      ...(drifted.length > 0
        ? {
            detail: {
              message:
                "The Zod schemas in packages/surface-contracts/src/schema.ts are the source of truth. Run pnpm surface:codegen to regenerate.",
              issues: drifted.map((p) => ({
                path: p,
                message: "drifted from generator output",
              })),
            },
          }
        : {}),
    };
  });
  emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
} else {
  const written = [];
  for (const { target, contents } of rendered) {
    for (const p of target.paths) {
      const abs = resolve(p);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, contents);
      written.push(p);
    }
  }
  if (values.json) {
    emitDiagnosticReport(
      buildReport(TOOL, [
        {
          id: "write",
          status: "ok",
          summary: `Wrote ${written.length} generated Swift file(s).`,
        },
      ]),
      { json: true },
    );
  } else {
    for (const p of written) console.log(`Wrote ${p}.`);
  }
}

// ---------- Renderers ----------

function renderActivityAttributes() {
  const contentFields = renderFieldLines(liveSurfaceActivityContentState, {
    keyword: "var",
    indent: "    ",
    stageNominal: true,
  });
  const stageCases = renderStageCases();

  return [
    "// AUTO-GENERATED by scripts/generate-surface-swift.mjs. DO NOT EDIT.",
    "//",
    "// Source of truth: packages/surface-contracts/src/schema.ts",
    "//   - liveSurfaceActivityContentState defines the ContentState fields below.",
    "//   - liveSurfaceStage defines the Stage enum cases below.",
    "//",
    "// MUST stay byte-identical across the Expo module and widget target:",
    "//   packages/live-activity/ios/MobileSurfacesActivityAttributes.swift",
    "//   apps/mobile/targets/widget/MobileSurfacesActivityAttributes.swift",
    "//",
    "// ActivityKit binds the type used in `Activity<T>.request` (main app) to the",
    "// type used in `ActivityConfiguration(for: T.self)` (widget extension) by",
    "// matching ContentState/Attributes shape. The two definitions live in",
    "// different Swift modules at compile time but must serialize identically.",
    "//",
    "// To change ContentState fields or Stage cases, edit the Zod schema and run:",
    "//   pnpm surface:codegen --only=generate-surface-swift",
    "",
    "import ActivityKit",
    "",
    "struct MobileSurfacesActivityAttributes: ActivityAttributes, Sendable {",
    "  public struct ContentState: Codable, Hashable, Sendable {",
    contentFields,
    "  }",
    "",
    "  enum Stage: String, Codable, Hashable, Sendable {",
    stageCases,
    "  }",
    "",
    "  var surfaceId: String",
    "  var modeLabel: String",
    "}",
    "",
  ].join("\n");
}

function renderSurfaceSnapshots() {
  const structs = [
    { name: "MobileSurfacesWidgetSnapshot", schema: liveSurfaceWidgetTimelineEntry },
    { name: "MobileSurfacesControlSnapshot", schema: liveSurfaceControlValueProvider },
    {
      name: "MobileSurfacesLockAccessorySnapshot",
      schema: liveSurfaceLockAccessoryEntry,
    },
    { name: "MobileSurfacesStandbySnapshot", schema: liveSurfaceStandbyEntry },
  ];
  return [
    "// AUTO-GENERATED by scripts/generate-surface-swift.mjs. DO NOT EDIT.",
    "//",
    "// Source of truth: packages/surface-contracts/src/schema.ts",
    "//   liveSurfaceWidgetTimelineEntry, liveSurfaceControlValueProvider,",
    "//   liveSurfaceLockAccessoryEntry, liveSurfaceStandbyEntry.",
    "//",
    "// These Codable structs decode the App Group snapshot payloads the host",
    "// writes for the widget, control, lock-accessory, and StandBy surfaces. A",
    "// field, type, JSON key, or optionality drift from the Zod projection-output",
    "// schema makes JSONDecoder silently fail and the surface render placeholder",
    "// data forever (MS036). Generating from Zod keeps the structs in lockstep.",
    "//",
    "// To change a field, edit the Zod schema and run:",
    "//   pnpm surface:codegen --only=generate-surface-swift",
    "",
    "import Foundation",
    "",
    structs
      .map((s) =>
        renderFlatStruct({ name: s.name, schema: s.schema, keyword: "var" }),
      )
      .join("\n\n"),
    "",
  ].join("\n");
}

function renderNotificationContentEntry() {
  return [
    "// AUTO-GENERATED by scripts/generate-surface-swift.mjs. DO NOT EDIT.",
    "//",
    "// Source of truth: packages/surface-contracts/src/schema.ts",
    "//   liveSurfaceNotificationContentEntry.",
    "//",
    "// The notification-content extension decodes this Codable sidecar from the",
    "// wire payload's `liveSurface` key. A field, type, JSON key, or optionality",
    "// drift from the Zod projection-output schema makes JSONDecoder silently",
    "// fail and the extension render the default system chrome instead of the",
    "// surface-aware view (MS036).",
    "//",
    "// To change a field, edit the Zod schema and run:",
    "//   pnpm surface:codegen --only=generate-surface-swift",
    "",
    "import Foundation",
    "",
    renderFlatStruct({
      name: "MobileSurfacesNotificationContentEntry",
      schema: liveSurfaceNotificationContentEntry,
      keyword: "let",
    }),
    "",
  ].join("\n");
}

// ---------- Shared field rendering ----------

function renderFlatStruct({ name, schema, keyword }) {
  return [
    `struct ${name}: Codable, Hashable {`,
    renderFieldLines(schema, { keyword, indent: "  ", stageNominal: false }),
    "}",
  ].join("\n");
}

function renderFieldLines(schema, { keyword, indent, stageNominal }) {
  const entries = Object.entries(schema.shape);
  if (entries.length === 0) {
    throw new Error(
      "Schema has no fields. The codegen refuses to emit an empty struct because Codable synthesis would have nothing to decode.",
    );
  }
  return entries
    .map(
      ([name, fieldSchema]) =>
        `${indent}${keyword} ${name}: ${swiftTypeFor(name, fieldSchema, stageNominal)}`,
    )
    .join("\n");
}

function renderStageCases() {
  const options = liveSurfaceStage.options;
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error(
      "liveSurfaceStage has no enum options. Cannot emit a Stage enum with zero cases.",
    );
  }
  return options.map((opt) => `    case ${opt}`).join("\n");
}

// Map a Zod field schema to its Swift type. `stage` is special-cased to the
// nominal `Stage` enum only inside the ActivityKit attributes (stageNominal);
// the flat snapshot structs map every enum to a plain String, matching the
// App Group decoders.
function swiftTypeFor(fieldName, schema, stageNominal) {
  if (stageNominal && fieldName === "stage") {
    if (!isStageEnum(schema)) {
      throw new Error(
        `Field "stage" no longer matches liveSurfaceStage. The codegen special-cases this field to the nominal Stage enum; widening it to a different shape is a contract change that needs an explicit decision.`,
      );
    }
    return "Stage";
  }
  const { expected, reason } = resolveExpectedSwiftType(schema);
  if (expected === null) {
    throw new Error(
      `Codegen does not know how to map field "${fieldName}" to a Swift type: ${reason}. Teach scripts/lib/swift-content-state.mjs#resolveExpectedSwiftType.`,
    );
  }
  return expected;
}

function isStageEnum(schema) {
  const def = schema?._zod?.def;
  if (!def || def.type !== "enum") return false;
  const want = new Set(liveSurfaceStage.options);
  const got = new Set(def.entries ? Object.values(def.entries) : []);
  if (want.size !== got.size) return false;
  for (const v of want) if (!got.has(v)) return false;
  return true;
}
