#!/usr/bin/env node
// Enforces the binding between data/traps.json `errorClasses` arrays and
// every typed error class across the Mobile Surfaces monorepo.
//
// Before v7 this script only scanned packages/push/src/errors.ts. The v7
// refactor introduced `@mobile-surfaces/traps` as the single home for the
// error base class (MobileSurfacesError); every package that throws now
// derives from it. The scan widens to cover all source roots so a new
// error class can never be added without either (a) appearing in the
// catalog, (b) being on the explicit "intentionally unbound" allowlist,
// or (c) coming with a corresponding traps.json entry.
//
// Forward direction (enforced): every name in any trap's `errorClasses`
// array must be exported as a class from one of the scanned source files.
// Uniqueness (also enforced via Zod superRefine, re-checked here as
// defense-in-depth): each error class is cited by at most one trap.
//
// Reverse direction: every concrete MobileSurfacesError subclass must
// either be cited by a trap or live on the INTENTIONALLY_UNBOUND
// allowlist. The push package's "self-correctness" classes (BadPriority,
// MissingChannelId-on-construction, etc.) and the SDK lifecycle classes
// (ClientClosedError, AbortError) sit on the allowlist because their
// failure mode is the SDK refusing the call, not a silent runtime trap.
//
// Apns-specific dispatch wiring (`reasonToError`) is also re-validated.
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

// Manifest of every source file the scan reads. The push errors file is
// load-bearing (drives the wire-level ApnsError taxonomy + reasonToError
// dispatch); the others are scanned for class declarations only.
//
// `apnsTaxonomy: true` opts a file into the additional reasonToError
// wiring check (ApnsError subclasses must be reachable through the
// `reasonToError` switch, otherwise the runtime cannot dispatch into them
// from an APNs response).
const SOURCES = [
  { path: "packages/push/src/errors.ts", apnsTaxonomy: true },
  { path: "packages/live-activity/src/index.ts", apnsTaxonomy: false },
];

// Concrete subclasses of MobileSurfacesError that intentionally have no
// catalog entry. These are SDK self-correctness errors (BadPriority,
// MissingChannelId at the construction edge before APNs sees it) and SDK
// lifecycle errors (ClientClosedError, AbortError) — the failure mode is
// the SDK refusing the call, not a silent runtime trap that needs an
// MS-rule to surface.
const INTENTIONALLY_UNBOUND = new Set([
  // base classes (never thrown directly with this name):
  "ApnsError",
  "UnknownApnsError",
  // self-correctness — SDK rejects the call:
  "BadPriorityError",
  "BadExpirationDateError",
  "BadDateError",
  "MissingPushTypeError",
  "InvalidPushTypeError",
  "CannotCreateChannelConfigError",
  // SDK lifecycle:
  "ClientClosedError",
  "AbortError",
  "CreateChannelResponseError",
  // transient / 5xx fallthroughs — observability bucket, not silent trap:
  "InternalServerError",
  "ServiceUnavailableError",
  // live-activity JS-side wrapper class; the catalog binding flows through
  // the native suffix on a per-case basis (set on LiveActivityNativeError
  // instances), not through the class name.
  "LiveActivityNativeError",
]);

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

// Per-source: exported classes; the union across all sources is the set
// the cited-class check resolves against. apnsErrorSubclasses and
// reasonDispatchClasses are scoped to the push errors file only.
const exportedClasses = new Set();
const exportedToSource = new Map();
let apnsErrorSubclasses = new Set();
let reasonDispatchClasses = new Set();

for (const source of SOURCES) {
  let text;
  try {
    text = readFileSync(resolve(source.path), "utf8");
  } catch (error) {
    fail([
      {
        id: "load-source",
        status: "fail",
        summary: `Could not read ${source.path}.`,
        detail: { message: error.message ?? String(error) },
      },
    ]);
  }
  for (const m of text.matchAll(/^export class (\w+)/gm)) {
    exportedClasses.add(m[1]);
    exportedToSource.set(m[1], source.path);
  }
  if (source.apnsTaxonomy) {
    apnsErrorSubclasses = new Set(
      Array.from(
        text.matchAll(/^export class (\w+) extends ApnsError/gm),
        (m) => m[1],
      ),
    );
    reasonDispatchClasses = new Set(
      Array.from(text.matchAll(/return new (\w+)\(/gm), (m) => m[1]),
    );
  }
}

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
        message: `${className} is not exported from any scanned source file.`,
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

// Reverse direction: every concrete exported class is either cited by a
// trap or explicitly on the INTENTIONALLY_UNBOUND allowlist. Unlike v6,
// this is now strict (a fail rather than informational) — the allowlist
// is the single chokepoint for "self-correctness or lifecycle, not a
// silent trap" classes.
const unboundIssues = [];
for (const className of [...exportedClasses].sort()) {
  if (citedToTrap.has(className)) continue;
  if (INTENTIONALLY_UNBOUND.has(className)) continue;
  unboundIssues.push({
    path: exportedToSource.get(className) ?? "(unknown)",
    message: `${className} has no trap binding and is not on the INTENTIONALLY_UNBOUND allowlist.`,
  });
}

const checks = [
  {
    id: "cited-classes-exist",
    status: missingClassIssues.length === 0 ? "ok" : "fail",
    summary:
      missingClassIssues.length === 0
        ? `All ${citedToTrap.size} cited error classes resolve to real exports.`
        : `${missingClassIssues.length} cited error class${missingClassIssues.length === 1 ? " does" : "es do"} not exist in the scanned source files.`,
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
    id: "unbound-classes-allowlisted",
    status: unboundIssues.length === 0 ? "ok" : "fail",
    summary:
      unboundIssues.length === 0
        ? "Every exported error class is bound to a trap or explicitly allowlisted."
        : `${unboundIssues.length} exported error class${unboundIssues.length === 1 ? " is" : "es are"} unbound and not on the INTENTIONALLY_UNBOUND allowlist.`,
    ...(unboundIssues.length > 0
      ? {
          detail: {
            issues: unboundIssues,
            message:
              "Either add an `errorClasses` entry to data/traps.json for the binding, or add the class name to INTENTIONALLY_UNBOUND in scripts/check-trap-error-binding.mjs with a one-line rationale.",
          },
        }
      : {}),
  },
];

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
