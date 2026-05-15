#!/usr/bin/env node
// Asserts the published JSON Schema (packages/surface-contracts/schema.json)
// and the Zod source (packages/surface-contracts/src/schema.ts) agree on
// every committed fixture, both positive and negative. Non-TS consumers
// pin the unpkg URL by major.minor and validate with Ajv (or another
// JSON-Schema validator); without this gate the two validators could
// silently drift — Ajv accepting payloads the Zod runtime rejects, or
// vice versa.
//
// Three checks:
//   - schema-loads: the committed schema.json compiles cleanly under Ajv
//     2020-12 with ajv-formats. Catches a malformed generator output that
//     would otherwise fail only inside consumer code.
//   - positive-parity: every fixture under data/surface-fixtures/ validates
//     under both Ajv and Zod (after stripping the editor-tooling $schema
//     key). A disagreement means the published artifact drifted from the
//     Zod source.
//   - negative-parity: every fixture under data/surface-fixtures-negative/
//     is REJECTED by both validators. Pins the rejection contract: if a
//     future schema change accidentally widens the JSON Schema while
//     keeping the Zod schema strict, this gate fails.
//
// Ajv is in `strict: false` mode because Zod 4's z.toJSONSchema emits
// draft-2020-12 keywords (`unevaluatedProperties`, `$dynamicAnchor`) that
// Ajv-strict treats as not-yet-supported. The trade-off is documented; a
// future Ajv version may allow strict mode and we can flip the flag back.

import { readdirSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { liveSurfaceSnapshot } from "../packages/surface-contracts/src/schema.ts";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = resolve(
  REPO_ROOT,
  "packages/surface-contracts/schema.json",
);
const POSITIVE_DIR = resolve(REPO_ROOT, "data/surface-fixtures");
const NEGATIVE_DIR = resolve(REPO_ROOT, "data/surface-fixtures-negative");

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const checks = [];

// 1. Compile the published JSON Schema under Ajv. Anything broken here is
//    a generator bug; surface it as a single fail with the Ajv error.
const schemaJson = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
let ajvValidate;
try {
  // Allow draft-2020-12 idioms emitted by Zod's z.toJSONSchema. `strict:
  // false` keeps Ajv from rejecting `unevaluatedProperties` and the
  // discriminator's `const`-based oneOf wrapping. The trade-off is small
  // and documented; the parity checks below catch any real misalignment.
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats.default ? addFormats.default(ajv) : addFormats(ajv);
  ajvValidate = ajv.compile(schemaJson);
  checks.push({
    id: "schema-loads",
    status: "ok",
    summary: `Ajv compiled ${SCHEMA_PATH.replace(REPO_ROOT + "/", "")} cleanly under draft-2020-12.`,
  });
} catch (err) {
  checks.push({
    id: "schema-loads",
    status: "fail",
    summary: "Ajv could not compile the committed JSON Schema.",
    detail: { message: String(err?.message ?? err) },
  });
  emitDiagnosticReport(buildReport("check-ajv-zod-parity", checks), {
    json: values.json,
  });
  process.exit(0); // emitDiagnosticReport exits on fail
}

function stripEditorTooling(raw) {
  // Both fixture roots carry an editor-tooling `$schema` pointer. The
  // wire payload never carries one, so strip it before either validator
  // sees the fixture. (validate-surface-fixtures.mjs does the same.)
  const { $schema, ...rest } = raw;
  return rest;
}

function loadFixturesFromIndex(dir) {
  const indexPath = join(dir, "index.json");
  const indexRaw = JSON.parse(readFileSync(indexPath, "utf8"));
  const entries = Array.isArray(indexRaw)
    ? indexRaw
    : Array.isArray(indexRaw?.fixtures)
      ? indexRaw.fixtures
      : null;
  if (!entries) {
    throw new Error(
      `${dir}/index.json must be a JSON array of filenames or {"fixtures": [...]} `,
    );
  }
  return entries.map((rel) => {
    const file = resolve(dir, rel.replace(/^\.\//, ""));
    return { relPath: rel.replace(/^\.\//, ""), file };
  });
}

// 2. Positive parity: every committed fixture must validate under both.
{
  const issues = [];
  const fixtures = loadFixturesFromIndex(POSITIVE_DIR);
  for (const { relPath, file } of fixtures) {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const payload = stripEditorTooling(raw);
    const ajvOk = ajvValidate(payload);
    const zodResult = liveSurfaceSnapshot.safeParse(payload);
    if (ajvOk && zodResult.success) continue;
    if (!ajvOk && !zodResult.success) {
      // Both rejected what the project considers a valid fixture: the
      // fixture itself is broken. validate-surface-fixtures.mjs is the
      // canonical gate for "fixture vs Zod"; we just surface the dual
      // disagreement so the operator knows where to look.
      issues.push({
        path: relPath,
        message:
          "Both Ajv and Zod rejected a positive fixture; run validate-surface-fixtures for the Zod issue trail.",
      });
      continue;
    }
    if (!ajvOk) {
      const ajvErrors = (ajvValidate.errors ?? [])
        .slice(0, 3)
        .map((e) => `${e.instancePath || "<root>"}: ${e.message}`)
        .join("; ");
      issues.push({
        path: relPath,
        message: `Ajv rejected (Zod accepted): ${ajvErrors || "no errors reported"}`,
      });
    } else if (!zodResult.success) {
      const zodErrors = zodResult.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      issues.push({
        path: relPath,
        message: `Zod rejected (Ajv accepted): ${zodErrors}`,
      });
    }
  }
  checks.push({
    id: "positive-parity",
    status: issues.length === 0 ? "ok" : "fail",
    summary:
      issues.length === 0
        ? `${fixtures.length} fixtures validated under both Ajv and Zod.`
        : `${issues.length} fixture(s) disagree between Ajv and Zod.`,
    ...(issues.length === 0 ? {} : { detail: { issues } }),
  });
}

// 3. Negative parity: every intentionally-invalid fixture must be rejected
//    by BOTH validators. An asymmetric rejection means the schemas have
//    drifted on what counts as invalid.
{
  const issues = [];
  const fixtures = loadFixturesFromIndex(NEGATIVE_DIR);
  for (const { relPath, file } of fixtures) {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const payload = stripEditorTooling(raw);
    const ajvOk = ajvValidate(payload);
    const zodResult = liveSurfaceSnapshot.safeParse(payload);
    if (!ajvOk && !zodResult.success) continue; // Both rejected. Good.
    if (ajvOk && zodResult.success) {
      issues.push({
        path: relPath,
        message:
          "Both validators ACCEPTED an intentionally-invalid fixture; the rejection contract has drifted.",
      });
      continue;
    }
    if (ajvOk) {
      issues.push({
        path: relPath,
        message:
          "Ajv accepted an invalid fixture that Zod correctly rejected; the JSON Schema is too permissive.",
      });
    } else {
      issues.push({
        path: relPath,
        message:
          "Zod accepted an invalid fixture that Ajv correctly rejected; the Zod source is too permissive.",
      });
    }
  }
  checks.push({
    id: "negative-parity",
    status: issues.length === 0 ? "ok" : "fail",
    summary:
      issues.length === 0
        ? `${fixtures.length} negative fixture(s) rejected by both Ajv and Zod.`
        : `${issues.length} negative fixture(s) drift between the two validators.`,
    ...(issues.length === 0 ? {} : { detail: { issues } }),
  });
}

emitDiagnosticReport(buildReport("check-ajv-zod-parity", checks), {
  json: values.json,
});
