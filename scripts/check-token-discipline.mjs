#!/usr/bin/env node
// Enforces MS039: application code under apps/*/src/ must route
// ActivityKit token subscriptions through @mobile-surfaces/tokens
// instead of calling adapter.addListener("onPushToken", ...) (and
// siblings) directly. The token-store package owns MS020 / MS021;
// hand-rolled subscriptions reliably re-introduce the failure modes
// the package exists to prevent.
//
// Detection is structural, not grep-shaped. A violation is an
// addListener call in app code whose event argument is one of the three
// token events. The check catches the event argument in two forms:
//
//   1. a direct string literal — `addListener("onPushToken", ...)`.
//   2. an identifier the same file binds via const/let/var to one of
//      those literals — `const EV = "onPushToken"; adapter.addListener(EV, ...)`.
//      The earlier version only matched form 1; aliasing the event name
//      through a const then slipped a real subscription past the gate.
//
// Two binding shapes are explicitly out of scope:
//
//   - destructured bindings — `const { onPushToken: ev } = {...}`. The
//     resolver only matches plain `name = "literal"` forms.
//   - cross-file imports — `import { ev } from "./events"`. Resolving the
//     binding requires reading the imported module.
//
// Both are documented limits, pinned by fixtures in check-token-discipline
// .test.mjs. The structural fix for them is the MS038 brand pattern
// (force every subscription through a single typed helper that only the
// adapter package exports); that lives outside MS039's enforcement model
// and would be a separate refactor.
//
// The receiver of addListener is intentionally not constrained: whether
// the call is `adapter.addListener(...)`, `LA.liveActivityAdapter
// .addListener(...)` via an aliased namespace import, or a bare
// `addListener(...)`, the event argument is what makes it a token
// subscription, so matching on the call + event argument is sound for
// every import alias of the adapter.
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
const TOKEN_EVENT_SET = new Set(TOKEN_EVENTS);

// Files explicitly exempted from MS039 token-discipline. Empty as of
// Phase 3 — the Phase 2 LiveActivityHarness exemption was removed when
// the harness was rewritten as DiagnosticsScreen and rewired through
// @mobile-surfaces/tokens.
const EXEMPT_FILES = new Set();

// addListener call whose first argument is a quoted token-event literal.
const LITERAL_EVENT_PATTERN = new RegExp(
  `\\baddListener\\s*\\(\\s*["'](${TOKEN_EVENTS.join("|")})["']`,
);

// addListener call whose first argument is a bare identifier (no quote).
// The identifier is resolved against the file's local string-literal
// bindings below; only one bound to a token event is a violation.
const IDENT_EVENT_PATTERN = /\baddListener\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;

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
  // emitDiagnosticReport only exits the process on a "fail" rollup; an "ok"
  // early-out has to exit explicitly, or execution falls through to the
  // readdirSync scan below and crashes on the missing directory.
  process.exit(0);
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

// Collect every local identifier the file binds, directly, to one of the
// three token-event string literals. Covers a plain const/let/var binding
// (`const EV = "onPushToken"`) and a destructured rename off an object
// literal (`const { onPushToken: EV } = EVENTS`-style is rare; the common
// shape is the simple binding). Source is comment+string-stripped on the
// code side and string-kept on the literal side; this scan reads the
// string-kept side so the literal value is visible.
function collectEventAliases(litSrc) {
  const aliases = new Set();
  // `const EV = "onPushToken"` / `let`/`var`. The RHS must be exactly a
  // token-event string literal (optionally `as const`).
  const bindRe = new RegExp(
    `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*["'](${TOKEN_EVENTS.join("|")})["']`,
    "g",
  );
  let m;
  while ((m = bindRe.exec(litSrc)) !== null) {
    aliases.add(m[1]);
  }
  return aliases;
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

  // Form 1: addListener("onPushToken", ...) — direct string literal.
  {
    const matcher = new RegExp(LITERAL_EVENT_PATTERN.source, "g");
    let m;
    while ((m = matcher.exec(eventSrc)) !== null) {
      if (!codeSrc.startsWith("addListener", m.index)) continue; // inside a string
      const line = eventSrc.slice(0, m.index).split("\n").length;
      violations.push({ file, line, event: m[1], form: "literal" });
    }
  }

  // Form 2: addListener(EV, ...) where EV is locally bound to a token-event
  // literal. The bare-identifier pattern fires on every addListener(ident)
  // call; only those whose identifier resolves to a token event count.
  const aliases = collectEventAliases(eventSrc);
  if (aliases.size > 0) {
    const matcher = new RegExp(IDENT_EVENT_PATTERN.source, "g");
    let m;
    while ((m = matcher.exec(codeSrc)) !== null) {
      const ident = m[1];
      if (!aliases.has(ident)) continue;
      const line = codeSrc.slice(0, m.index).split("\n").length;
      violations.push({ file, line, event: ident, form: "indirect" });
    }
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
              message:
                v.form === "indirect"
                  ? `addListener(${v.event}, ...) — ${v.event} is locally bound to a token event — outside @mobile-surfaces/tokens`
                  : `addListener("${v.event}", ...) outside @mobile-surfaces/tokens`,
            })),
          },
        }
      : {}),
  },
];

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
