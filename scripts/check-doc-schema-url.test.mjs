// End-to-end tests for scripts/check-doc-schema-url.mjs.
//
// The script greps .md files for `@<version>/schema.json` URLs whose major
// segment is not the canonical surface-contracts package major. It runs
// inside a temp workspace holding just the minima the script imports:
//   - scripts/check-doc-schema-url.mjs (the script under test)
//   - scripts/lib/schema-url.mjs       (canonicalSchemaUrl source)
//   - scripts/lib/diagnostics.mjs      (the report emitter)
//   - a stub packages/surface-contracts/package.json + src/version.ts
//
// The stub package.json is pinned to 9.0.0, so the canonical major is 9.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-doc-url-"));
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  cpSync(
    join(REPO_ROOT, "scripts", "check-doc-schema-url.mjs"),
    join(dir, "scripts", "check-doc-schema-url.mjs"),
  );
  cpSync(
    join(REPO_ROOT, "scripts", "lib", "schema-url.mjs"),
    join(dir, "scripts", "lib", "schema-url.mjs"),
  );
  cpSync(
    join(REPO_ROOT, "scripts", "lib", "diagnostics.mjs"),
    join(dir, "scripts", "lib", "diagnostics.mjs"),
  );
  mkdirSync(join(dir, "packages", "surface-contracts", "src"), {
    recursive: true,
  });
  writeFileSync(
    join(dir, "packages", "surface-contracts", "package.json"),
    JSON.stringify({
      name: "@mobile-surfaces/surface-contracts",
      version: "9.0.0",
    }),
  );
  cpSync(
    join(REPO_ROOT, "packages", "surface-contracts", "src", "version.ts"),
    join(dir, "packages", "surface-contracts", "src", "version.ts"),
  );
  return dir;
}

function runCheck(cwd) {
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      "scripts/check-doc-schema-url.mjs",
    ],
    { cwd, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } },
  );
}

function writeMd(dir, rel, contents) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
}

const FULL = "https://unpkg.com/@mobile-surfaces/surface-contracts";

test("baseline: a canonical schema URL passes", () => {
  const ws = makeWorkspace();
  try {
    writeMd(ws, "docs/intro.md", `See ${FULL}@9.0/schema.json for the schema.\n`);
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /match canonical major 9/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("flags a stale older major in prose", () => {
  const ws = makeWorkspace();
  try {
    writeMd(ws, "README.md", `The schema is at ${FULL}@7.0/schema.json today.\n`);
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /README\.md:1/);
    assert.match(r.stdout + r.stderr, /stale schema URL major @7\.0/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("flags the abbreviated `@<version>/schema.json` shorthand too", () => {
  const ws = makeWorkspace();
  try {
    writeMd(ws, "docs/pin.md", "Pin to `@8/schema.json` for the latest.\n");
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /stale schema URL major @8/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("flags a major newer than canonical anywhere, including a table row", () => {
  const ws = makeWorkspace();
  try {
    writeMd(ws, "docs/future.md", `| old | ${FULL}@12.0/schema.json |\n`);
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /newer than the canonical major 9/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("allows an older major inside a markdown table row", () => {
  // before/after migration tables cite past majors on purpose.
  const ws = makeWorkspace();
  try {
    writeMd(
      ws,
      "docs/migrate.md",
      `| \`$id\` | ${FULL}@5.0/schema.json | ${FULL}@9.0/schema.json |\n`,
    );
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("allows a non-numeric placeholder major", () => {
  const ws = makeWorkspace();
  try {
    writeMd(
      ws,
      "docs/policy.md",
      "A new kind publishes at `@9.N/schema.json`; pin `@9/schema.json` to float.\n",
    );
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("excludes notes/ and CHANGELOG.md", () => {
  const ws = makeWorkspace();
  try {
    writeMd(ws, "notes/rfc.md", `old: ${FULL}@4.0/schema.json\n`);
    writeMd(ws, "packages/x/CHANGELOG.md", `5.0: ${FULL}@5.0/schema.json\n`);
    writeMd(ws, "docs/ok.md", `${FULL}@9.0/schema.json\n`);
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("reports the line number of an offending URL", () => {
  const ws = makeWorkspace();
  try {
    writeMd(
      ws,
      "docs/lineref.md",
      `line 1\nline 2\nstale ${FULL}@6.0/schema.json here\n`,
    );
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /docs\/lineref\.md:3/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("does not match @scope/schema.json package-style paths", () => {
  const ws = makeWorkspace();
  try {
    writeMd(ws, "docs/scope.md", "import from `@acme/schema.json` somewhere.\n");
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
