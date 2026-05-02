#!/usr/bin/env node
// Enforces the Live Activity adapter boundary documented in
// docs/architecture.md: only apps/mobile/src/liveActivity/index.ts may import
// from @mobile-surfaces/live-activity. Every other call site under
// apps/mobile/src/ must go through the adapter re-export so a future bridge
// swap (expo-live-activity, expo-widgets, etc.) stays a one-file edit.
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
const ROOT = path.resolve("apps/mobile/src");
const ADAPTER_FILE = path.join(ROOT, "liveActivity", "index.ts");
const TARGET_PACKAGE = "@mobile-surfaces/live-activity";

if (!fs.existsSync(ROOT)) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "load-source",
        status: "fail",
        summary: "apps/mobile/src not found — run from repo root.",
      },
    ]),
    { json: values.json },
  );
}

const violations = [];
let scanned = 0;
walk(ROOT);

const adapterRel = path.relative(process.cwd(), ADAPTER_FILE);
const checks = [
  {
    id: "adapter-boundary",
    status: violations.length === 0 ? "ok" : "fail",
    summary:
      violations.length === 0
        ? `Adapter boundary intact (${scanned} file(s) scanned, only ${adapterRel} imports "${TARGET_PACKAGE}").`
        : `${violations.length} file(s) import "${TARGET_PACKAGE}" outside ${adapterRel}.`,
    trapId: "MS001",
    ...(violations.length > 0
      ? {
          detail: {
            message: `Route imports through ${adapterRel} (re-exports liveActivityAdapter and types).`,
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
  const src = fs.readFileSync(file, "utf8");
  // Match `from "@mobile-surfaces/live-activity"` and
  // `import("@mobile-surfaces/live-activity")` including subpath imports.
  const re = /(?:from|import)\s*\(?\s*["']@mobile-surfaces\/live-activity(?:\/[^"']*)?["']/g;
  let match;
  while ((match = re.exec(src)) !== null) {
    if (path.resolve(file) === path.resolve(ADAPTER_FILE)) continue;
    const line = src.slice(0, match.index).split("\n").length;
    violations.push({ file, line });
  }
}
