// End-to-end fixture tests for scripts/check-deprecation-prose.mjs.
//
// The check enforces MS042: a "will be removed in X.0.0" claim cannot ship
// from a package at major X or higher. We exercise the script as a
// subprocess against synthesized workspaces so the regex + version-resolution
// logic is verified in the same code path CI runs.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-deprecation-prose.mjs");

function withWorkspace(pkgName, pkgVersion, srcFiles, docsFiles = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-deprecation-"));
  const safeDir = pkgName.replace(/^@[^/]+\//, "");
  const pkgDir = join(dir, "packages", safeDir);
  const srcDir = join(pkgDir, "src");
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: pkgName, version: pkgVersion }, null, 2) + "\n",
  );
  for (const [rel, contents] of Object.entries(srcFiles)) {
    const full = join(srcDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  // Always provide a surface-contracts default so the resolver has a fallback.
  if (pkgName !== "@mobile-surfaces/surface-contracts") {
    const fallbackDir = join(dir, "packages", "surface-contracts");
    mkdirSync(fallbackDir, { recursive: true });
    writeFileSync(
      join(fallbackDir, "package.json"),
      JSON.stringify(
        { name: "@mobile-surfaces/surface-contracts", version: "1.0.0" },
        null,
        2,
      ) + "\n",
    );
  }
  // Optional docs files under apps/site/src/content/docs/.
  if (Object.keys(docsFiles).length > 0) {
    const docsDir = join(dir, "apps", "site", "src", "content", "docs");
    mkdirSync(docsDir, { recursive: true });
    for (const [rel, contents] of Object.entries(docsFiles)) {
      writeFileSync(join(docsDir, rel), contents);
    }
  }
  return dir;
}

function runScript(cwd) {
  return spawnSync(
    "node",
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      SCRIPT,
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
}

test("MS042: prose promising removal in a past major fails", () => {
  const dir = withWorkspace("@mobile-surfaces/example", "5.0.0", {
    "schema-v1.ts":
      "// The file will be removed in 4.0.0, when the v1 codec is dropped.\n",
  });
  try {
    const result = runScript(dir);
    assert.equal(result.status, 1, "expected non-zero exit on broken promise");
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "fail");
    const issues = report.checks[0].detail.issues;
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /will be removed in 4\.0\.0/);
    assert.match(issues[0].message, /major 5/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MS042: prose promising removal in a future major passes", () => {
  const dir = withWorkspace("@mobile-surfaces/example", "5.0.0", {
    "schema-v1.ts":
      "// The file will be removed in 8.0.0, when the v1 codec is dropped.\n",
  });
  try {
    const result = runScript(dir);
    assert.equal(result.status, 0, "expected zero exit on valid prose");
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MS042: CHARTER: keep marker allowlists a specific line", () => {
  const dir = withWorkspace("@mobile-surfaces/example", "5.0.0", {
    "schema-v1.ts":
      "// CHARTER: keep\n// will be removed in 4.0.0\n",
  });
  try {
    const result = runScript(dir);
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MS042: explicit @scope/name@X.0 reference resolves to that package's version", () => {
  // Prose lives in package A but references package B; the check must read B's version.
  const dir = withWorkspace(
    "@mobile-surfaces/example",
    "1.0.0", // example at 1.0.0; bare prose against this would pass
    {
      // But the prose references @mobile-surfaces/other at 5.0.0, which fails.
      "doc.ts":
        "// will be removed in @mobile-surfaces/other@4.0.0\n",
    },
  );
  // Add the referenced package.
  const otherDir = join(dir, "packages", "other");
  mkdirSync(otherDir, { recursive: true });
  writeFileSync(
    join(otherDir, "package.json"),
    JSON.stringify(
      { name: "@mobile-surfaces/other", version: "5.0.0" },
      null,
      2,
    ) + "\n",
  );
  try {
    const result = runScript(dir);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    const issues = report.checks[0].detail.issues;
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /@mobile-surfaces\/other/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MS042: markdown docs participate in the scan", () => {
  const dir = withWorkspace(
    "@mobile-surfaces/surface-contracts",
    "7.0.0",
    {},
    {
      "migration.md":
        "# Migration\n\nThe v3 codec will be removed in 6.0.0.\n",
    },
  );
  try {
    const result = runScript(dir);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    const issues = report.checks[0].detail.issues;
    assert.equal(issues.length, 1);
    assert.match(issues[0].path, /migration\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
