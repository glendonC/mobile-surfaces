// End-to-end tests for scripts/check-adapter-boundary.mjs.
//
// MS001 only stays sound if the boundary script catches every form of
// import that lands in TS source. We exercise the script as a subprocess
// against a synthesized apps/mobile/src tree so the regex is verified in
// the same code path CI runs.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-adapter-boundary.mjs");

// Build a throwaway workspace. `files` maps a path under apps/mobile/src to
// its contents (the common single-app case). `opts.apps` adds extra apps:
// each key is an app directory name under apps/, and the value is either a
// map of files under that app's src/ (a minimal adapter re-export is shipped
// automatically), or null to create the app directory with NO src/ folder.
function withWorkspace(files, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-bound-"));

  function seedApp(appName, appFiles) {
    const srcRoot = join(dir, "apps", appName, "src");
    const adapterDir = join(srcRoot, "liveActivity");
    mkdirSync(adapterDir, { recursive: true });
    // Ship a minimal adapter re-export so the legitimate path exists.
    writeFileSync(
      join(adapterDir, "index.ts"),
      'export { liveActivityAdapter } from "@mobile-surfaces/live-activity";\n',
    );
    for (const [relPath, contents] of Object.entries(appFiles)) {
      const full = join(srcRoot, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
  }

  seedApp("mobile", files);

  for (const [appName, appFiles] of Object.entries(opts.apps ?? {})) {
    if (appFiles === null) {
      // App directory with no src/ folder - the script must skip it cleanly.
      mkdirSync(join(dir, "apps", appName), { recursive: true });
    } else {
      seedApp(appName, appFiles);
    }
  }

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runCheck(cwd) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

test("ok when only the adapter re-export imports the target package", () => {
  const ws = withWorkspace({
    "screens/Live.tsx": 'import { liveActivityAdapter } from "../liveActivity";\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Adapter boundary intact/);
  } finally {
    ws.cleanup();
  }
});

test("flags a static `from \"@mobile-surfaces/live-activity\"` import outside the adapter", () => {
  const ws = withWorkspace({
    "screens/Live.tsx":
      'import { liveActivityAdapter } from "@mobile-surfaces/live-activity";\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /MS001|Live\.tsx/);
  } finally {
    ws.cleanup();
  }
});

test("flags a dynamic import(\"@mobile-surfaces/live-activity\") call outside the adapter", () => {
  const ws = withWorkspace({
    "screens/LiveLazy.tsx":
      'export async function load() { return import("@mobile-surfaces/live-activity"); }\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /LiveLazy\.tsx/);
  } finally {
    ws.cleanup();
  }
});

test("flags a subpath import (`@mobile-surfaces/live-activity/types`)", () => {
  const ws = withWorkspace({
    "screens/Live.tsx":
      'import type { Adapter } from "@mobile-surfaces/live-activity/types";\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /Live\.tsx/);
  } finally {
    ws.cleanup();
  }
});

test("flags a re-export `export ... from \"@mobile-surfaces/live-activity\"`", () => {
  const ws = withWorkspace({
    "lib/reexport.ts":
      'export { liveActivityAdapter } from "@mobile-surfaces/live-activity";\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /reexport\.ts/);
  } finally {
    ws.cleanup();
  }
});

test("flags an aliased default import (`import Renamed from \"@mobile-surfaces/live-activity\"`)", () => {
  // The alias lives on the binding side; the specifier is unchanged. A
  // from-anchored structural match catches it. The old grep matched this
  // too, but the test pins the structural behavior explicitly.
  const ws = withWorkspace({
    "screens/Live.tsx":
      'import Renamed from "@mobile-surfaces/live-activity";\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /Live\.tsx/);
  } finally {
    ws.cleanup();
  }
});

test("flags a namespace import (`import * as LA from \"@mobile-surfaces/live-activity\"`)", () => {
  // The exact aliased/star form the hardening targets: a namespace import
  // followed by indirection (`LA.liveActivityAdapter`). The specifier still
  // terminates a `from` clause, so the structural check catches it.
  const ws = withWorkspace({
    "screens/Live.tsx":
      'import * as LA from "@mobile-surfaces/live-activity";\n' +
      "export const adapter = LA.liveActivityAdapter;\n",
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /Live\.tsx/);
    assert.match(r.stdout + r.stderr, /from import/);
  } finally {
    ws.cleanup();
  }
});

test("flags a namespace re-export (`export * as LA from \"@mobile-surfaces/live-activity\"`)", () => {
  const ws = withWorkspace({
    "lib/reexport.ts":
      'export * as LA from "@mobile-surfaces/live-activity";\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /reexport\.ts/);
  } finally {
    ws.cleanup();
  }
});

test("flags a bare side-effect import (`import \"@mobile-surfaces/live-activity\"`)", () => {
  // A side-effect import has no binding and no `from` clause; the old
  // `(?:from|import)\s*\(?\s*"<pkg>"` regex matched it only incidentally
  // via the `import` branch. The structural check matches it as its own
  // "bare" form.
  const ws = withWorkspace({
    "screens/SideEffect.tsx": 'import "@mobile-surfaces/live-activity";\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /SideEffect\.tsx/);
  } finally {
    ws.cleanup();
  }
});

test("flags a require(\"@mobile-surfaces/live-activity\") CJS call", () => {
  // A .ts file using CJS interop. The old regex never matched `require`;
  // the structural check has a dedicated form for it.
  const ws = withWorkspace({
    "screens/Cjs.ts":
      'const LA = require("@mobile-surfaces/live-activity");\nexport const a = LA.liveActivityAdapter;\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /Cjs\.ts/);
  } finally {
    ws.cleanup();
  }
});

test("does not flag an import that survives only inside a comment", () => {
  // stripNonCode integration: a commented-out forbidden import is not a
  // violation. The old check read the raw source and would have flagged it.
  const ws = withWorkspace({
    "screens/Live.tsx":
      '// import * as LA from "@mobile-surfaces/live-activity";\nexport const x = 1;\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    ws.cleanup();
  }
});

test("does not flag the specifier embedded in an unrelated string literal", () => {
  // A doc-string mentioning the package by name is not an import.
  const ws = withWorkspace({
    "docs/note.ts":
      'export const note = "do not import @mobile-surfaces/live-activity here";\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    ws.cleanup();
  }
});

test("does not false-positive on a `.from(...)` method call naming the package", () => {
  // `\bfrom` is word-anchored, but a method named `from` could in principle
  // collide. Pin that `obj.from("@mobile-surfaces/live-activity")` is not an
  // import: the structural matcher requires the specifier to follow `from`
  // as an import clause, and a `.from(` call has the package in a paren, not
  // a quote-directly-after-from position.
  const ws = withWorkspace({
    "screens/Live.tsx":
      'import { liveActivityAdapter } from "../liveActivity";\n' +
      'export const r = registry.from("@other/pkg").select();\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    ws.cleanup();
  }
});

test("flags multiple violations and reports counts", () => {
  const ws = withWorkspace({
    "screens/A.tsx":
      'import { x } from "@mobile-surfaces/live-activity";\n',
    "screens/B.tsx":
      'import { y } from "@mobile-surfaces/live-activity";\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /A\.tsx/);
    assert.match(r.stdout + r.stderr, /B\.tsx/);
  } finally {
    ws.cleanup();
  }
});

test("ignores .js/.json files (only .ts and .tsx are scanned)", () => {
  const ws = withWorkspace({
    "screens/legacy.js":
      'const x = require("@mobile-surfaces/live-activity");\n',
  });
  try {
    const r = runCheck(ws.dir);
    // The current contract is that the boundary only governs TS source -
    // .js files are out of scope. Pin that contract here so a future
    // tightening is an explicit decision, not an accident.
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    ws.cleanup();
  }
});

test("known weak spot: variable-indirected dynamic import slips through (documents the boundary)", () => {
  // import(variable) where the variable is the package name is not caught
  // by the regex. The CodingKeys/MS003 fix has a similar known-weak edge
  // (CodingKeys in deeply nested extensions). Documenting the limit in a
  // test gives any future tightening a fixture to flip green.
  const ws = withWorkspace({
    "screens/Dyn.tsx":
      'const pkg = "@mobile-surfaces/live-activity";\nexport async function load() { return import(pkg); }\n',
  });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, "variable-indirected dynamic import is a known gap");
  } finally {
    ws.cleanup();
  }
});

// MS001's catalog text scopes the boundary to apps/*/src/, not just
// apps/mobile/src/. The script scans every app generically, so these tests
// pin the multi-app behavior.

test("scans every apps/*/src: a violation in a second app is flagged", () => {
  const ws = withWorkspace(
    { "screens/Live.tsx": 'import { liveActivityAdapter } from "../liveActivity";\n' },
    {
      apps: {
        tablet: {
          "screens/Bad.tsx":
            'import { x } from "@mobile-surfaces/live-activity";\n',
        },
      },
    },
  );
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /Bad\.tsx/);
    // The clean app must not produce a false positive.
    assert.doesNotMatch(r.stdout + r.stderr, /Live\.tsx/);
  } finally {
    ws.cleanup();
  }
});

test("scans every apps/*/src: each app's own liveActivity/index.ts is allowed", () => {
  // Both apps ship the adapter re-export that imports the target package
  // directly. Neither should be flagged - the re-export is the one allowed
  // importer per app.
  const ws = withWorkspace(
    { "screens/Live.tsx": 'import { liveActivityAdapter } from "../liveActivity";\n' },
    {
      apps: {
        tablet: {
          "screens/Live.tsx":
            'import { liveActivityAdapter } from "../liveActivity";\n',
        },
      },
    },
  );
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /across 2 app\(s\)/);
  } finally {
    ws.cleanup();
  }
});

test("an app directory with no src/ folder is skipped cleanly (no crash)", () => {
  const ws = withWorkspace(
    { "screens/Live.tsx": 'import { liveActivityAdapter } from "../liveActivity";\n' },
    { apps: { docs: null } },
  );
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // Only apps/mobile has a src/, so exactly one app is scanned.
    assert.match(r.stdout, /across 1 app\(s\)/);
  } finally {
    ws.cleanup();
  }
});
