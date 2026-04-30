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

const { values } = parseArgs({
  options: { check: { type: "boolean", default: false } },
});

const schema = z.toJSONSchema(liveSurfaceSnapshot, { target: "draft-2020-12" });
schema.$id = "https://unpkg.com/@mobile-surfaces/surface-contracts@0/schema.json";
schema.title = "LiveSurfaceSnapshot";

const out = JSON.stringify(schema, null, 2) + "\n";
const target = resolve("packages/surface-contracts/schema.json");

if (values.check) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (current !== out) {
    console.error("packages/surface-contracts/schema.json is out of sync.");
    console.error("Run: node --experimental-strip-types scripts/build-schema.mjs");
    process.exit(1);
  }
  console.log("JSON Schema is in sync with Zod source.");
} else {
  writeFileSync(target, out);
  console.log("Wrote packages/surface-contracts/schema.json.");
}
