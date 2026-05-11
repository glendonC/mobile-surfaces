#!/usr/bin/env node
// Enforces the binding between data/traps.json `errorClasses` arrays and the
// typed error classes exported from packages/push/src/errors.ts. The catalog
// is the source of truth for which trap a runtime error surfaces; this script
// guarantees that the citation actually points at a real class.
//
// Forward direction (enforced): every name in any trap's `errorClasses`
// array must be exported as a class from packages/push/src/errors.ts.
// Uniqueness (also enforced via Zod superRefine, re-checked here as
// defense-in-depth): each error class is cited by at most one trap.
//
// Reverse direction is intentionally not strict. Many error classes
// (BadPriority, MissingTopic, BadDate) are SDK self-correctness issues, not
// silent-failure traps that warrant a catalog entry. Forcing a one-to-one
// would inflate the catalog with noise. The script does report unbound
// classes for visibility but does not fail on them.
//
// --json mode emits a DiagnosticReport conforming to the Zod schema in
// packages/surface-contracts/src/diagnostics.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { trapCatalog } from "../packages/surface-contracts/src/traps.ts";
import {
  buildReport,
  emitDiagnosticReport,
} from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-trap-error-binding";
const TRAPS_PATH = resolve("data/traps.json");
const ERRORS_PATH = resolve("packages/push/src/errors.ts");

function fail(checks) {
  emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
}

const traps = (() => {
  let raw;
  try {
    raw = readFileSync(TRAPS_PATH, "utf8");
  } catch (error) {
    fail([
      {
        id: "load-traps",
        status: "fail",
        summary: `Could not read ${TRAPS_PATH}.`,
        detail: { message: error.message ?? String(error) },
      },
    ]);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail([
      {
        id: "parse-traps",
        status: "fail",
        summary: `${TRAPS_PATH} is not valid JSON.`,
        detail: { message: error.message ?? String(error) },
      },
    ]);
  }
  const result = trapCatalog.safeParse(parsed);
  if (!result.success) {
    fail([
      {
        id: "validate-traps",
        status: "fail",
        summary: `${TRAPS_PATH} failed Zod validation; run pnpm traps:check for details.`,
      },
    ]);
  }
  return result.data;
})();

const errorsSource = (() => {
  try {
    return readFileSync(ERRORS_PATH, "utf8");
  } catch (error) {
    fail([
      {
        id: "load-errors",
        status: "fail",
        summary: `Could not read ${ERRORS_PATH}.`,
        detail: { message: error.message ?? String(error) },
      },
    ]);
  }
})();

// Match `export class Foo` (with optional `extends ...`) at line start. Keeps
// the script free of TS parser dependencies; the regex is safe because the
// errors file contains only top-level class declarations and no embedded
// strings or comments that resemble export statements at line start.
const exportedClasses = new Set(
  Array.from(errorsSource.matchAll(/^export class (\w+)/gm), (m) => m[1]),
);

// Subset of exported classes that derive from ApnsError. Those are the
// wire-level error classes: they correspond to an APNs `reason` string and
// must be reachable through `reasonToError`'s switch. Classes that extend
// plain `Error` (MissingApnsConfigError, InvalidSnapshotError, etc.) are
// thrown by the SDK itself, not in response to an APNs reason, so they are
// excluded from the reasonToError-wiring check below.
const apnsErrorSubclasses = new Set(
  Array.from(
    errorsSource.matchAll(/^export class (\w+) extends ApnsError/gm),
    (m) => m[1],
  ),
);

// Classes returned by the `reasonToError` switch. Cases look like
// `return new FooError(init)` (with or without spread); the regex captures
// every constructor invocation in the file, which for errors.ts is a clean
// proxy for the switch arms.
const reasonDispatchClasses = new Set(
  Array.from(errorsSource.matchAll(/return new (\w+)\(/gm), (m) => m[1]),
);

// Forward direction: every cited class must be a real export, and any
// ApnsError subclass we cite must be reachable through reasonToError so a
// real APNs response can actually dispatch into it.
const missingClassIssues = [];
const unwiredDispatchIssues = [];
const citedToTrap = new Map();
const duplicateBindingIssues = [];
for (const entry of traps.entries) {
  if (!entry.errorClasses) continue;
  for (const className of entry.errorClasses) {
    if (!exportedClasses.has(className)) {
      missingClassIssues.push({
        path: `${entry.id}.errorClasses`,
        message: `${className} is not exported from packages/push/src/errors.ts`,
      });
    } else if (
      apnsErrorSubclasses.has(className) &&
      !reasonDispatchClasses.has(className)
    ) {
      unwiredDispatchIssues.push({
        path: `${entry.id}.errorClasses`,
        message: `${className} extends ApnsError but has no case in reasonToError; runtime cannot dispatch to it from an APNs response.`,
      });
    }
    const existing = citedToTrap.get(className);
    if (existing && existing !== entry.id) {
      duplicateBindingIssues.push({
        path: `${entry.id}.errorClasses`,
        message: `${className} is also cited by ${existing}`,
      });
    } else {
      citedToTrap.set(className, entry.id);
    }
  }
}

// Reverse-direction visibility (informational only).
const unboundClasses = Array.from(exportedClasses)
  .filter((c) => !citedToTrap.has(c))
  // ApnsError is the abstract base, never thrown directly with that name.
  // UnknownApnsError is the explicit fallback. Neither warrants a binding.
  .filter((c) => c !== "ApnsError" && c !== "UnknownApnsError")
  .sort();

const checks = [
  {
    id: "cited-classes-exist",
    status: missingClassIssues.length === 0 ? "ok" : "fail",
    summary:
      missingClassIssues.length === 0
        ? `All ${citedToTrap.size} cited error classes resolve to real exports.`
        : `${missingClassIssues.length} cited error class${missingClassIssues.length === 1 ? " does" : "es do"} not exist in packages/push/src/errors.ts.`,
    ...(missingClassIssues.length > 0
      ? { detail: { issues: missingClassIssues } }
      : {}),
  },
  {
    id: "binding-uniqueness",
    status: duplicateBindingIssues.length === 0 ? "ok" : "fail",
    summary:
      duplicateBindingIssues.length === 0
        ? "Each error class is cited by at most one trap."
        : `${duplicateBindingIssues.length} error class${duplicateBindingIssues.length === 1 ? "" : "es"} are cited by multiple traps.`,
    ...(duplicateBindingIssues.length > 0
      ? { detail: { issues: duplicateBindingIssues } }
      : {}),
  },
  {
    id: "reason-dispatch-wired",
    status: unwiredDispatchIssues.length === 0 ? "ok" : "fail",
    summary:
      unwiredDispatchIssues.length === 0
        ? "Every cited ApnsError subclass is reachable through reasonToError."
        : `${unwiredDispatchIssues.length} cited ApnsError subclass${unwiredDispatchIssues.length === 1 ? "" : "es"} are not wired into reasonToError.`,
    ...(unwiredDispatchIssues.length > 0
      ? { detail: { issues: unwiredDispatchIssues } }
      : {}),
  },
  {
    id: "unbound-classes",
    status: "ok",
    summary:
      unboundClasses.length === 0
        ? "Every concrete error class is bound to a trap."
        : `${unboundClasses.length} error class${unboundClasses.length === 1 ? "" : "es"} have no trap binding (informational).`,
    ...(unboundClasses.length > 0
      ? {
          detail: {
            message:
              "Reverse-direction binding is not strict; the catalog only covers silent-failure traps. These classes are documented but not cited:",
            paths: unboundClasses,
          },
        }
      : {}),
  },
];

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
