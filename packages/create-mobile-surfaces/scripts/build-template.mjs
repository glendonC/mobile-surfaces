#!/usr/bin/env node
// Bundles the repo at HEAD into template/template.tgz AND writes a
// pre-baked template/manifest.json so the published npm package is
// self-contained.
//
// At runtime, scaffold.mjs prefers the tarball over the dev-mode
// `git archive` path; template-manifest.mjs prefers the JSON snapshot
// over reading the live repo. So one publish step seeds both code paths.
//
// Runs as `prepublishOnly` for the CLI package or by hand.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifestFromLive } from "../src/template-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const outDir = path.join(packageRoot, "template");
const tarballPath = path.join(outDir, "template.tgz");
const manifestPath = path.join(outDir, "manifest.json");

if (!fs.existsSync(path.join(repoRoot, "pnpm-workspace.yaml"))) {
  console.error(`Expected a monorepo root at ${repoRoot}.`);
  process.exit(1);
}

// Refuse to bundle a dirty tree — published tarballs must come from a
// committed commit. The standard release workflow commits version bumps
// before invoking publish (Changesets does not auto-commit, so the user
// commits between `version` and `publish` themselves).
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

// 1) Source tarball — the materialized starter that scaffold.mjs extracts.
execFileSync(
  "git",
  ["-C", repoRoot, "archive", "--format=tar.gz", "-o", tarballPath, "HEAD"],
  { stdio: "inherit" },
);

// 2) Manifest snapshot — what template-manifest.mjs reads at runtime to
// know which packages, plugins, and Info.plist keys to add. Built from
// the same live source the dev path reads from, so the two modes return
// identical shapes.
const manifest = buildManifestFromLive(repoRoot);

// In dev mode, our @mobile-surfaces/* packages show up in the manifest as
// `workspace:*` markers and the CLI skips installing them (they live as
// workspace siblings in the user's cloned monorepo for greenfield). For
// the published manifest, rewrite those markers to concrete pinned
// versions read from each package's own package.json so the
// add-to-existing flow can pull them from npm. Exact pins match the
// project's wider exact-pin discipline (check-external-pins.mjs) and the
// linked-group release cadence: every @mobile-surfaces/* package ships
// together on the same version, so a caret here would float silently
// across linked-group republishes without an intentional bump.
const packagesByName = new Map();
const packagesDir = path.join(repoRoot, "packages");
for (const dirName of fs.readdirSync(packagesDir)) {
  const pkgPath = path.join(packagesDir, dirName, "package.json");
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (pkg.name && pkg.version) packagesByName.set(pkg.name, pkg.version);
}
manifest.addPackages = manifest.addPackages.map((pkg) => {
  if (!pkg.workspace) return pkg;
  const v = packagesByName.get(pkg.name);
  if (!v) return pkg;
  return { name: pkg.name, version: v };
});

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const sizeKb = Math.round(fs.statSync(tarballPath).size / 1024);
const sha = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
console.log(
  `Wrote ${tarballPath} (${sizeKb} KB) from ${sha.slice(0, 12)}.\n` +
    `Wrote ${manifestPath}.`,
);
