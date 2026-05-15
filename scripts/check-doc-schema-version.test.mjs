// End-to-end tests for scripts/check-doc-schema-version.mjs.
//
// The script greps .md files for `schemaVersion: "<n>"` literals that don't
// match the CANONICAL_SCHEMA_VERSION from scripts/lib/schema-url.mjs. We
// run it inside a temp workspace that contains just the structural minima
// it needs:
//   - scripts/lib/schema-url.mjs (so the script can import the canonical)
//   - scripts/lib/diagnostics.mjs (the report emitter the script depends on)
//   - scripts/check-doc-schema-version.mjs (a copy of the script under test)
//   - whatever .md files the case wants to exercise

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-doc-version-"));
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  cpSync(
    join(REPO_ROOT, "scripts", "check-doc-schema-version.mjs"),
    join(dir, "scripts", "check-doc-schema-version.mjs"),
  );
  cpSync(
    join(REPO_ROOT, "scripts", "lib", "schema-url.mjs"),
    join(dir, "scripts", "lib", "schema-url.mjs"),
  );
  cpSync(
    join(REPO_ROOT, "scripts", "lib", "diagnostics.mjs"),
    join(dir, "scripts", "lib", "diagnostics.mjs"),
  );
  // schema-url.mjs reads packages/surface-contracts/package.json; provide a
  // minimal stub so the import does not throw. We only need
  // CANONICAL_SCHEMA_VERSION, which is a constant, but readSurfaceContractsPackageJson
  // is called at import time only if a consumer touches it. Stub anyway to
  // be safe.
  mkdirSync(join(dir, "packages", "surface-contracts"), { recursive: true });
  writeFileSync(
    join(dir, "packages", "surface-contracts", "package.json"),
    JSON.stringify({ name: "@mobile-surfaces/surface-contracts", version: "5.0.0" }),
  );
  return dir;
}

function runCheck(cwd) {
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      "scripts/check-doc-schema-version.mjs",
    ],
    { cwd, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } },
  );
}

function writeMd(dir, rel, contents) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
}

test("baseline: canonical literal in a doc passes", () => {
  const ws = makeWorkspace();
  try {
    writeMd(ws, "docs/intro.md", '# Intro\n\nschemaVersion: "4" goes here.\n');
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /match "4"/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("flags a stale literal in a top-level README", () => {
  const ws = makeWorkspace();
  try {
    writeMd(ws, "README.md", 'see `schemaVersion: "3"` here.\n');
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /README\.md:1/);
    assert.match(r.stdout + r.stderr, /schemaVersion: "3" should be "4"/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("accepts both single and double quote styles", () => {
  const ws = makeWorkspace();
  try {
    writeMd(
      ws,
      "docs/quotes.md",
      "double: schemaVersion: \"4\"\nsingle: schemaVersion: '4'\n",
    );
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("flags both quote styles when stale", () => {
  const ws = makeWorkspace();
  try {
    writeMd(
      ws,
      "docs/quotes.md",
      "double: schemaVersion: \"2\"\nsingle: schemaVersion: '1'\n",
    );
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /schemaVersion: "2" should be "4"/);
    assert.match(r.stdout + r.stderr, /schemaVersion: "1" should be "4"/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("scans apps/site/ doc pages", () => {
  // apps/site/ used to be excluded because the docs/UX chat owned it on a
  // separate branch. It is in scope now; a stale literal under apps/site/
  // must be detected so the doc surface and the wire format cannot diverge.
  const ws = makeWorkspace();
  try {
    writeMd(
      ws,
      "apps/site/src/content/docs/architecture.md",
      'schemaVersion: "3"\n',
    );
    const r = runCheck(ws);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /schemaVersion: "3" should be "4"/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("excludes CHANGELOG.md (release notes are historical)", () => {
  const ws = makeWorkspace();
  try {
    writeMd(
      ws,
      "packages/surface-contracts/CHANGELOG.md",
      "## 3.0\n\n- v3 ships with schemaVersion: \"3\".\n",
    );
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("excludes notes/ (RFC/design notes reference historical versions)", () => {
  const ws = makeWorkspace();
  try {
    writeMd(
      ws,
      "notes/v2-schema-rfc.md",
      'RFC for `schemaVersion: "1"` to v2.\n',
    );
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("reports the line number of an offending literal", () => {
  const ws = makeWorkspace();
  try {
    writeMd(
      ws,
      "docs/lineref.md",
      "line 1\nline 2\nline 3 schemaVersion: \"2\"\nline 4\n",
    );
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /docs\/lineref\.md:3/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ignores non-md files even if they contain stale literals", () => {
  const ws = makeWorkspace();
  try {
    writeMd(ws, "docs/keeper.md", 'schemaVersion: "4"\n');
    writeFileSync(join(ws, "decoy.txt"), 'schemaVersion: "2"\n');
    writeFileSync(join(ws, "decoy.json"), '{"schemaVersion":"2"}\n');
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("skips node_modules, .git, and dist", () => {
  const ws = makeWorkspace();
  try {
    writeMd(ws, "node_modules/some-pkg/README.md", 'schemaVersion: "1"\n');
    writeMd(ws, ".git/notes.md", 'schemaVersion: "1"\n');
    writeMd(ws, "dist/index.md", 'schemaVersion: "1"\n');
    writeMd(ws, "docs/real.md", 'schemaVersion: "4"\n');
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
