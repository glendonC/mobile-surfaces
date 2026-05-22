#!/usr/bin/env node
// Generates packages/surface-contracts/schema.json from the Zod source of truth
// in packages/surface-contracts/src/schema.ts. Runs under Node's
// --experimental-strip-types so it can import the .ts file directly without a
// build step. Pass --check to verify the committed schema.json matches the
// generator output (CI guard against drift).
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { liveSurfaceSnapshot } from "../packages/surface-contracts/src/schema.ts";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import { canonicalSchemaUrl } from "./lib/schema-url.mjs";

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const TOOL = "build-schema";
const schema = z.toJSONSchema(liveSurfaceSnapshot, { target: "draft-2020-12" });
const schemaUrl = canonicalSchemaUrl();
if (schemaUrl) schema.$id = schemaUrl;
schema.title = "LiveSurfaceSnapshot";

// z.toJSONSchema emits the discriminated union as a bare `oneOf` of
// const-discriminated branches. A pure JSON Schema validator (Ajv) handles
// that fine, but OpenAPI tooling reports a generic "matched 0 schemas" on a
// bad payload instead of pointing at the offending branch. The OpenAPI 3.x
// `discriminator` object fixes that: it names the property a consumer should
// branch on (`kind`). It is an OpenAPI extension keyword, not part of
// draft-2020-12 — but draft-2020-12 ignores unknown keywords, so this stays a
// valid 2020-12 schema; only discriminator-aware tooling reads it. Sound only
// because `kind` is a required const in every `oneOf` branch (the contract is
// a Zod discriminatedUnion on `kind`); the assertion below pins that.
if (Array.isArray(schema.oneOf)) {
  for (const branch of schema.oneOf) {
    const isDiscriminated =
      branch?.properties?.kind?.const !== undefined &&
      Array.isArray(branch.required) &&
      branch.required.includes("kind");
    if (!isDiscriminated) {
      throw new Error(
        "build-schema: a oneOf branch is missing a required `kind` const; " +
          "cannot attach an OpenAPI discriminator. Did the union stop " +
          "discriminating on `kind`?",
      );
    }
  }
  schema.discriminator = { propertyName: "kind" };
}

const out = JSON.stringify(schema, null, 2) + "\n";
const target = resolve("packages/surface-contracts/schema.json");

if (values.check) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  const inSync = current === out;
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "schema-sync",
        status: inSync ? "ok" : "fail",
        summary: inSync
          ? "JSON Schema is in sync with Zod source."
          : "packages/surface-contracts/schema.json is out of sync.",
        trapId: "MS006",
        ...(inSync
          ? {}
          : {
              detail: {
                message:
                  "Run: node --experimental-strip-types scripts/build-schema.mjs",
              },
            }),
      },
    ]),
    { json: values.json },
  );
} else {
  writeFileSync(target, out);
  if (values.json) {
    emitDiagnosticReport(
      buildReport(TOOL, [
        {
          id: "schema-write",
          status: "ok",
          summary: "Wrote packages/surface-contracts/schema.json.",
        },
      ]),
      { json: true },
    );
  } else {
    console.log("Wrote packages/surface-contracts/schema.json.");
  }
}
