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

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const TOOL = "build-schema";
const schema = z.toJSONSchema(liveSurfaceSnapshot, { target: "draft-2020-12" });
// Pin $id to major.minor so a future minor that adds a discriminated-union
// variant can ship a new schema URL without yanking what consumers already
// reference. Forks (any package name other than the upstream) get no $id —
// otherwise the URL would point at a tarball that isn't published.
const surfaceContractsPkg = JSON.parse(
  readFileSync(resolve("packages/surface-contracts/package.json"), "utf8"),
);
if (surfaceContractsPkg.name === "@mobile-surfaces/surface-contracts") {
  schema.$id = "https://unpkg.com/@mobile-surfaces/surface-contracts@1.2/schema.json";
}
schema.title = "LiveSurfaceSnapshot";

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
