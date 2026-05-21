#!/usr/bin/env node
// Gates packages/push/src/errors.ts against data/apns-reasons.json, the
// canonical list of APNs reasons Mobile Surfaces recognizes.
//
// The README claims @mobile-surfaces/push ships "a typed error for every
// documented APNs reason". generate-apns-reasons.mjs keeps the reason table
// (reasons.ts) in sync with the source; this check closes the other half:
//   - every reason in data/apns-reasons.json has an exported ApnsError
//     subclass in errors.ts, and a `case` in the reasonToError switch;
//   - the reasonToError switch carries no `case` for a reason absent from
//     the source (an orphan case means the source is behind the code);
//   - the "Error responses" reference table in apps/site/src/content/docs/
//     push.md lists a row for every reason, so the published docs cannot
//     fall behind the typed taxonomy.
//
// With these gates green the prose claim is a closed, CI-enforced invariant
// rather than something a reader has to take on trust.
//
// errors.ts is parsed as text rather than imported: importing it would couple
// this stage-3 check to the build state of @mobile-surfaces/traps. The source
// is run through stripNonCode with keepStrings:true first, so a `case` or
// `class` inside a comment cannot satisfy (or, for the orphan check, falsely
// trip) the gate, while the reason string literals the case-scan needs are
// preserved. Identifier-presence parsing is sufficient: the file's structure
// is regular and the failure consequence is low.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import { stripNonCode } from "./lib/strip-noncode.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-apns-reason-coverage";
const SOURCE = path.resolve("data/apns-reasons.json");
const ERRORS_TS = path.resolve("packages/push/src/errors.ts");
const PUSH_DOC = path.resolve("apps/site/src/content/docs/push.md");

// Class name for a reason: `<Reason>Error`, unless the reason already ends in
// "Error" (InternalServerError), in which case the class name is the reason
// verbatim. errors.ts follows this rule for every ApnsError subclass.
function classNameFor(reason) {
  return reason.endsWith("Error") ? reason : `${reason}Error`;
}

function fail(summary, detail) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      { id: "apns-reason-coverage", status: "fail", summary, ...(detail ? { detail } : {}) },
    ]),
    { json: values.json },
  );
}

if (!fs.existsSync(SOURCE)) fail(`data/apns-reasons.json not found at ${SOURCE}.`);
if (!fs.existsSync(ERRORS_TS)) fail(`packages/push/src/errors.ts not found at ${ERRORS_TS}.`);

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
} catch (err) {
  fail(`data/apns-reasons.json is not valid JSON: ${err.message}`);
}
const reasons = parsed?.reasons;
if (!Array.isArray(reasons) || reasons.length === 0) {
  fail("data/apns-reasons.json must declare a non-empty `reasons` array.");
}
const sourceReasons = reasons.map((r) => r.reason);

const src = stripNonCode(fs.readFileSync(ERRORS_TS, "utf8"), { keepStrings: true });

// Declared ApnsError subclasses.
const declaredClasses = new Set();
for (const m of src.matchAll(/export\s+class\s+(\w+)\s+extends\s+ApnsError\b/g)) {
  declaredClasses.add(m[1]);
}

// `case "<Reason>":` entries inside the reasonToError switch. Scope to the
// function body so an unrelated switch elsewhere cannot contribute cases.
const fnStart = src.indexOf("function reasonToError");
const switchBody = fnStart === -1 ? "" : src.slice(fnStart);
const switchCases = new Set();
for (const m of switchBody.matchAll(/case\s+"(\w+)":/g)) {
  switchCases.add(m[1]);
}

const missing = [];
for (const reason of sourceReasons) {
  const cls = classNameFor(reason);
  if (!declaredClasses.has(cls)) {
    missing.push({ path: reason, message: `no \`export class ${cls} extends ApnsError\` in errors.ts` });
  }
  if (!switchCases.has(reason)) {
    missing.push({ path: reason, message: `no \`case "${reason}":\` in the reasonToError switch` });
  }
}

const sourceSet = new Set(sourceReasons);
const orphans = [];
for (const reason of switchCases) {
  if (!sourceSet.has(reason)) {
    orphans.push({
      path: reason,
      message: `reasonToError maps "${reason}" but it is absent from data/apns-reasons.json`,
    });
  }
}

// Docs: the "Error responses" reference table in push.md must carry a row for
// every reason. Prose in that table is hand-written and intentionally richer
// than the source guide; only row presence is gated.
const docGaps = [];
if (!fs.existsSync(PUSH_DOC)) {
  docGaps.push({ path: "push.md", message: `${PUSH_DOC} not found` });
} else {
  const doc = fs.readFileSync(PUSH_DOC, "utf8");
  const docReasons = new Set();
  for (const m of doc.matchAll(/^\|\s*`(\w+)`\s*\|\s*`\w+Error`\s*\|/gm)) {
    docReasons.add(m[1]);
  }
  for (const reason of sourceReasons) {
    if (!docReasons.has(reason)) {
      docGaps.push({
        path: reason,
        message: `no row for "${reason}" in the Error responses table of push.md`,
      });
    }
  }
}

const issues = [...missing, ...orphans, ...docGaps];
const checks = [
  {
    id: "apns-reason-coverage",
    status: issues.length === 0 ? "ok" : "fail",
    summary:
      issues.length === 0
        ? `errors.ts maps every one of the ${sourceReasons.length} APNs reasons in data/apns-reasons.json to a typed subclass.`
        : `${issues.length} APNs reason coverage gap(s) between data/apns-reasons.json and packages/push/src/errors.ts.`,
    ...(issues.length === 0
      ? {}
      : {
          detail: {
            message:
              "Add the missing ApnsError subclass and reasonToError case in packages/push/src/errors.ts, " +
              "or update data/apns-reasons.json. The README claim of a typed error per documented reason " +
              "depends on this gate staying green.",
            issues,
          },
        }),
  },
];

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
