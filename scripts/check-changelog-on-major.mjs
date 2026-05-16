#!/usr/bin/env node
// MS043: every package under packages/* whose package.json declares a version
// X.0.0 (for X >= 1) must have a matching `## X.0.0` heading in its
// CHANGELOG.md. The body is up to the maintainer; we only assert the heading
// is present.
//
// Why this exists: the v5 linked-group release shipped push, live-activity,
// validators, and create-mobile-surfaces at 5.0.0 with no per-package
// CHANGELOG entry of their own. Downstream consumers reading the CHANGELOG
// to understand the bump found nothing. The release workflow normally writes
// the entry on `changeset version`, but a hand-bumped major or a skipped
// changeset slips past. This gate is the belt to that suspender.
//
// Pre-1.0 packages (0.x.y, 1.x.y where the last 1.0.0 predates the gate) are
// excluded by the X >= 1 condition only checking when the version literal is
// exactly `X.0.0`. Patch and minor releases never trigger this check.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-changelog-on-major";

const PACKAGES_DIR = path.resolve("packages");

// Only consider git-tracked package.json files. A package whose directory is
// untracked (a sibling worktree's in-flight work, a `pnpm dlx` scratch dir)
// is not part of the release surface this gate guards and shouldn't fail the
// commit's pre-merge checks. The check fails closed once the package is
// committed: a tracked package.json at X.0.0 with no tracked CHANGELOG entry
// blocks the merge.
function listTrackedPackages() {
  if (!fs.existsSync(PACKAGES_DIR)) return [];
  let out = "";
  try {
    out = execFileSync(
      "git",
      ["ls-files", "--", "packages/*/package.json"],
      { encoding: "utf8" },
    );
  } catch {
    // Not a git checkout (or git unavailable). Fall back to filesystem.
    return fs
      .readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  }
  const pkgs = new Set();
  for (const line of out.split("\n")) {
    const m = /^packages\/([^/]+)\/package\.json$/.exec(line.trim());
    if (m) pkgs.add(m[1]);
  }
  return [...pkgs].sort();
}

function readPackageVersion(pkgDir) {
  const pkgPath = path.join(PACKAGES_DIR, pkgDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return { name: pkg.name ?? pkgDir, version: pkg.version ?? null };
  } catch {
    return null;
  }
}

// Match `X.0.0` exactly (no prerelease/build metadata). Ignores `5.0.0-beta.1`
// on purpose — pre-releases of a major are an intentional interim state and
// the CHANGELOG entry lands at the final tag.
const MAJOR_RE = /^(\d+)\.0\.0$/;

function changelogHasMajorHeading(pkgDir, major) {
  const changelogPath = path.join(PACKAGES_DIR, pkgDir, "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) return false;
  const content = fs.readFileSync(changelogPath, "utf8");
  // Match `## X.0.0` on its own line (allow trailing whitespace).
  const headingRe = new RegExp(`^## ${major}\\.0\\.0\\s*$`, "m");
  return headingRe.test(content);
}

const issues = [];
const inspected = [];

for (const pkgDir of listTrackedPackages()) {
  const info = readPackageVersion(pkgDir);
  if (!info || !info.version) continue;
  const match = MAJOR_RE.exec(info.version);
  if (!match) continue;
  const major = Number(match[1]);
  if (major < 1) continue;
  inspected.push({ name: info.name, version: info.version });
  if (!changelogHasMajorHeading(pkgDir, major)) {
    issues.push({
      path: `packages/${pkgDir}/CHANGELOG.md`,
      message: `${info.name} declares version ${info.version} but CHANGELOG.md is missing a "## ${major}.0.0" heading.`,
    });
  }
}

emitDiagnosticReport(
  buildReport(TOOL, [
    {
      id: "changelog-on-major",
      status: issues.length === 0 ? "ok" : "fail",
      trapId: "MS043",
      summary:
        issues.length === 0
          ? `All ${inspected.length} major-versioned package(s) have a matching CHANGELOG heading.`
          : `${issues.length} package(s) at X.0.0 are missing a "## X.0.0" CHANGELOG heading.`,
      ...(issues.length > 0
        ? {
            detail: {
              message:
                "Write the CHANGELOG entry. Use `pnpm changeset version` if it didn't run, or hand-write the `## X.0.0` heading with the major changes underneath.",
              issues,
            },
          }
        : {}),
    },
  ]),
  { json: values.json },
);
