#!/usr/bin/env node
// Enforces the Live Activity adapter boundary documented in
// docs/architecture.md: only apps/mobile/src/liveActivity/index.ts may import
// from @mobile-surfaces/live-activity. Every other call site under
// apps/mobile/src/ must go through the adapter re-export so a future bridge
// swap (expo-live-activity, expo-widgets, etc.) stays a one-file edit.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("apps/mobile/src");
const ADAPTER_FILE = path.join(ROOT, "liveActivity", "index.ts");
const TARGET_PACKAGE = "@mobile-surfaces/live-activity";

if (!fs.existsSync(ROOT)) {
  console.error(`apps/mobile/src not found — run from repo root.`);
  process.exit(1);
}

const violations = [];
let scanned = 0;
walk(ROOT);

if (violations.length > 0) {
  console.error(
    `Adapter boundary violated. ${violations.length} file(s) import "${TARGET_PACKAGE}" outside the adapter:`,
  );
  for (const v of violations) {
    console.error(`- ${path.relative(process.cwd(), v.file)}:${v.line}`);
  }
  console.error(
    `\nRoute imports through ${path.relative(process.cwd(), ADAPTER_FILE)} (re-exports liveActivityAdapter and types).`,
  );
  process.exit(1);
}

console.log(
  `Adapter boundary intact (${scanned} file(s) scanned, only ${path.relative(process.cwd(), ADAPTER_FILE)} imports "${TARGET_PACKAGE}").`,
);

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
