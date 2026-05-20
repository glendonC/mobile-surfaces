#!/usr/bin/env node
// `pnpm audit:diff` - guard the audit grid's changelog discipline.
//
// notes/audit-state.md is the canonical record of the catalog's enforcement
// surface: the diff against notes/audit-state.v8.md is the v9 audit report
// (see notes/refactor-v9.md Phase 6). For that diff to stay meaningful, every
// edit to the grid must be dated. This script prints the diff of
// notes/audit-state.md against a base ref and exits non-zero when the file
// changed but its `audit-date:` front-matter header did not.
//
// Base ref resolution: --base <ref>, else $AUDIT_DIFF_BASE, else a freshly
// fetched origin/main, else HEAD (which degrades to showing only uncommitted
// changes). CI runs this against origin/main; locally it catches an
// uncommitted grid edit before it is pushed.
import { execSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { base: { type: "string" } },
});

const TARGET = "notes/audit-state.md";

function tryGit(cmd, opts = {}) {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8", ...opts });
  } catch {
    return null;
  }
}

function resolveBase() {
  if (values.base) return values.base;
  if (process.env.AUDIT_DIFF_BASE) return process.env.AUDIT_DIFF_BASE;
  // Best-effort refresh so the diff reflects the real merge base, not a
  // stale local origin/main. Shallow is enough: a two-dot diff compares
  // tree states and needs no shared history.
  tryGit("fetch --no-tags --quiet --depth=1 origin main", { stdio: "ignore" });
  for (const ref of ["FETCH_HEAD", "origin/main", "main"]) {
    if (tryGit(`rev-parse --verify --quiet ${ref}`, { stdio: "pipe" }) !== null) {
      return ref;
    }
  }
  return "HEAD";
}

const base = resolveBase();
const diff = tryGit(`diff ${base} -- ${TARGET}`);
if (diff === null) {
  console.error(`audit:diff: could not diff ${TARGET} against ${base}.`);
  process.exit(1);
}

if (diff.trim() === "") {
  console.log(`audit:diff: ${TARGET} is unchanged against ${base}.`);
  process.exit(0);
}

console.log(`audit:diff: ${TARGET} changed against ${base}:\n`);
console.log(diff);

// A changed `audit-date:` header appears as a -/+ pair in the diff body.
const dateTouched = diff
  .split("\n")
  .some((line) => /^[+-]audit-date:/.test(line));

if (!dateTouched) {
  console.error(
    `\naudit:diff: ${TARGET} changed but its \`audit-date:\` header did not.\n` +
      "The audit grid is a dated changelog: bump the audit-date header in the\n" +
      "front matter so the v9 closure diff stays readable.",
  );
  process.exit(1);
}

console.log(`\naudit:diff: audit-date header was updated alongside the change.`);
