// computeCliMode picks bundled-tarball vs live-monorepo source. The risk this
// covers (ledger row A2): the bundled template.tgz and manifest.json are
// gitignored build outputs, so a developer who once ran build:template can be
// left with stale ones on disk. The old probe was existence-aware — any
// tarball on disk won — so a stale tarball silently shadowed live source.
// computeCliMode is freshness-aware: next to a live monorepo it trusts the
// bundle only when the commit id git archive embedded in the tarball matches
// HEAD, else it falls back to live source.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { computeCliMode, readTarballCommitId } from "../src/template-manifest.mjs";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-mode-"));
});

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
});

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

// A throwaway git repo that looks like the monorepo (has pnpm-workspace.yaml).
// Returns the root and its current HEAD; commit() advances HEAD.
function makeMonorepo() {
  const repoRoot = path.join(tmp, "repo");
  fs.mkdirSync(repoRoot);
  git(repoRoot, ["init", "-q"]);
  git(repoRoot, ["config", "user.email", "t@example.com"]);
  git(repoRoot, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "packages:\n");
  let n = 0;
  const commit = () => {
    fs.writeFileSync(path.join(repoRoot, "marker.txt"), String(n++));
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-qm", `commit ${n}`]);
    return git(repoRoot, ["rev-parse", "HEAD"]);
  };
  return { repoRoot, commit };
}

// Write bundled artifacts: a manifest.json and a template.tgz archived from
// the given ref of repoRoot. Returns the template dir.
function writeBundle(repoRoot, ref) {
  const templateDir = path.join(tmp, "template");
  fs.mkdirSync(templateDir, { recursive: true });
  fs.writeFileSync(path.join(templateDir, "manifest.json"), "{}\n");
  execFileSync(
    "git",
    [
      "-C",
      repoRoot,
      "archive",
      "--format=tar.gz",
      "-o",
      path.join(templateDir, "template.tgz"),
      ref,
    ],
    { stdio: "ignore" },
  );
  return templateDir;
}

// Run computeCliMode with console.warn captured so the stale-fallback notice
// does not litter test output; returns { mode, warnings }.
function run(opts) {
  const warnings = [];
  const original = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    return { mode: computeCliMode({ env: {}, ...opts }), warnings };
  } finally {
    console.warn = original;
  }
}

describe("readTarballCommitId", () => {
  it("reads the commit id git archive embedded in a tarball", () => {
    const { repoRoot, commit } = makeMonorepo();
    const head = commit();
    const templateDir = writeBundle(repoRoot, "HEAD");
    assert.equal(
      readTarballCommitId(path.join(templateDir, "template.tgz")),
      head,
    );
  });

  it("returns null for a missing file", () => {
    assert.equal(readTarballCommitId(path.join(tmp, "nope.tgz")), null);
  });

  it("returns null for a file that is not a git-archive tarball", () => {
    const p = path.join(tmp, "junk.tgz");
    fs.writeFileSync(p, "not a tarball");
    assert.equal(readTarballCommitId(p), null);
  });
});

describe("computeCliMode - explicit overrides", () => {
  it("MOBILE_SURFACES_CLI_MODE=live is honored when a monorepo exists", () => {
    const { repoRoot, commit } = makeMonorepo();
    commit();
    const { mode } = run({
      templateDir: path.join(tmp, "absent"),
      repoRoot,
      env: { MOBILE_SURFACES_CLI_MODE: "live" },
    });
    assert.equal(mode.kind, "live");
  });

  it("MOBILE_SURFACES_CLI_MODE=bundled is honored without a freshness check", () => {
    const { repoRoot, commit } = makeMonorepo();
    const old = commit();
    commit(); // HEAD has moved past the tarball, but bundled is forced.
    const templateDir = writeBundle(repoRoot, old);
    const { mode } = run({
      templateDir,
      repoRoot,
      env: { MOBILE_SURFACES_CLI_MODE: "bundled" },
    });
    assert.equal(mode.kind, "bundled");
  });

  it("rejects an unknown MOBILE_SURFACES_CLI_MODE value", () => {
    assert.throws(
      () =>
        computeCliMode({
          templateDir: tmp,
          repoRoot: tmp,
          env: { MOBILE_SURFACES_CLI_MODE: "sometimes" },
        }),
      /must be "live" or "bundled"/,
    );
  });
});

describe("computeCliMode - default probe", () => {
  it("uses live source when there is no bundled manifest", () => {
    const { repoRoot, commit } = makeMonorepo();
    commit();
    const { mode } = run({ templateDir: path.join(tmp, "absent"), repoRoot });
    assert.equal(mode.kind, "live");
  });

  it("uses the bundle when there is no monorepo to compare against", () => {
    // The published-package case: artifacts present, no live source.
    const { repoRoot, commit } = makeMonorepo();
    commit();
    const templateDir = writeBundle(repoRoot, "HEAD");
    const { mode } = run({
      templateDir,
      repoRoot: path.join(tmp, "no-monorepo-here"),
    });
    assert.equal(mode.kind, "bundled");
  });

  it("trusts a bundled tarball archived from the current HEAD", () => {
    const { repoRoot, commit } = makeMonorepo();
    commit();
    const templateDir = writeBundle(repoRoot, "HEAD");
    const { mode, warnings } = run({ templateDir, repoRoot });
    assert.equal(mode.kind, "bundled");
    assert.equal(warnings.length, 0);
  });

  // The A2 closure gate: a stale tarball (archived from an older commit) next
  // to a live monorepo must not shadow live source. The old existence-aware
  // probe returned "bundled" here; the freshness-aware probe returns "live".
  it("falls back to live source when the bundled tarball is stale", () => {
    const { repoRoot, commit } = makeMonorepo();
    const old = commit();
    const templateDir = writeBundle(repoRoot, old);
    commit(); // advance HEAD past the commit the tarball was archived from
    const { mode, warnings } = run({ templateDir, repoRoot });
    assert.equal(mode.kind, "live");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /stale template\.tgz/);
  });

  it("falls back to live source when the tarball commit id is unreadable", () => {
    const { repoRoot, commit } = makeMonorepo();
    commit();
    const templateDir = path.join(tmp, "template");
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, "manifest.json"), "{}\n");
    fs.writeFileSync(path.join(templateDir, "template.tgz"), "corrupt");
    const { mode, warnings } = run({ templateDir, repoRoot });
    assert.equal(mode.kind, "live");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Could not read a commit id/);
  });
});
