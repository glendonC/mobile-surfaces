#!/usr/bin/env node
// Grep every `.md` doc file for stale promise prose: TODO, FIXME, XXX,
// "coming soon", "will ship", "future scaffolding", "planned but not
// shipped", "not yet shipped", and similar tells.
//
// Also flags unsubstantiated marketing comparatives ("fastest",
// "production-grade", "blazing", and similar puffery) in the published doc
// site, unless the same line carries a citation — a markdown link, a test
// reference, or an issue number — that backs the claim. The brand voice for
// Mobile Surfaces copy is declarative: a superlative either earns its place
// with evidence or it does not belong in the docs. "the only" is
// deliberately NOT in the comparative list: it has heavy legitimate factual
// use in these docs ("the only blessed migration entry point", "the only
// linked group") and is not puffery.
//
// Why this exists: between v5 and v7 the docs accumulated unfulfilled
// promises that shipped releases ago ("future scaffolding should publish
// create-mobile-surfaces..." at architecture.md:154 — already shipped),
// orphan TODOs ("TODO: add tarball scanning..."), and aspirational lists
// of "future consumers" that never materialized. These erode credibility
// every time a new reader notices one. This gate fails the surface:check
// chain on any stale-promise pattern in the prose, so the doc and the
// shipped state cannot drift.
//
// Also flags forbidden terms: words a shipped doc must not use because they
// misdescribe the architecture or name a removed API ("pool" / "pooling" --
// the push client multiplexes over one HTTP/2 session per origin, it does
// not pool; "safeParseAnyVersion" -- a migration entry point removed at
// surface-contracts 9.0). And it verifies that every relative link in the
// repo-root README.md resolves to a file that exists.
//
// Coverage:
//   - apps/site/src/content/docs/**/*.md
//   - README.md (repo root)
//   - packages/*/README.md
//
// Out of scope:
//   - notes/ (historical RFCs and refactor ledgers; these intentionally
//     reference past or speculative work)
//   - CHANGELOG.md basenames (history)
//   - Inline code comments — only Markdown prose.
//
// Allowlist:
//   - A line whose surrounding lines (within 2 above or below) contain
//     an issue link (`#123` or `[#123]`) OR a roadmap-style "intentionally
//     deferred" marker is allowed. The convention is to put a clear link
//     to the tracking issue next to any aspirational copy. If you cannot
//     justify a "future" claim with a link, the claim should not be in
//     published docs.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-doc-promises";

// Patterns that read as stale promise prose. Case-insensitive. Each
// matches a phrase a reader would interpret as "this isn't shipped yet"
// or "this is a placeholder for later work."
const PROMISE_PATTERNS = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bXXX\b/,
  /\bcoming soon\b/i,
  /\bwill ship\b/i,
  /\bnot yet shipped\b/i,
  /\bplanned but not shipped\b/i,
  /\bfuture scaffolding\b/i,
  /\bfuture consumers? \(planned/i,
];

// Allowlist tells: presence of any of these within +/-2 lines of the
// matched line marks the claim as "intentionally deferred with a tracking
// link" and excuses it from the gate.
const ALLOWLIST_PATTERNS = [
  /#\d+/, // GitHub issue ref
  /\[#\d+\]/, // markdown link to a tracking issue
  /intentionally deferred/i,
  /upstream-blocked/i,
];

// Unsubstantiated marketing comparatives. These are puffery a reference
// architecture should not lean on: each one is a claim that begs for a
// benchmark or a citation. Checked only in the published doc site (not
// package READMEs, which describe shipped APIs in plainer terms).
const COMPARATIVE_PATTERNS = [
  /\bfastest\b/i,
  /\bblazing(?:[\s-]fast)?\b/i,
  /\bproduction-grade\b/i,
  /\bworld-class\b/i,
  /\bindustry-leading\b/i,
  /\bbest-in-class\b/i,
  /\bcutting-edge\b/i,
  /\bstate-of-the-art\b/i,
  /\bseamless(?:ly)?\b/i,
  /\beffortless(?:ly)?\b/i,
  /\bunmatched\b/i,
  /\bthe easiest\b/i,
  /\bsimplest way\b/i,
];

// A comparative is excused when the SAME line carries evidence: a markdown
// link (the claim points at something), a test-file reference, or an issue
// number. "Paired with a citation on the same line" per the v9 plan.
const CITATION_PATTERNS = [
  /\]\(/, // markdown link
  /#\d+/, // issue ref
  /[\w/-]+\.(?:test|spec)\.\w+/, // test-file reference
];

// Comparatives are scanned only under this subtree (the published site).
const COMPARATIVE_SCOPE = "apps/site/src/content/docs";

// Forbidden terms: words a shipped doc must not use. Unlike the promise
// patterns, there is no allowlist -- a forbidden term is always wrong, so
// the fix is to rewrite the prose, not to link a tracking issue. Scanned
// across every doc surface.
const FORBIDDEN_TERMS = [
  {
    // The push client multiplexes over a single HTTP/2 session per origin;
    // "connection pooling" / "session pool" misdescribes that architecture.
    pattern: /\bpool(?:ing|ed|s)?\b/i,
    reason:
      'misdescribes the push client: it multiplexes over one HTTP/2 session per origin, it does not pool. Use "single-session HTTP/2 multiplexing".',
  },
  {
    // safeParseAnyVersion was the multi-version migration entry point; it
    // was removed at surface-contracts 9.0. Docs must not name it as a live
    // API. See schema.md's migration appendix for the current guidance.
    pattern: /\bsafeParseAnyVersion\b/,
    reason:
      "names safeParseAnyVersion, removed at surface-contracts 9.0. Describe the migration without naming the removed function.",
  },
];

// The repo-root README is the one doc whose relative links are checked: its
// links point at repo files (./AGENTS.md, ./data/traps.json). Doc-site pages
// use site-routing links (/docs/...) that do not map to file paths and are
// out of scope here.
const README_REL = "README.md";

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

const SKIP_PATH_PREFIXES = ["notes/"];

const SKIP_BASENAMES = new Set(["CHANGELOG.md"]);

// Only scan the doc-prose surfaces; do not walk the entire repo tree
// (that includes generated bindings, schema, and AGENTS.md/CLAUDE.md
// which are rendered from data/traps.json and may legitimately mention
// "future" as part of a catalog entry's prose).
const SCAN_ROOTS = [
  "README.md",
  "apps/site/src/content/docs",
  "packages/surface-contracts/README.md",
  "packages/push/README.md",
  "packages/live-activity/README.md",
  "packages/tokens/README.md",
  "packages/traps/README.md",
  "packages/validators/README.md",
  "packages/create-mobile-surfaces/README.md",
];

function* walkMdRoot(absRoot, relRoot) {
  const stat = fs.statSync(absRoot, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isFile()) {
    if (absRoot.endsWith(".md") && !SKIP_BASENAMES.has(path.basename(absRoot))) {
      yield relRoot;
    }
    return;
  }
  for (const entry of fs.readdirSync(absRoot, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const childRel = `${relRoot}/${entry.name}`;
    if (SKIP_PATH_PREFIXES.some((p) => childRel.startsWith(p))) continue;
    if (entry.isDirectory()) {
      yield* walkMdRoot(path.join(absRoot, entry.name), childRel);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      if (SKIP_BASENAMES.has(entry.name)) continue;
      yield childRel;
    }
  }
}

const repoRoot = path.resolve(".");
const issues = [];
const comparativeIssues = [];
const forbiddenIssues = [];
const linkIssues = [];
let scanned = 0;

for (const root of SCAN_ROOTS) {
  for (const rel of walkMdRoot(path.join(repoRoot, root), root)) {
    scanned += 1;
    const abs = path.join(repoRoot, rel);
    const src = fs.readFileSync(abs, "utf8");
    const lines = src.split("\n");
    const inComparativeScope = rel.startsWith(COMPARATIVE_SCOPE);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      // Skip lines inside fenced code blocks where TODO is often a
      // genuine snippet, not prose. Track open/close by counting triple
      // backticks; not perfect, but the false-positive cost is low
      // because real TODOs in published prose still get caught.
      if (line.trimStart().startsWith("```")) continue;
      for (const pat of PROMISE_PATTERNS) {
        if (!pat.test(line)) continue;
        // Check +/-2 lines for an allowlist marker.
        const window = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
        if (ALLOWLIST_PATTERNS.some((p) => p.test(window))) continue;
        issues.push({
          path: `${rel}:${i + 1}`,
          message: line.trim(),
        });
        break; // one issue per line is enough
      }
      // Forbidden terms: always wrong, no allowlist. Scanned everywhere.
      for (const term of FORBIDDEN_TERMS) {
        const m = term.pattern.exec(line);
        if (!m) continue;
        forbiddenIssues.push({
          path: `${rel}:${i + 1}`,
          message: `"${m[0]}" ${term.reason}`,
        });
        break;
      }
      // Comparatives: doc-site only, excused by a same-line citation.
      if (inComparativeScope) {
        for (const pat of COMPARATIVE_PATTERNS) {
          const m = pat.exec(line);
          if (!m) continue;
          if (CITATION_PATTERNS.some((c) => c.test(line))) break;
          comparativeIssues.push({
            path: `${rel}:${i + 1}`,
            message: `unsubstantiated comparative "${m[0]}": ${line.trim()}`,
          });
          break;
        }
      }
    }
  }
}

// README internal-link resolution: every relative link target in the
// repo-root README must point at a file that exists. External URLs
// (http/https/mailto), in-page anchors (#...), and site-absolute paths
// (/docs/...) are out of scope -- only on-disk repo links are verified.
const readmeAbs = path.join(repoRoot, README_REL);
if (fs.existsSync(readmeAbs)) {
  const readmeSrc = fs.readFileSync(readmeAbs, "utf8");
  const readmeLines = readmeSrc.split("\n");
  const linkRe = /\]\(([^)]+)\)/g;
  for (let i = 0; i < readmeLines.length; i += 1) {
    let m;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(readmeLines[i])) !== null) {
      const target = m[1].trim();
      if (
        /^(?:https?:|mailto:)/i.test(target) ||
        target.startsWith("#") ||
        target.startsWith("/")
      ) {
        continue;
      }
      // Drop any #anchor or ?query suffix before resolving the file path.
      const filePart = target.split(/[#?]/)[0];
      if (filePart === "") continue;
      if (!fs.existsSync(path.resolve(repoRoot, filePart))) {
        linkIssues.push({
          path: `${README_REL}:${i + 1}`,
          message: `relative link target does not exist: ${target}`,
        });
      }
    }
  }
}

emitDiagnosticReport(
  buildReport(TOOL, [
    {
      id: "doc-promises",
      status: issues.length === 0 ? "ok" : "fail",
      summary:
        issues.length === 0
          ? `No stale promise prose found across ${scanned} doc file(s).`
          : `${issues.length} stale-promise line(s) across ${scanned} doc file(s).`,
      ...(issues.length > 0
        ? {
            detail: {
              message:
                "Doc prose cannot ship 'TODO', 'coming soon', 'will ship', or similar without an adjacent #issue link or 'intentionally deferred' marker. Either link the tracking issue or rewrite the claim.",
              issues,
            },
          }
        : {}),
    },
    {
      id: "doc-comparatives",
      status: comparativeIssues.length === 0 ? "ok" : "fail",
      summary:
        comparativeIssues.length === 0
          ? "No unsubstantiated comparatives in the doc site."
          : `${comparativeIssues.length} unsubstantiated comparative(s) in the doc site.`,
      ...(comparativeIssues.length > 0
        ? {
            detail: {
              message:
                "A marketing comparative in the doc site needs a citation on the same line (a markdown link, a test reference, or an issue number) or it should be rewritten declaratively. Brand voice for Mobile Surfaces copy is declarative, not superlative.",
              issues: comparativeIssues,
            },
          }
        : {}),
    },
    {
      id: "doc-forbidden-terms",
      status: forbiddenIssues.length === 0 ? "ok" : "fail",
      summary:
        forbiddenIssues.length === 0
          ? `No forbidden terms across ${scanned} doc file(s).`
          : `${forbiddenIssues.length} forbidden-term occurrence(s) across ${scanned} doc file(s).`,
      ...(forbiddenIssues.length > 0
        ? {
            detail: {
              message:
                "A forbidden term either misdescribes the architecture or names a removed API. There is no allowlist; rewrite the prose.",
              issues: forbiddenIssues,
            },
          }
        : {}),
    },
    {
      id: "readme-links",
      status: linkIssues.length === 0 ? "ok" : "fail",
      summary:
        linkIssues.length === 0
          ? "Every relative link in README.md resolves."
          : `${linkIssues.length} unresolved relative link(s) in README.md.`,
      ...(linkIssues.length > 0
        ? {
            detail: {
              message:
                "A relative link in README.md points at a file that does not exist. Fix the path or remove the link.",
              issues: linkIssues,
            },
          }
        : {}),
    },
  ]),
  { json: values.json },
);
