#!/usr/bin/env node
// Bundles the repo at HEAD into template/template.tgz so the published npm
// package is self-contained. Runs as a prepublish step or by hand.
//
// scaffold.mjs prefers this tarball over the dev-mode `git archive` path,
// so the very same code path the user sees after install is what the
// smoke tests exercise.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const outDir = path.join(packageRoot, "template");
const outFile = path.join(outDir, "template.tgz");

if (!fs.existsSync(path.join(repoRoot, "pnpm-workspace.yaml"))) {
  console.error(`Expected a monorepo root at ${repoRoot}.`);
  process.exit(1);
}

// Refuse to bundle a dirty tree — published tarballs must come from a
// committed commit. The CLI displays its own version separately, so it's
// fine if this is ahead of the package version.
const dirty = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], {
  encoding: "utf8",
}).trim();
if (dirty.length > 0) {
  console.error(
    "Working tree has uncommitted changes. Commit first so the bundled template is reproducible.",
  );
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

execFileSync(
  "git",
  ["-C", repoRoot, "archive", "--format=tar.gz", "-o", outFile, "HEAD"],
  { stdio: "inherit" },
);

const sizeKb = Math.round(fs.statSync(outFile).size / 1024);
const sha = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
console.log(`Wrote ${outFile} (${sizeKb} KB) from ${sha.slice(0, 12)}.`);
