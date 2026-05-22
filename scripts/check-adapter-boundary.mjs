#!/usr/bin/env node
// Enforces the Live Activity adapter boundary documented in
// https://mobile-surfaces.com/docs/architecture (trap MS001): only the
// per-app adapter re-export <app>/src/liveActivity/index.ts may import from
// @mobile-surfaces/live-activity. Every other call site under apps/*/src/
// must go through that re-export so a future bridge swap (expo-live-activity,
// expo-widgets, etc.) stays a one-file edit. The catalog text scopes this to
// apps/*/src/, so the script scans every app generically rather than
// hardcoding apps/mobile.
//
// Detection is structural, not grep-shaped. The earlier version matched a
// single `(?:from|import)\s*\(?\s*"<pkg>"` regex; that caught the named,
// default, and dynamic forms but conflated "aliased import" with
// "undetectable import". An `import * as LA from "<pkg>"` or a renamed
// default `import Renamed from "<pkg>"` carries the specifier in the same
// trailing `from "<pkg>"` clause as any other import — the alias lives on
// the binding side, never the source side — so a from-anchored match catches
// it. findModuleImports() (scripts/lib/module-imports.mjs) matches the four
// statement forms (from / bare side-effect / dynamic import() / require())
// explicitly, so a re-export, a bare `import "<pkg>"`, or a CJS `require` can
// no longer slip past. Source is run through stripNonCode first (keepStrings,
// so the specifier literal survives) so a commented-out import does not trip
// the gate.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildReport,
  emitDiagnosticReport,
} from "./lib/diagnostics.mjs";
import { stripNonCode } from "./lib/strip-noncode.mjs";
import { findModuleImports } from "./lib/module-imports.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-adapter-boundary";
const APPS_ROOT = path.resolve("apps");
const TARGET_PACKAGE = "@mobile-surfaces/live-activity";

// Each app's adapter re-export is the one allowed importer for that app.
function adapterFileFor(appSrc) {
  return path.join(appSrc, "liveActivity", "index.ts");
}

if (!fs.existsSync(APPS_ROOT)) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "load-source",
        status: "fail",
        summary: "apps/ not found — run from repo root.",
      },
    ]),
    { json: values.json },
  );
}

// Collect every apps/<app>/src directory. An app dir without a src/ folder
// (or with src/ as a file) is simply skipped — not every app has TS source.
const appSrcRoots = [];
for (const entry of fs.readdirSync(APPS_ROOT, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const appSrc = path.join(APPS_ROOT, entry.name, "src");
  let stat;
  try {
    stat = fs.statSync(appSrc);
  } catch {
    continue;
  }
  if (stat.isDirectory()) appSrcRoots.push(appSrc);
}

const violations = [];
let scanned = 0;
// The set of adapter files (one per app) that are allowed to import the
// target package directly.
const adapterFiles = new Set(
  appSrcRoots.map((appSrc) => path.resolve(adapterFileFor(appSrc))),
);
for (const appSrc of appSrcRoots) {
  walk(appSrc);
}

const checks = [
  {
    id: "adapter-boundary",
    status: violations.length === 0 ? "ok" : "fail",
    summary:
      appSrcRoots.length === 0
        ? `No apps/*/src directories found — nothing to check.`
        : violations.length === 0
          ? `Adapter boundary intact (${scanned} file(s) across ${appSrcRoots.length} app(s) scanned, only each app's liveActivity/index.ts imports "${TARGET_PACKAGE}").`
          : `${violations.length} import site(s) reach "${TARGET_PACKAGE}" outside the per-app liveActivity/index.ts re-export.`,
    trapId: "MS001",
    ...(violations.length > 0
      ? {
          detail: {
            message: `Route imports through the app's src/liveActivity/index.ts (re-exports liveActivityAdapter and types). Detection is structural: a named, default, namespace (\`* as\`), aliased, re-export, dynamic \`import()\`, or \`require()\` of the package all count.`,
            issues: violations.map((v) => ({
              path: `${path.relative(process.cwd(), v.file)}:${v.line}`,
              message: `imports ${TARGET_PACKAGE} directly (${v.form} import)`,
            })),
          },
        }
      : {}),
  },
];

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      scanFile(full);
    }
  }
}

function scanFile(file) {
  scanned += 1;
  // An app's own liveActivity/index.ts is the allowed importer; skip it.
  const isAdapter = adapterFiles.has(path.resolve(file));
  if (isAdapter) return;
  const raw = fs.readFileSync(file, "utf8");
  // keepStrings: true so the module-specifier string literal survives the
  // strip (it is what findModuleImports matches), while comments are still
  // blanked so a commented-out import cannot register.
  const src = stripNonCode(raw, { keepStrings: true });
  for (const hit of findModuleImports(src, TARGET_PACKAGE)) {
    violations.push({ file, line: hit.line, form: hit.form });
  }
}
