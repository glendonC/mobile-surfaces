#!/usr/bin/env node
// Enforces the Live Activity adapter boundary documented in
// https://mobile-surfaces.com/docs/architecture (trap MS001): only the
// per-app adapter re-export <app>/src/liveActivity/index.ts may import from
// @mobile-surfaces/live-activity. Every other call site under apps/*/src/
// must go through that re-export so a future bridge swap (expo-live-activity,
// expo-widgets, etc.) stays a one-file edit. The catalog text scopes this to
// apps/*/src/, so the script scans every app generically rather than
// hardcoding apps/mobile.
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
          : `${violations.length} file(s) import "${TARGET_PACKAGE}" outside the per-app liveActivity/index.ts re-export.`,
    trapId: "MS001",
    ...(violations.length > 0
      ? {
          detail: {
            message: `Route imports through the app's src/liveActivity/index.ts (re-exports liveActivityAdapter and types).`,
            issues: violations.map((v) => ({
              path: `${path.relative(process.cwd(), v.file)}:${v.line}`,
              message: `imports ${TARGET_PACKAGE} directly`,
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
  const src = fs.readFileSync(file, "utf8");
  if (isAdapter) return;
  // Match `from "@mobile-surfaces/live-activity"` and
  // `import("@mobile-surfaces/live-activity")` including subpath imports.
  const re = /(?:from|import)\s*\(?\s*["']@mobile-surfaces\/live-activity(?:\/[^"']*)?["']/g;
  let match;
  while ((match = re.exec(src)) !== null) {
    const line = src.slice(0, match.index).split("\n").length;
    violations.push({ file, line });
  }
}
