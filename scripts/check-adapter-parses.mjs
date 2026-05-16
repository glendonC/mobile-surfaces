#!/usr/bin/env node
// Enforces MS038: the Live Activity adapter at
// packages/live-activity/src/index.ts wraps NativeLiveActivity and
// parses every input through liveSurfaceActivityContentState before
// crossing the bridge. The signal we grep for is the import + the
// safeParse call + the InvalidContentStateError class declaration.
// A future refactor that bypasses parse-on-entry would have to drop
// one of these three markers; this script trips on that.
//
// The check is grep-shaped on purpose: a TS-AST check would couple
// to the compiler version, and the markers are stable identifiers
// the architecture deliberately exposes.

import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { parseArgs } from "node:util";
import {
  buildReport,
  emitDiagnosticReport,
} from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-adapter-parses";
const ADAPTER_PATH = resolve("packages/live-activity/src/index.ts");
const SCHEMA_IMPORT = "@mobile-surfaces/surface-contracts";

if (!existsSync(ADAPTER_PATH)) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "load-source",
        status: "fail",
        summary: `${relative(process.cwd(), ADAPTER_PATH)} not found.`,
        trapId: "MS038",
      },
    ]),
    { json: values.json },
  );
}

const src = readFileSync(ADAPTER_PATH, "utf8");

const REQUIRED_MARKERS = [
  {
    id: "imports-schema",
    pattern: /import[^;]*\bliveSurfaceActivityContentState\b[^;]*from\s+["']@mobile-surfaces\/surface-contracts["']/s,
    description: `imports liveSurfaceActivityContentState from ${SCHEMA_IMPORT}`,
  },
  {
    id: "parses-input",
    pattern: /liveSurfaceActivityContentState\s*\.\s*safeParse\s*\(/,
    description: "calls liveSurfaceActivityContentState.safeParse(...) on adapter inputs",
  },
  {
    id: "throws-typed-error",
    pattern: /throw\s+new\s+InvalidContentStateError\s*\(/,
    description: "throws new InvalidContentStateError(...) on parse failure",
  },
  {
    id: "declares-error-class",
    pattern: /export\s+class\s+InvalidContentStateError\s+extends\s+MobileSurfacesError\b/,
    description: "exports class InvalidContentStateError extends MobileSurfacesError",
  },
];

const missing = REQUIRED_MARKERS.filter((m) => !m.pattern.test(src));

const checks = [
  {
    id: "adapter-parse-on-entry",
    status: missing.length === 0 ? "ok" : "fail",
    summary:
      missing.length === 0
        ? `${relative(process.cwd(), ADAPTER_PATH)} parses content state on entry and throws InvalidContentStateError on failure.`
        : `${relative(process.cwd(), ADAPTER_PATH)} is missing ${missing.length} required marker${missing.length === 1 ? "" : "s"} for MS038 parse-on-entry.`,
    trapId: "MS038",
    ...(missing.length > 0
      ? {
          detail: {
            message:
              "The adapter must wrap NativeLiveActivity, parse start/update inputs through liveSurfaceActivityContentState, and throw InvalidContentStateError on safeParse failure. Reverting parse-on-entry re-introduces silent Lock Screen failure on decoder drift.",
            issues: missing.map((m) => ({
              path: `${relative(process.cwd(), ADAPTER_PATH)}#${m.id}`,
              message: `missing: ${m.description}`,
            })),
          },
        }
      : {}),
  },
];

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
