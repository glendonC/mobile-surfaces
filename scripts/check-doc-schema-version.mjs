#!/usr/bin/env node
// Grep every `.md` file in the repo for stale `schemaVersion: "<n>"`
// literals that reference a wire-format generation other than the canonical
// CANONICAL_SCHEMA_VERSION from scripts/lib/schema-url.mjs.
//
// Why this exists: a schema-major bump touches dozens of doc snippets, and
// it is easy to miss one. v3 → v4 specifically had to update the root
// README and the surface-contracts README; future bumps will face the same
// shape. This script fails the surface:check chain on any stale literal so
// the doc and the wire format cannot diverge.
//
// Coverage:
//   - Every `.md` file in the repo, including apps/site/ doc pages.
//   - Top-level README.md and packages/<pkg>/README.md.
//   - Excludes `notes/` (historical RFCs) and CHANGELOG.md basenames.
//
// Out of scope:
//   - The CLI template tarball at packages/create-mobile-surfaces/template/
//     template.tgz. Scanning inside the tarball requires a zero-dep tar
//     reader which is more complexity than this guard warrants; the
//     `release:dry-run --fix` flow regenerates the tarball from the live
//     scaffold sources anyway, so any stale schemaVersion literal inside
//     the tarball would be overwritten on the next release prep.
//     TODO: add tarball scanning if a stale literal ever escapes that flow.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import { CANONICAL_SCHEMA_VERSION } from "./lib/schema-url.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-doc-schema-version";

// Both quote styles. Captures the literal value between the quotes.
const SCHEMA_VERSION_RE = /schemaVersion\s*:\s*['"]([^'"\s]+)['"]/g;

// Directories under the repo root that should not be scanned.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".expo",
  ".turbo",
  ".next",
  ".astro",
  "coverage",
  "Pods",
  ".cache",
]);

// Repo-root-relative path prefixes whose .md files are excluded from the
// scan. Each exclusion is justified inline; keep this list small.
//
//   notes/        - design/RFC notes record historical decisions and
//                   reference older schemaVersion literals on purpose.
//
// apps/site/ used to be excluded because the docs/UX chat owned it on a
// separate branch. It is in scope now: a previous schema-major bump shipped
// stale literals there because the guard was blind. The regex requires a
// colon (`schemaVersion: "<n>"`), so migration-table rows like
// `| schemaVersion | "3" | "4" |` and codec-guard examples like
// `payload.schemaVersion === "3"` do not match and stay legitimate.
const SKIP_PATH_PREFIXES = ["notes/"];

// File basenames whose `schemaVersion: "<n>"` references are historical by
// definition (release notes describing past wire formats). Excluded from
// the scan everywhere they appear.
const SKIP_BASENAMES = new Set(["CHANGELOG.md"]);

function* walkMd(dir, relDir = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_PATH_PREFIXES.some((p) => `${childRel}/`.startsWith(p))) continue;
      yield* walkMd(path.join(dir, entry.name), childRel);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      if (SKIP_PATH_PREFIXES.some((p) => childRel.startsWith(p))) continue;
      if (SKIP_BASENAMES.has(entry.name)) continue;
      yield childRel;
    }
  }
}

const repoRoot = path.resolve(".");
const issues = [];
let scanned = 0;

for (const rel of walkMd(repoRoot)) {
  scanned += 1;
  const abs = path.join(repoRoot, rel);
  const src = fs.readFileSync(abs, "utf8");
  // Reset lastIndex because the regex is global and reused across files.
  SCHEMA_VERSION_RE.lastIndex = 0;
  let m;
  while ((m = SCHEMA_VERSION_RE.exec(src)) !== null) {
    const version = m[1];
    if (version === CANONICAL_SCHEMA_VERSION) continue;
    // Compute line number for an actionable error message.
    const upToMatch = src.slice(0, m.index);
    const line = upToMatch.split("\n").length;
    issues.push({
      path: `${rel}:${line}`,
      message: `schemaVersion: "${version}" should be "${CANONICAL_SCHEMA_VERSION}"`,
    });
  }
}

emitDiagnosticReport(
  buildReport(TOOL, [
    {
      id: "doc-schema-version",
      status: issues.length === 0 ? "ok" : "fail",
      summary:
        issues.length === 0
          ? `All schemaVersion literals across ${scanned} .md file(s) match "${CANONICAL_SCHEMA_VERSION}".`
          : `${issues.length} stale schemaVersion literal(s) across ${scanned} .md file(s).`,
      ...(issues.length > 0
        ? {
            detail: {
              message: `Canonical schemaVersion is "${CANONICAL_SCHEMA_VERSION}" (from scripts/lib/schema-url.mjs). Update each offending file to match.`,
              issues,
            },
          }
        : {}),
    },
  ]),
  { json: values.json },
);
