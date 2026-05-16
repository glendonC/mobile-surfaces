#!/usr/bin/env node
// MS041: every projection-output Zod schema in
// packages/surface-contracts/src/schema.ts must declare `schemaVersion` as
// its FIRST property, value `z.literal("<canonical>")`. The canonical
// literal is read from `liveSurfaceSnapshotBaseShape` (the snapshot schema's
// own schemaVersion literal).
//
// Why first-property: the on-device Codable mirror reads
// `{ schemaVersion: String }` first so it can detect a host that has shipped
// schemaVersion N+1 against a widget binary on schemaVersion N before
// attempting full Codable decode. Re-ordering schemaVersion later in the
// struct breaks that probe.
//
// Projection-output schemas are identified by name suffix:
//   liveSurface<Kind>Entry
//   liveSurface<Kind>ValueProvider
//   liveSurface<Kind>ContentPayload
// New projection-output schemas inherit the constraint by virtue of the
// naming convention. The exception is `liveSurfaceActivityContentState`
// (consumed directly by ActivityKit's Codable decoder, which carries its
// schemaVersion through the surrounding APNs envelope, not the ContentState
// itself); we explicitly allowlist that schema.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-projection-envelope-version";
const SCHEMA_PATH = path.resolve("packages/surface-contracts/src/schema.ts");

// Schemas the convention excludes from MS041. Each entry must carry a
// justification so the allowlist doesn't grow silently.
const ALLOWLIST = new Map([
  [
    "liveSurfaceActivityContentState",
    "ActivityKit Codable struct; schemaVersion travels in the APNs envelope (apns-push-type=liveactivity payload), not inside ContentState. The widget extension does not branch on schemaVersion here because ActivityKit owns the decode.",
  ],
]);

// Suffix patterns that identify a projection-output schema.
const PROJECTION_SUFFIXES = [/Entry$/, /ValueProvider$/, /ContentPayload$/];

const source = fs.readFileSync(SCHEMA_PATH, "utf8");

// Extract the canonical schemaVersion literal from
// `liveSurfaceSnapshotBaseShape`. The literal is the single source of truth
// every projection-output schema must mirror.
function extractCanonicalSchemaVersion() {
  const baseStart = source.indexOf("liveSurfaceSnapshotBaseShape");
  if (baseStart < 0) return null;
  // Find the next schemaVersion: z.literal("<n>") within the base shape.
  // Use a localized search to avoid grabbing literals from later schemas.
  const window = source.slice(baseStart, baseStart + 4000);
  const m = /schemaVersion\s*:\s*z\s*\.\s*literal\(\s*["'](\d+)["']\s*\)/.exec(
    window,
  );
  return m ? m[1] : null;
}

const canonical = extractCanonicalSchemaVersion();
if (!canonical) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "canonical-schema-version",
        status: "fail",
        trapId: "MS041",
        summary:
          "Could not locate the canonical schemaVersion literal in liveSurfaceSnapshotBaseShape.",
        detail: {
          message:
            "scripts/check-projection-envelope-version.mjs expects a `schemaVersion: z.literal(\"<n>\")` field inside `liveSurfaceSnapshotBaseShape` in packages/surface-contracts/src/schema.ts. Update the script if the canonical literal has moved.",
        },
      },
    ]),
    { json: values.json },
  );
}

// Iterate every top-level `export const liveSurface<...> = z.object({ ... }).strict()`
// declaration. For each whose name matches a projection-output suffix
// (and is not allowlisted), assert:
//   1. The first property in the z.object literal is `schemaVersion`.
//   2. That property's value is `z.literal("<canonical>")` (with optional
//      .describe(...) chained off).
//
// We avoid a full TS AST dependency: the schema file is hand-maintained and
// the projection schemas follow a deterministic shape, so a careful regex
// is sufficient. The script is exercised by surface:check on every PR; if
// the shape ever drifts beyond the regex, the error is caught here, not
// silently passed.

const issues = [];

// Capture: name + the body inside z.object({ ... }) at the top of the
// declaration. `[\s\S]*?` is non-greedy across newlines; `.strict()` (or
// .describe before .strict) bounds the match.
const EXPORT_RE =
  /^export\s+const\s+(liveSurface[A-Za-z0-9_]+)\s*=\s*z\s*\.object\(\{([\s\S]*?)\}\)\s*\.strict\(\)/gm;

let inspected = 0;
let m;
while ((m = EXPORT_RE.exec(source)) !== null) {
  const name = m[1];
  if (!PROJECTION_SUFFIXES.some((re) => re.test(name))) continue;
  if (ALLOWLIST.has(name)) continue;
  inspected += 1;

  const body = m[2];
  // First non-comment, non-whitespace line of the object body.
  const lines = body.split("\n");
  let firstFieldName = null;
  let firstFieldLineIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("//")) continue;
    if (trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    // Match `<name>:` at the start of the trimmed line.
    const fm = /^([A-Za-z_][\w]*)\s*:/.exec(trimmed);
    if (fm) {
      firstFieldName = fm[1];
      firstFieldLineIdx = i;
      break;
    }
    // Anything else (e.g. spread) — stop here, we won't recognize it.
    break;
  }

  if (firstFieldName !== "schemaVersion") {
    issues.push({
      path: `packages/surface-contracts/src/schema.ts:${name}`,
      message: `first property is ${firstFieldName ?? "(not recognized)"}, expected "schemaVersion". The on-device Codable mirror reads schemaVersion first; reordering breaks the pre-decode version probe.`,
    });
    continue;
  }

  // Confirm the value is `z.literal("<canonical>")` (optionally followed by
  // chained method calls like .describe(...)). Pull the schemaVersion value
  // block — from after `schemaVersion:` up to the next top-level comma or
  // closing brace. String-aware bracket counter so `.describe("text with (parens)")`
  // doesn't fool the depth tracker.
  const startFrom = firstFieldLineIdx;
  const firstLine = lines[startFrom];
  const colonIdx = firstLine.indexOf(":");
  // Reconstruct the remaining text from the colon onward and walk it as one
  // string. This avoids re-splitting per-line and lets the string-state
  // machine span newlines naturally.
  const remaining = [
    firstLine.slice(colonIdx + 1),
    ...lines.slice(startFrom + 1),
  ].join("\n");

  let depth = 0;
  let inString = null; // null | '"' | "'" | "`"
  let blockEnd = remaining.length;
  for (let i = 0; i < remaining.length; i += 1) {
    const ch = remaining[i];
    if (inString) {
      if (ch === "\\") {
        i += 1; // skip escaped char
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      blockEnd = i;
      break;
    }
  }
  const block = remaining.slice(0, blockEnd);
  // Allow whitespace between `z` and `.literal(...)` because the source
  // formats wide chained calls across multiple lines:
  //   schemaVersion: z
  //     .literal("5")
  //     .describe(...)
  const literalRe = /z\s*\.\s*literal\(\s*["'](\d+)["']\s*\)/;
  const lm = literalRe.exec(block);
  if (!lm) {
    issues.push({
      path: `packages/surface-contracts/src/schema.ts:${name}.schemaVersion`,
      message: `value is not z.literal("<n>"). Use z.literal("${canonical}") to match the canonical wire-format generation.`,
    });
    continue;
  }
  if (lm[1] !== canonical) {
    issues.push({
      path: `packages/surface-contracts/src/schema.ts:${name}.schemaVersion`,
      message: `z.literal("${lm[1]}") disagrees with the canonical "${canonical}". All projection-output schemas must mirror liveSurfaceSnapshotBaseShape's schemaVersion literal.`,
    });
  }
}

emitDiagnosticReport(
  buildReport(TOOL, [
    {
      id: "projection-envelope-version",
      status: issues.length === 0 ? "ok" : "fail",
      trapId: "MS041",
      summary:
        issues.length === 0
          ? `All ${inspected} projection-output schema(s) declare schemaVersion as the first property at literal "${canonical}".`
          : `${issues.length} projection-output schema(s) violate the MS041 envelope-version invariant.`,
      ...(issues.length > 0
        ? {
            detail: {
              message: `Canonical schemaVersion literal is "${canonical}" (from liveSurfaceSnapshotBaseShape). Every projection-output schema must declare \`schemaVersion: z.literal("${canonical}")\` as its FIRST property.`,
              issues,
            },
          }
        : {}),
    },
  ]),
  { json: values.json },
);
