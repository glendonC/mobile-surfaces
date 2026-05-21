#!/usr/bin/env node
// Generates packages/push/src/reasons.ts from data/apns-reasons.json, the
// single source of truth for the set of APNs response reasons Mobile Surfaces
// recognizes.
//
// Why generated: the README claims @mobile-surfaces/push ships "a typed error
// for every documented APNs reason". That claim is only true if the reason
// table, the error-class table, and the reasonToError switch never drift apart.
// This generator owns the reason table; scripts/check-apns-reason-coverage.mjs
// gates errors.ts against the same source. Together they turn an unverifiable
// prose claim into a closed, CI-enforced invariant.
//
// What is NOT generated: errors.ts keeps its hand-written ApnsError subclasses
// (each carries class-specific JSDoc and, for TooManyRequestsError, an extra
// field) and transport.ts keeps RETRYABLE_TRANSPORT_CODES (a transport-layer
// concern, not an APNs application reason). The coverage check is what binds
// errors.ts to this source; the transport set has no APNs-reason coupling.
//
// Pass --check to compare on-disk against the regenerated output and exit
// non-zero on drift (CI guard; same shape as generate-app-group-constants.mjs).
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const TOOL = "generate-apns-reasons";
const SOURCE = path.resolve("data/apns-reasons.json");
const OUT = path.resolve("packages/push/src/reasons.ts");

const HEADER =
  "// GENERATED - DO NOT EDIT. Source: data/apns-reasons.json.\n" +
  "// Regenerate: pnpm surface:codegen\n";

function fail(message) {
  emitDiagnosticReport(
    buildReport(TOOL, [{ id: "generate-apns-reasons", status: "fail", summary: message }]),
    { json: values.json },
  );
}

function readReasons() {
  if (!fs.existsSync(SOURCE)) {
    fail(`data/apns-reasons.json not found at ${SOURCE}`);
  }
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
  const seen = new Set();
  for (const entry of reasons) {
    for (const field of ["reason", "cause", "fix"]) {
      if (typeof entry?.[field] !== "string" || entry[field].length === 0) {
        fail(`reason entry is missing a non-empty string \`${field}\`: ${JSON.stringify(entry)}`);
      }
    }
    for (const field of ["retryable", "terminal"]) {
      if (typeof entry?.[field] !== "boolean") {
        fail(`reason "${entry.reason}" must declare a boolean \`${field}\`.`);
      }
    }
    if (!/^[A-Za-z]+$/.test(entry.reason)) {
      fail(`reason "${entry.reason}" must be a bare alphabetic identifier.`);
    }
    if (seen.has(entry.reason)) {
      fail(`reason "${entry.reason}" is declared more than once.`);
    }
    if (entry.retryable && entry.terminal) {
      fail(`reason "${entry.reason}" cannot be both retryable and terminal.`);
    }
    seen.add(entry.reason);
  }
  return reasons;
}

// JSON.stringify yields a valid, fully-escaped TypeScript double-quoted string
// literal for any prose content, so cause/fix copy can carry quotes or other
// metacharacters without breaking the generated file.
function lit(value) {
  return JSON.stringify(value);
}

function renderGuideEntry(entry) {
  return (
    `  ${entry.reason}: {\n` +
    `    cause: ${lit(entry.cause)},\n` +
    `    fix: ${lit(entry.fix)},\n` +
    `  },\n`
  );
}

function renderSet(reasons) {
  if (reasons.length === 0) return "new Set([])";
  return `new Set([\n${reasons.map((r) => `  "${r}",\n`).join("")}])`;
}

function render(reasons) {
  const retryable = reasons.filter((r) => r.retryable).map((r) => r.reason);
  const terminal = reasons.filter((r) => r.terminal).map((r) => r.reason);
  return (
    HEADER +
    "//\n" +
    "// APNs reason -> cause/fix table. Reason strings are taken verbatim from\n" +
    "// Apple's APNs documentation; the channel reasons come from the iOS 18\n" +
    "// broadcast and channel-management APIs. errors.ts maps each reason to a\n" +
    "// typed ApnsError subclass via reasonToError; scripts/check-apns-reason-\n" +
    "// coverage.mjs gates that mapping against data/apns-reasons.json.\n" +
    "\n" +
    "export interface ApnsReasonGuideEntry {\n" +
    "  cause: string;\n" +
    "  fix: string;\n" +
    "}\n" +
    "\n" +
    "export const APNS_REASON_GUIDE: Record<string, ApnsReasonGuideEntry> = {\n" +
    reasons.map(renderGuideEntry).join("") +
    "};\n" +
    "\n" +
    "/**\n" +
    " * Reasons that the default retry policy should treat as retryable. Connection\n" +
    " * errors (ECONNRESET, etc.) are handled separately at the transport layer via\n" +
    " * RETRYABLE_TRANSPORT_CODES in transport.ts.\n" +
    " *\n" +
    " * ExpiredProviderToken is included because the SDK invalidates the JwtCache\n" +
    " * on that reason before the retry attempt, so the next request carries a\n" +
    " * freshly-minted token. Without that JWT invalidation the retry would loop\n" +
    " * sending the same expired bearer; with it, a single retry recovers from a\n" +
    " * mid-flight expiry / clock-skew rejection (MS030) without surfacing to the\n" +
    " * caller. The TERMINAL_REASONS guard still denies retries for permanently-\n" +
    " * broken tokens, so this widening cannot mask BadDeviceToken / Unregistered.\n" +
    " *\n" +
    " * Membership is derived from `retryable: true` in data/apns-reasons.json.\n" +
    " */\n" +
    `export const DEFAULT_RETRYABLE_REASONS: ReadonlySet<string> = ${renderSet(retryable)};\n` +
    "\n" +
    "/**\n" +
    " * Reasons that will never recover on retry and must never be retried, even if\n" +
    " * a caller-supplied `retryableReasons` set happens to include one of them by\n" +
    " * mistake. The PushClient denies these before consulting `retryableReasons`,\n" +
    " * so retry-policy widening cannot accidentally burn budget on tokens that\n" +
    " * iOS has permanently rejected.\n" +
    " *\n" +
    " * Membership is intentionally narrow and is derived from `terminal: true` in\n" +
    " * data/apns-reasons.json: only reasons guaranteed to stay broken on the next\n" +
    " * attempt (bad-device-token, payload-too-large, topic-disallowed, unregistered\n" +
    " * token). Provider-token reasons such as ExpiredProviderToken are NOT terminal\n" +
    " * because the SDK refreshes the JWT on the next attempt; auth-key revocation\n" +
    " * (Forbidden) is also excluded so the default policy can surface it via the\n" +
    " * existing reason-not-in-retryable fallthrough rather than appearing to be a\n" +
    " * configurable knob.\n" +
    " */\n" +
    `export const TERMINAL_REASONS: ReadonlySet<string> = ${renderSet(terminal)};\n`
  );
}

const reasons = readReasons();
const output = render(reasons);

if (values.check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  const inSync = current === output;
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "apns-reasons-codegen-sync",
        status: inSync ? "ok" : "fail",
        summary: inSync
          ? "packages/push/src/reasons.ts is in sync with data/apns-reasons.json."
          : "packages/push/src/reasons.ts is out of sync with data/apns-reasons.json.",
        ...(inSync
          ? {}
          : {
              detail: {
                message:
                  "Run: node --experimental-strip-types scripts/generate-apns-reasons.mjs",
                issues: [
                  {
                    path: path.relative(process.cwd(), OUT),
                    message: "out of sync with data/apns-reasons.json",
                  },
                ],
              },
            }),
      },
    ]),
    { json: values.json },
  );
} else {
  fs.writeFileSync(OUT, output);
  const wrote = path.relative(process.cwd(), OUT);
  if (values.json) {
    emitDiagnosticReport(
      buildReport(TOOL, [
        { id: "apns-reasons-codegen-write", status: "ok", summary: `Wrote ${wrote}.` },
      ]),
      { json: true },
    );
  } else {
    console.log(`Wrote ${wrote}.`);
  }
}
