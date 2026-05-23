#!/usr/bin/env node
// MS041: every projection-output Zod schema in
// packages/surface-contracts/src/schema.ts must declare `schemaVersion`
// with the value `z.literal(SCHEMA_VERSION)`. SCHEMA_VERSION is the single
// wire-format constant in packages/surface-contracts/src/version.ts; every
// schema referencing it cannot disagree on the literal by construction, so
// this check verifies the reference is present rather than comparing digit
// strings across schemas.
//
// The on-device Codable mirror decodes `{ schemaVersion: String }` by key
// name, so property ordering in the Zod source has no wire effect. An
// earlier version of this check enforced that schemaVersion appear as the
// first object property; that ordering rule protected nothing and was
// removed. The literal-type check below is the load-bearing part.
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
import { SCHEMA_VERSION } from "../packages/surface-contracts/src/version.ts";

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

// The canonical wire-format generation is the SCHEMA_VERSION constant in
// packages/surface-contracts/src/version.ts. Projection-output schemas must
// reference that constant, not a hand-typed digit, so there is no per-schema
// literal to extract or compare.
const canonical = SCHEMA_VERSION;

// Iterate every top-level `export const liveSurface<...> = z.object({ ... }).strict()`
// declaration. For each whose name matches a projection-output suffix
// (and is not allowlisted), assert it declares a `schemaVersion` property
// whose value is `z.literal(SCHEMA_VERSION)` (with optional .describe(...)
// chained off). Property ordering is not checked: the on-device Codable
// mirror decodes by key name.
//
// Body extraction is brace-balanced rather than regex-truncated. A prior
// non-greedy `z.object\({([\s\S]*?)}\).strict\(\)` form terminated at the
// first nested `})\s*.strict()` it encountered, which collapsed the captured
// body for any schema whose sibling fields used `.strict()` themselves (the
// notification ContentPayload is the live example). A legitimately-declared
// schemaVersion that happened to sit after such a sibling was reported
// missing. The balanced walk below finds the real outer body so property
// order is wire-irrelevant and gate-irrelevant.

// Find the index of the `}` that matches an opening `{` at openIdx. Counts
// combined brace/paren/bracket depth so e.g. `arr[0]` inside a body does not
// fool the matcher; tracks string and template-literal state so a `}` inside
// a description string is not counted. Returns -1 if no match is found.
function findMatchingBrace(src, openIdx) {
  let depth = 1;
  let inString = null; // null | '"' | "'" | "`"
  for (let i = openIdx + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (inString) {
      if (ch === "\\") {
        i += 1; // skip the escaped char outright
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
      if (depth === 0 && ch === "}") return i;
    }
  }
  return -1;
}

const issues = [];

// Anchor each declaration with a start regex that matches up to and
// including the `{` opening the z.object body. `z\s*\.object\(\s*\{` covers
// both `z.object({` and the multi-line `z\n  .object({` shapes the source
// uses for wide schemas.
const START_RE =
  /^export\s+const\s+(liveSurface[A-Za-z0-9_]+)\s*=\s*z\s*\.\s*object\(\s*\{/gm;

let inspected = 0;
let startMatch;
while ((startMatch = START_RE.exec(source)) !== null) {
  const name = startMatch[1];
  if (!PROJECTION_SUFFIXES.some((re) => re.test(name))) continue;
  if (ALLOWLIST.has(name)) continue;

  // Position of the `{` we just matched (last char of the start regex).
  const openIdx = startMatch.index + startMatch[0].length - 1;
  const closeIdx = findMatchingBrace(source, openIdx);
  if (closeIdx === -1) {
    issues.push({
      path: `packages/surface-contracts/src/schema.ts:${name}`,
      message: `unbalanced braces in z.object({...}) body; cannot extract schemaVersion.`,
    });
    continue;
  }
  // Verify the declaration closes with `)\s*.strict()` so we are looking at
  // a real projection-output schema and not, say, a z.object(...) used as a
  // sub-component without the outer .strict().
  const tail = source.slice(closeIdx + 1);
  if (!/^\s*\)\s*\.\s*strict\(\)/.test(tail)) continue;

  inspected += 1;

  const body = source.slice(openIdx + 1, closeIdx);
  const lines = body.split("\n");

  // Find the schemaVersion field at depth 0 of the body. The body's depth
  // starts at 0 (we are inside the outer { ... } already); a nested object
  // increments. Property ordering is not significant on the wire (Codable
  // decodes by key name), so the field can appear at any position.
  let schemaVersionLineIdx = -1;
  {
    let depth = 0;
    let inString = null;
    let lineStart = 0;
    for (let i = 0; i < body.length; i += 1) {
      const ch = body[i];
      if (ch === "\n") {
        lineStart = i + 1;
        continue;
      }
      if (inString) {
        if (ch === "\\") {
          i += 1;
          continue;
        }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        continue;
      }
      if (ch === "{" || ch === "(" || ch === "[") {
        depth += 1;
        continue;
      }
      if (ch === "}" || ch === ")" || ch === "]") {
        depth -= 1;
        continue;
      }
      if (depth === 0) {
        // Look for `schemaVersion:` starting at this position. We only check
        // when we are at the beginning of a non-whitespace run at depth 0.
        if (
          (i === lineStart || /^\s+$/.test(body.slice(lineStart, i))) &&
          body.slice(i).startsWith("schemaVersion") &&
          /^schemaVersion\s*:/.test(body.slice(i))
        ) {
          // Convert byte offset back to a line index.
          schemaVersionLineIdx = body.slice(0, i).split("\n").length - 1;
          break;
        }
      }
    }
  }

  if (schemaVersionLineIdx === -1) {
    issues.push({
      path: `packages/surface-contracts/src/schema.ts:${name}`,
      message: `schemaVersion field not found. Every projection-output schema must declare \`schemaVersion: z.literal("${canonical}")\`.`,
    });
    continue;
  }

  // Confirm the value is `z.literal(SCHEMA_VERSION)` (optionally followed by
  // chained method calls like .describe(...)). Pull the schemaVersion value
  // block: from after `schemaVersion:` up to the next top-level comma or
  // closing brace. String-aware bracket counter so `.describe("text with (parens)")`
  // doesn't fool the depth tracker.
  const startFrom = schemaVersionLineIdx;
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
  // Allow whitespace between `z` and `.literal(...)` because the source
  // formats wide chained calls across multiple lines. The argument must be
  // the SCHEMA_VERSION constant, not a hand-typed digit literal.
  const literalRe = /z\s*\.\s*literal\(\s*SCHEMA_VERSION\s*\)/;
  if (!literalRe.test(block)) {
    issues.push({
      path: `packages/surface-contracts/src/schema.ts:${name}.schemaVersion`,
      message: `value is not z.literal(SCHEMA_VERSION). Every projection-output schema must declare schemaVersion as z.literal(SCHEMA_VERSION) (imported from ./version.ts) so it cannot drift from the canonical wire-format generation ("${canonical}").`,
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
          ? `All ${inspected} projection-output schema(s) declare schemaVersion as z.literal(SCHEMA_VERSION).`
          : `${issues.length} projection-output schema(s) violate the MS041 envelope-version invariant.`,
      ...(issues.length > 0
        ? {
            detail: {
              message: `The canonical wire-format generation is SCHEMA_VERSION ("${canonical}") in packages/surface-contracts/src/version.ts. Every projection-output schema must declare \`schemaVersion: z.literal(SCHEMA_VERSION)\`.`,
              issues,
            },
          }
        : {}),
    },
  ]),
  { json: values.json },
);
