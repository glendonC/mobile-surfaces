// End-to-end tests for scripts/check-doc-links.mjs.
//
// The script validates internal links across the repo's markdown docs. We
// run it inside a temp workspace that contains just the structural minima
// it needs:
//   - scripts/check-doc-links.mjs (a copy of the script under test)
//   - scripts/lib/diagnostics.mjs (the report emitter the script depends on)
//   - data/traps.json (the source of live trap anchors)
//   - whatever markdown files the case wants to exercise
//
// The script discovers docs under apps/site/src/content/docs/, the root
// README.md / CONTRIBUTING.md, and packages/*/README.md, so cases write
// fixtures into those locations.

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

const DOCS_DIR = "apps/site/src/content/docs";

// A minimal traps.json: one live entry plus one deprecated id, so tests
// can assert both that live anchors resolve and deprecated ones do not.
const TRAPS_FIXTURE = {
  schemaVersion: "1",
  entries: [
    {
      id: "MS010",
      title: "Toolchain preflight (Node 24, pnpm, Xcode 26+)",
      severity: "warning",
      detection: "config",
      tags: ["toolchain"],
      summary: "x",
      symptom: "x",
      fix: "x",
      since: "1",
    },
    {
      id: "MS027",
      title: "Retired alias of MS012",
      severity: "error",
      detection: "config",
      tags: ["config"],
      summary: "x",
      symptom: "x",
      fix: "x",
      since: "1",
      deprecated: true,
    },
  ],
};

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-doc-links-"));
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  cpSync(
    join(REPO_ROOT, "scripts", "check-doc-links.mjs"),
    join(dir, "scripts", "check-doc-links.mjs"),
  );
  cpSync(
    join(REPO_ROOT, "scripts", "lib", "diagnostics.mjs"),
    join(dir, "scripts", "lib", "diagnostics.mjs"),
  );
  // diagnostics.mjs imports surface-contracts for best-effort schema
  // validation; when it can't resolve, it falls back gracefully. No stub
  // needed — the emit still works.
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(
    join(dir, "data", "traps.json"),
    JSON.stringify(TRAPS_FIXTURE, null, 2),
  );
  mkdirSync(join(dir, DOCS_DIR), { recursive: true });
  return dir;
}

function runCheck(cwd) {
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      "scripts/check-doc-links.mjs",
    ],
    { cwd, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } },
  );
}

function writeDoc(dir, slug, contents) {
  writeFileSync(join(dir, DOCS_DIR, `${slug}.md`), contents);
}

test("baseline: a doc with only valid links passes", () => {
  const ws = makeWorkspace();
  try {
    writeDoc(ws, "concepts", "# Concepts\n\n## Adapter contract\n\ntext.\n");
    writeDoc(
      ws,
      "quickstart",
      "# Quickstart\n\nSee [concepts](/docs/concepts#adapter-contract) and [trap](/traps#ms010-toolchain-preflight-node-24-pnpm-xcode-26).\n",
    );
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /All internal links/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("flags a /docs/ link to a non-existent slug", () => {
  const ws = makeWorkspace();
  try {
    writeDoc(ws, "quickstart", "# Quickstart\n\n[gone](/docs/nonexistent).\n");
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /quickstart\.md:3/);
    assert.match(r.stdout + r.stderr, /\/docs\/nonexistent matches no doc/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("flags a /docs/<slug>#frag with a heading that does not exist", () => {
  const ws = makeWorkspace();
  try {
    writeDoc(ws, "concepts", "# Concepts\n\n## Adapter contract\n");
    writeDoc(
      ws,
      "quickstart",
      "# Quickstart\n\n[bad](/docs/concepts#adapter-contrct).\n",
    );
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(
      r.stdout + r.stderr,
      /#adapter-contrct matches no heading in concepts\.md/,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("flags a /traps#frag that matches no live trap anchor", () => {
  // The truncated-anchor bug class: the heading slug is the full title,
  // not a shortened form.
  const ws = makeWorkspace();
  try {
    writeDoc(
      ws,
      "quickstart",
      "# Quickstart\n\n[trap](/traps#ms010-toolchain-preflight).\n",
    );
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(
      r.stdout + r.stderr,
      /\/traps#ms010-toolchain-preflight matches no live trap anchor/,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("flags a /traps#frag pointing at a deprecated trap id", () => {
  const ws = makeWorkspace();
  try {
    writeDoc(
      ws,
      "quickstart",
      "# Quickstart\n\n[retired](/traps#ms027-retired-alias-of-ms012).\n",
    );
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /matches no live trap anchor/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("accepts the bare /traps route without a fragment", () => {
  const ws = makeWorkspace();
  try {
    writeDoc(ws, "quickstart", "# Quickstart\n\n[catalog](/traps).\n");
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("flags an in-page anchor that matches no heading", () => {
  const ws = makeWorkspace();
  try {
    writeDoc(
      ws,
      "push",
      "# Push\n\n## Token taxonomy\n\nSee [below](#token-taxnomy).\n",
    );
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(
      r.stdout + r.stderr,
      /#token-taxnomy matches no heading in this file/,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("accepts an in-page anchor that matches a heading", () => {
  const ws = makeWorkspace();
  try {
    writeDoc(
      ws,
      "push",
      "# Push\n\n## Token taxonomy\n\nSee [below](#token-taxonomy).\n",
    );
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("flags a relative link to a missing file", () => {
  const ws = makeWorkspace();
  try {
    writeFileSync(
      join(ws, "README.md"),
      "# Repo\n\nSee [gone](./docs/nope.md).\n",
    );
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(
      r.stdout + r.stderr,
      /relative link \.\/docs\/nope\.md resolves to a missing file/,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("accepts a relative link to an existing file", () => {
  const ws = makeWorkspace();
  try {
    writeFileSync(join(ws, "LICENSE"), "MIT\n");
    writeFileSync(join(ws, "README.md"), "# Repo\n\n[license](./LICENSE).\n");
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("validates a #frag on a relative markdown target", () => {
  const ws = makeWorkspace();
  try {
    mkdirSync(join(ws, "packages", "push"), { recursive: true });
    writeFileSync(
      join(ws, "packages", "push", "README.md"),
      "# Push pkg\n\n[contract](../surface-contracts/README.md#wire-format).\n",
    );
    mkdirSync(join(ws, "packages", "surface-contracts"), { recursive: true });
    writeFileSync(
      join(ws, "packages", "surface-contracts", "README.md"),
      "# Contracts\n\n## Other heading\n",
    );
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(
      r.stdout + r.stderr,
      /#wire-format matches no heading in \.\.\/surface-contracts\/README\.md/,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ignores external http(s) and mailto links", () => {
  const ws = makeWorkspace();
  try {
    writeDoc(
      ws,
      "quickstart",
      "# Quickstart\n\n[site](https://example.com/anything) and [mail](mailto:x@y.z).\n",
    );
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ignores links inside fenced code blocks", () => {
  const ws = makeWorkspace();
  try {
    writeDoc(
      ws,
      "quickstart",
      "# Quickstart\n\n```\n[fake](/docs/does-not-exist)\n```\n",
    );
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("does not treat a # line inside a code fence as a heading", () => {
  const ws = makeWorkspace();
  try {
    writeDoc(
      ws,
      "quickstart",
      "# Quickstart\n\n```bash\n# Not a heading\n```\n\n[anchor](#not-a-heading).\n",
    );
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /#not-a-heading matches no heading/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("strips inline markdown from headings before slugifying", () => {
  const ws = makeWorkspace();
  try {
    writeDoc(
      ws,
      "schema",
      "# Schema\n\n## The `wire` shape\n\n[here](#the-wire-shape).\n",
    );
    const r = runCheck(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("reports the line number of an offending link", () => {
  const ws = makeWorkspace();
  try {
    writeDoc(
      ws,
      "quickstart",
      "# Quickstart\n\nline 3\nline 4\n[bad](/docs/missing) on line 5\n",
    );
    const r = runCheck(ws);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /quickstart\.md:5/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
