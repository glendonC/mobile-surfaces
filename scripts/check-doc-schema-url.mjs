#!/usr/bin/env node
// Grep every `.md` file in the repo for published-JSON-Schema URLs
// (`@mobile-surfaces/surface-contracts@<major.minor>/schema.json`) whose
// version segment names a package major other than the current one.
//
// Why this exists: the schema URL embeds the surface-contracts package
// major, and a major bump leaves that literal hand-typed across READMEs and
// doc pages. The sibling check-doc-schema-version.mjs already gates the
// `schemaVersion: "<n>"` wire literal; this gates the *URL* form, which
// keys off the package version rather than the wire-format generation
// (they are different numbers: schemaVersion is "5" while the package and
// its URL are at major 9). A stale URL points consumers at an older schema
// than the one the package ships.
//
// What counts as stale:
//   - A major NEWER than canonical is always wrong (a typo or a premature
//     reference): flagged everywhere.
//   - A major OLDER than canonical is wrong in prose (a current-schema
//     claim gone stale) but legitimate inside a markdown table, where
//     before/after migration rows reference past majors on purpose. Older
//     majors on a table row are allowed.
//   - The minor segment is not checked. Older minor URLs stay resolvable
//     forever (unpkg never deletes a published artifact) and docs cite
//     hypothetical future minors (`@9.1`, `@9.N`) when explaining the
//     pinning rule, so only the major carries the drift that matters.
//
// Coverage mirrors check-doc-schema-version.mjs: every `.md` file in the
// repo, excluding notes/ (historical RFCs) and CHANGELOG.md basenames.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import { canonicalSchemaUrl, UPSTREAM_PACKAGE_NAME } from "./lib/schema-url.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-doc-schema-url";

// Matches both the full schema URL and the abbreviated `@<version>/schema.json`
// form docs use as shorthand. The version segment must start with a digit, so
// `@<major.minor>/schema.json` placeholder templates and `@scope/schema.json`
// package paths do not match and stay legitimate.
const SCHEMA_URL_RE = /@([0-9][0-9A-Za-z.]*)\/schema\.json/g;

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

// notes/ holds design/RFC notes that reference older schema URLs on purpose.
const SKIP_PATH_PREFIXES = ["notes/"];
// Release notes describe past wire formats and their URLs by definition.
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

// Classify one URL match. Returns null when the URL is fine, else a reason.
function staleReason({ version, line, src, canonicalMajor }) {
  const major = version.split(".")[0];
  if (!/^[0-9]+$/.test(major)) return null; // placeholder major, not a literal
  const n = Number.parseInt(major, 10);
  if (n === canonicalMajor) return null;
  if (n > canonicalMajor) {
    return `schema URL major @${version} is newer than the canonical major ${canonicalMajor}`;
  }
  // Older major: allowed on a markdown table row (before/after migration
  // rows cite past majors on purpose), stale anywhere else.
  const lineText = src.split("\n")[line - 1] ?? "";
  if (lineText.trimStart().startsWith("|")) return null;
  return `stale schema URL major @${version}; the canonical major is ${canonicalMajor}`;
}

const repoRoot = path.resolve(".");
const canonicalUrl = canonicalSchemaUrl();

let checkResult;
if (canonicalUrl === null) {
  // A fork that renamed the package publishes no schema URL; nothing to gate.
  checkResult = {
    id: "doc-schema-url",
    status: "ok",
    summary: `Package is not ${UPSTREAM_PACKAGE_NAME}; no canonical schema URL to enforce.`,
  };
} else {
  const canonicalMajor = Number.parseInt(
    canonicalUrl.match(/@([0-9]+)\./)[1],
    10,
  );
  const issues = [];
  let scanned = 0;
  for (const rel of walkMd(repoRoot)) {
    scanned += 1;
    const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    SCHEMA_URL_RE.lastIndex = 0;
    let m;
    while ((m = SCHEMA_URL_RE.exec(src)) !== null) {
      const line = src.slice(0, m.index).split("\n").length;
      const reason = staleReason({
        version: m[1],
        line,
        src,
        canonicalMajor,
      });
      if (reason) issues.push({ path: `${rel}:${line}`, message: reason });
    }
  }
  checkResult = {
    id: "doc-schema-url",
    status: issues.length === 0 ? "ok" : "fail",
    summary:
      issues.length === 0
        ? `All schema URLs across ${scanned} .md file(s) match canonical major ${canonicalMajor}.`
        : `${issues.length} stale schema URL(s) across ${scanned} .md file(s).`,
    ...(issues.length > 0
      ? {
          detail: {
            message: `Canonical schema URL is ${canonicalUrl} (from packages/surface-contracts/package.json). Update each offending URL's major segment to match.`,
            issues,
          },
        }
      : {}),
  };
}

emitDiagnosticReport(buildReport(TOOL, [checkResult]), { json: values.json });
