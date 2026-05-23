// End-to-end tests for scripts/check-projection-envelope-version.mjs (MS041).
//
// The earlier shape of this check used a non-greedy regex
// (`z.object({...}).strict()`) that terminated at the first nested
// `})\s*.strict()`. For schemas where a sibling field carries its own nested
// `.strict()` (the notification ContentPayload is the live example), the
// captured body ended early and a legitimately-declared schemaVersion that
// happened to sit AFTER the nested sibling looked missing to the check.
// L6 from notes/path-to-10.v10.md replaces the regex with a brace-balanced
// extractor; these fixtures pin the legal-reorder case.
//
// Each fixture is a synthesized schema.ts written into a tmpdir; the script
// runs as a subprocess against that cwd, the same code path CI runs.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-projection-envelope-version.mjs");

function writeSchema(source) {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-envelope-version-"));
  const srcDir = join(dir, "packages", "surface-contracts", "src");
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, "schema.ts"), source);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runCheck(cwd) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

// A canonical, schemaVersion-first projection-output schema. Every helper
// fixture below starts from this and applies one mutation so the test cannot
// drift from the real declaration shape.
const CANONICAL = `
import { z } from "zod";
import { SCHEMA_VERSION } from "./version.ts";

export const liveSurfaceFooContentPayload = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    aps: z
      .object({
        alert: z.object({ title: z.string() }).strict(),
        sound: z.literal("default"),
      })
      .strict(),
    liveSurface: z.object({ surfaceId: z.string() }).strict(),
  })
  .strict();
`;

test("canonical projection-output schema passes", () => {
  const ws = writeSchema(CANONICAL);
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    ws.cleanup();
  }
});

test("L6: schemaVersion after a nested .strict() sibling is recognized", () => {
  // schemaVersion sits AFTER aps. aps carries its own nested .strict(). The
  // prior non-greedy regex truncated the captured body at aps's first inner
  // .strict() (alert's), so schemaVersion looked missing and the check
  // false-failed even though the schema is correct. The balanced extractor
  // must see the real outer body and find schemaVersion at its actual
  // depth-0 position.
  const reordered = `
import { z } from "zod";
import { SCHEMA_VERSION } from "./version.ts";

export const liveSurfaceFooContentPayload = z
  .object({
    aps: z
      .object({
        alert: z.object({ title: z.string() }).strict(),
        sound: z.literal("default"),
      })
      .strict(),
    schemaVersion: z.literal(SCHEMA_VERSION),
    liveSurface: z.object({ surfaceId: z.string() }).strict(),
  })
  .strict();
`;
  const ws = writeSchema(reordered);
  try {
    const r = runCheck(ws.dir);
    assert.equal(
      r.status,
      0,
      "reordered schema is correct; check must not false-fail. Output:\n" +
        r.stdout +
        r.stderr,
    );
  } finally {
    ws.cleanup();
  }
});

test("genuinely missing schemaVersion fails the check", () => {
  // Both legacy and balanced extractors should catch this. Pinning it keeps
  // the rewrite from buying false-positive elimination at the cost of
  // letting real omissions through.
  const missing = `
import { z } from "zod";
import { SCHEMA_VERSION } from "./version.ts";

export const liveSurfaceFooContentPayload = z
  .object({
    aps: z
      .object({
        alert: z.object({ title: z.string() }).strict(),
      })
      .strict(),
    liveSurface: z.object({ surfaceId: z.string() }).strict(),
  })
  .strict();
`;
  const ws = writeSchema(missing);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, "missing schemaVersion must fail");
    assert.match(
      r.stdout + r.stderr,
      /schemaVersion/,
      "error must name schemaVersion",
    );
  } finally {
    ws.cleanup();
  }
});

test("schemaVersion declared with a wrong literal fails the check", () => {
  // The value must be z.literal(SCHEMA_VERSION); a hand-typed string literal
  // bypasses the single-constant invariant and is exactly what the gate
  // exists to prevent.
  const handTyped = `
import { z } from "zod";
import { SCHEMA_VERSION } from "./version.ts";

export const liveSurfaceFooContentPayload = z
  .object({
    schemaVersion: z.literal("5"),
    aps: z.object({ alert: z.string() }).strict(),
  })
  .strict();
`;
  const ws = writeSchema(handTyped);
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, "hand-typed literal must fail");
    assert.match(r.stdout + r.stderr, /SCHEMA_VERSION/);
  } finally {
    ws.cleanup();
  }
});
