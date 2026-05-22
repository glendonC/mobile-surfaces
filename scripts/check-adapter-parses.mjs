#!/usr/bin/env node
// Enforces MS038: the Live Activity adapter at
// packages/live-activity/src/index.ts validates every ContentState through
// liveSurfaceActivityContentState before it crosses the native bridge.
//
// This check does not grep for the parse call and hope it is wired in. The
// adapter carries the guarantee in its types: the native module's start /
// update signatures require a `ParsedContentState`, a nominal brand that only
// parseContentState can mint. TypeScript (via `pnpm build`, which emits
// declarations and so typechecks the package) rejects any path that forwards
// an unvalidated content state across the bridge. A refactor that keeps the
// parse vocabulary but drops the behavior, the failure mode an earlier
// presence-grep version of this check could not catch, is now either a
// compile error or a violation of one of the structural invariants below.
//
// The brand can be forged in exactly one way: an explicit `as ParsedContentState`
// cast. That cast is a deliberate, visible escape hatch, and a deliberate
// escape hatch is the one thing a static check can police reliably. So this
// check verifies:
//
//   1. imports-schema      liveSurfaceActivityContentState is imported.
//   2. declares-error-class InvalidContentStateError is declared.
//   3. native-requires-brand the native module's start and update declare
//                            their state parameter as ParsedContentState, so
//                            the compiler carries the dataflow guarantee.
//   4. brand-minted-once   exactly one `as ParsedContentState` cast exists.
//   5. brand-from-parse    that cast applies to a safeParse result's `.data`,
//                          not to a raw adapter input.
//   6. failure-branch-throws the safeParse failure branch throws
//                            InvalidContentStateError, so a parse failure
//                            cannot fall through to a minted brand.
//
// Source is run through stripNonCode first, so a marker that survives only
// inside a comment or string literal cannot satisfy any invariant.

import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import { stripNonCode } from "./lib/strip-noncode.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-adapter-parses";
const ADAPTER_PATH = resolve("packages/live-activity/src/index.ts");
const SCHEMA_IMPORT = "@mobile-surfaces/surface-contracts";

function fail(summary, issues) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "adapter-parse-on-entry",
        status: "fail",
        summary,
        trapId: "MS038",
        ...(issues
          ? {
              detail: {
                message:
                  "The adapter must route every bridge-crossing ContentState through a single safeParse-and-throw choke point. The native module's start / update signatures require the ParsedContentState brand, which only that choke point may mint. Reverting parse-on-entry re-introduces silent Lock Screen failure on decoder drift.",
                issues,
              },
            }
          : {}),
      },
    ]),
    { json: values.json },
  );
}

// Return the `{ ... }` block (braces included) that opens at or after
// startIdx, balancing nested braces. Source is comment- and string-stripped,
// so no brace can hide inside a literal.
function extractBlock(src, startIdx) {
  const open = src.indexOf("{", startIdx);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

if (!existsSync(ADAPTER_PATH)) {
  fail(`${relative(process.cwd(), ADAPTER_PATH)} not found.`, null);
}

const rawSrc = readFileSync(ADAPTER_PATH, "utf8");
// codeSrc blanks comments and string/regex contents; importSrc keeps string
// contents (a module specifier is itself a string) but still blanks comments.
const codeSrc = stripNonCode(rawSrc);
const importSrc = stripNonCode(rawSrc, { keepStrings: true });

const rel = relative(process.cwd(), ADAPTER_PATH);
const issues = [];

// 1. imports-schema
if (
  !/import[^;]*\bliveSurfaceActivityContentState\b[^;]*from\s+["']@mobile-surfaces\/surface-contracts["']/s.test(
    importSrc,
  )
) {
  issues.push({
    path: `${rel}#imports-schema`,
    message: `does not import liveSurfaceActivityContentState from ${SCHEMA_IMPORT}`,
  });
}

// 2. declares-error-class
if (
  !/export\s+class\s+InvalidContentStateError\s+extends\s+MobileSurfacesError\b/.test(
    codeSrc,
  )
) {
  issues.push({
    path: `${rel}#declares-error-class`,
    message:
      "does not export class InvalidContentStateError extends MobileSurfacesError",
  });
}

// 3. native-requires-brand: the native module's start and update must declare
// their state parameter as ParsedContentState. This is the invariant that
// makes TypeScript reject an unvalidated state crossing the bridge; without
// it, the brand is decorative.
const nativeClassIdx = codeSrc.search(
  /\bdeclare\s+class\s+LiveActivityNativeModule\b/,
);
if (nativeClassIdx === -1) {
  issues.push({
    path: `${rel}#native-requires-brand`,
    message: "declare class LiveActivityNativeModule not found",
  });
} else {
  const nativeBlock = extractBlock(codeSrc, nativeClassIdx);
  if (!nativeBlock) {
    issues.push({
      path: `${rel}#native-requires-brand`,
      message: "LiveActivityNativeModule class body could not be parsed",
    });
  } else {
    for (const method of ["start", "update"]) {
      const branded = new RegExp(
        `\\b${method}\\s*\\([^)]*\\bstate\\s*:\\s*ParsedContentState\\b`,
      ).test(nativeBlock);
      if (!branded) {
        issues.push({
          path: `${rel}#native-requires-brand`,
          message: `LiveActivityNativeModule.${method} must declare its state parameter as ParsedContentState so the compiler enforces parse-on-entry`,
        });
      }
    }
  }
}

// 4 + 5. brand-minted-once / brand-from-parse: exactly one `as ParsedContentState`
// cast, and it must apply to a safeParse result's `.data`.
const castMatches = codeSrc.match(/\bas\s+ParsedContentState\b/g) ?? [];
let parseResultIdent = null;
if (castMatches.length !== 1) {
  issues.push({
    path: `${rel}#brand-minted-once`,
    message: `expected exactly one \`as ParsedContentState\` cast (the single brand mint site), found ${castMatches.length}`,
  });
} else {
  const fromParse = codeSrc.match(
    /\b([A-Za-z_$][\w$]*)\s*\.\s*data\s+as\s+ParsedContentState\b/,
  );
  if (!fromParse) {
    issues.push({
      path: `${rel}#brand-from-parse`,
      message:
        "the `as ParsedContentState` cast must apply to a safeParse result's `.data`; a cast on a raw input forges the brand without validating",
    });
  } else {
    parseResultIdent = fromParse[1];
  }
}

// 5 (cont). The cast operand must be bound from liveSurfaceActivityContentState.safeParse.
if (parseResultIdent) {
  const boundFromSafeParse = new RegExp(
    `\\b(?:const|let|var)\\s+${parseResultIdent}\\s*=\\s*liveSurfaceActivityContentState\\s*\\.\\s*safeParse\\s*\\(`,
  ).test(codeSrc);
  if (!boundFromSafeParse) {
    issues.push({
      path: `${rel}#brand-from-parse`,
      message: `\`${parseResultIdent}\` is cast to ParsedContentState but is not bound from liveSurfaceActivityContentState.safeParse(...)`,
    });
  }

  // 6. failure-branch-throws: the safeParse failure branch must throw, so a
  // failed parse cannot reach the brand mint.
  const failureThrows = new RegExp(
    `if\\s*\\(\\s*!\\s*${parseResultIdent}\\s*\\.\\s*success\\s*\\)\\s*\\{\\s*throw\\s+new\\s+InvalidContentStateError\\s*\\(`,
  ).test(codeSrc);
  if (!failureThrows) {
    issues.push({
      path: `${rel}#failure-branch-throws`,
      message: `the \`!${parseResultIdent}.success\` branch must immediately throw new InvalidContentStateError(...); a parse failure must not fall through to the brand mint`,
    });
  }
}

if (issues.length > 0) {
  fail(
    `${rel} fails ${issues.length} MS038 parse-on-entry invariant${issues.length === 1 ? "" : "s"}.`,
    issues,
  );
}

emitDiagnosticReport(
  buildReport(TOOL, [
    {
      id: "adapter-parse-on-entry",
      status: "ok",
      summary: `${rel} validates content state on entry: the native bridge requires the ParsedContentState brand, and the single mint site parses through liveSurfaceActivityContentState and throws InvalidContentStateError on failure.`,
      trapId: "MS038",
    },
  ]),
  { json: values.json },
);
