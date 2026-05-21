#!/usr/bin/env node
// Enforces MS039: application code under apps/*/src/ must route
// ActivityKit token subscriptions through @mobile-surfaces/tokens
// instead of calling adapter.addListener("onPushToken", ...) (and
// siblings) directly. The token-store package owns MS020 / MS021;
// hand-rolled subscriptions reliably re-introduce the failure modes
// the package exists to prevent.
//
// The check is grep-shaped. Any file under apps/*/src/ that calls
// addListener with one of the three token-related events is a
// violation: correct code routes the subscription through
// @mobile-surfaces/tokens, whose own addListener call lives inside the
// package (out of scope here), so app code that imports the token
// store still has zero direct token addListener calls. An earlier
// version exempted any file that imported @mobile-surfaces/tokens for
// any reason; that let a file import the store AND hand-roll a direct
// subscription, the exact MS039 violation the rule exists to catch.
//
// Source is run through stripNonCode with keepStrings: true so a
// commented-out subscription cannot trip the gate, while the event-name
// string argument the pattern matches is preserved.
//
// Implementations of the adapter itself (packages/live-activity/src/)
// and the token store (packages/tokens/src/) are not under apps/ and
// are out of scope here.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildReport,
  emitDiagnosticReport,
} from "./lib/diagnostics.mjs";
import { stripNonCode } from "./lib/strip-noncode.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-token-discipline";
const APPS_ROOT = path.resolve("apps");

const TOKEN_EVENTS = [
  "onPushToken",
  "onPushToStartToken",
  "onActivityStateChange",
];

// Files explicitly exempted from MS039 token-discipline. Empty as of
// Phase 3 — the Phase 2 LiveActivityHarness exemption was removed when
// the harness was rewritten as DiagnosticsScreen and rewired through
// @mobile-surfaces/tokens.
const EXEMPT_FILES = new Set();

// Match `addListener("onPushToken", ...)` and friends. Allow either
// single or double quotes; allow whitespace between addListener and
// the parens; allow the event arg to be the first positional arg.
const EVENT_PATTERN = new RegExp(
  `\\baddListener\\s*\\(\\s*[\"'](${TOKEN_EVENTS.join("|")})[\"']`,
);

if (!fs.existsSync(APPS_ROOT)) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "token-discipline",
        status: "ok",
        summary: "No apps/ directory present; nothing to check.",
        trapId: "MS039",
      },
    ]),
    { json: values.json },
  );
}

const violations = [];
let scanned = 0;

for (const entry of fs.readdirSync(APPS_ROOT, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const appSrc = path.join(APPS_ROOT, entry.name, "src");
  try {
    if (!fs.statSync(appSrc).isDirectory()) continue;
  } catch {
    continue;
  }
  walk(appSrc);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && /\.(ts|tsx|mts)$/.test(entry.name)) {
      scanFile(full);
    }
  }
}

function scanFile(file) {
  scanned += 1;
  if (EXEMPT_FILES.has(path.resolve(file))) return;
  const raw = fs.readFileSync(file, "utf8");
  // eventSrc keeps string contents (the "onPushToken" event-name argument the
  // pattern matches) but blanks comments, so a commented-out subscription
  // cannot register. codeSrc additionally blanks string contents; the two
  // share byte offsets. A match is a real violation only when the
  // `addListener` token is still live code in codeSrc -- a match whose
  // `addListener` was blanked there sat entirely inside a string literal
  // (e.g. a doc example) and is not an actual call.
  const eventSrc = stripNonCode(raw, { keepStrings: true });
  const codeSrc = stripNonCode(raw);
  if (!EVENT_PATTERN.test(eventSrc)) return;
  EVENT_PATTERN.lastIndex = 0;
  const matcher = new RegExp(EVENT_PATTERN.source, "g");
  let m;
  while ((m = matcher.exec(eventSrc)) !== null) {
    if (!codeSrc.startsWith("addListener", m.index)) continue; // inside a string
    const line = eventSrc.slice(0, m.index).split("\n").length;
    violations.push({ file, line, event: m[1] });
  }
}

const checks = [
  {
    id: "token-discipline",
    status: violations.length === 0 ? "ok" : "fail",
    summary:
      violations.length === 0
        ? `Token discipline intact (${scanned} file(s) scanned; no direct addListener("onPushToken"|"onPushToStartToken"|"onActivityStateChange") calls in app code).`
        : `${violations.length} call site${violations.length === 1 ? "" : "s"} in app code subscribe to ActivityKit token events via a direct adapter.addListener call.`,
    trapId: "MS039",
    ...(violations.length > 0
      ? {
          detail: {
            message:
              `Route the subscription through @mobile-surfaces/tokens/react (useTokenStore) or createTokenStore + the adapter event wiring in @mobile-surfaces/tokens. ` +
              `Hand-rolled addListener calls in app code re-introduce the MS020 / MS021 failure modes the token-store package exists to prevent.`,
            issues: violations.map((v) => ({
              path: `${path.relative(process.cwd(), v.file)}:${v.line}`,
              message: `addListener("${v.event}", ...) outside @mobile-surfaces/tokens`,
            })),
          },
        }
      : {}),
  },
];

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
