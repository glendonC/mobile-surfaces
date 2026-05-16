#!/usr/bin/env node
// Enforces MS039: application code under apps/*/src/ must route
// ActivityKit token subscriptions through @mobile-surfaces/tokens
// instead of calling adapter.addListener("onPushToken", ...) (and
// siblings) directly. The token-store package owns MS020 / MS021;
// hand-rolled subscriptions reliably re-introduce the failure modes
// the package exists to prevent.
//
// The check is grep-shaped. A file that calls addListener with one
// of the three token-related events is a violation unless it also
// imports from @mobile-surfaces/tokens (or @mobile-surfaces/tokens/react
// — the sub-path import counts).
//
// Implementations of the adapter itself (packages/live-activity/src/)
// and the token store (packages/tokens/src/) are scanned by other
// gates and explicitly out of scope here.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildReport,
  emitDiagnosticReport,
} from "./lib/diagnostics.mjs";

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

const TOKENS_IMPORT_PATTERN = /from\s+["']@mobile-surfaces\/tokens(?:\/[^"']*)?["']/;

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
  const src = fs.readFileSync(file, "utf8");
  if (!EVENT_PATTERN.test(src)) return;
  // The file subscribes to a token event. It must import from
  // @mobile-surfaces/tokens (vanilla or /react). If it does, the
  // assumption is the subscription is routed through the store.
  if (TOKENS_IMPORT_PATTERN.test(src)) return;
  // Record one violation per matching addListener call so the
  // diagnostic detail lists the line numbers.
  EVENT_PATTERN.lastIndex = 0;
  const matcher = new RegExp(EVENT_PATTERN.source, "g");
  let m;
  while ((m = matcher.exec(src)) !== null) {
    const line = src.slice(0, m.index).split("\n").length;
    violations.push({ file, line, event: m[1] });
  }
}

const checks = [
  {
    id: "token-discipline",
    status: violations.length === 0 ? "ok" : "fail",
    summary:
      violations.length === 0
        ? `Token discipline intact (${scanned} file(s) scanned; no direct addListener("onPushToken"|"onPushToStartToken"|"onActivityStateChange") outside @mobile-surfaces/tokens consumers).`
        : `${violations.length} call site${violations.length === 1 ? "" : "s"} subscribe to ActivityKit token events without importing @mobile-surfaces/tokens.`,
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
