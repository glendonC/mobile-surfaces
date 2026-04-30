#!/usr/bin/env node
// Validates every JSON fixture under data/surface-fixtures against the Zod
// liveSurfaceSnapshot. The shared schema is the single source of truth for both
// the published JSON Schema and runtime parsing. Fixtures carry a $schema
// pointer for IDE tooling; we strip it before parsing because the wire payload
// itself does not carry $schema.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { liveSurfaceSnapshot } from "../packages/surface-contracts/src/schema.ts";

const fixtureDir = resolve("data/surface-fixtures");
const indexPath = join(fixtureDir, "index.json");
const entries = JSON.parse(readFileSync(indexPath, "utf8"));

let failed = 0;

for (const entry of entries) {
  const filename = entry.replace(/^\.\//, "");
  const file = resolve(fixtureDir, filename);
  const fixture = JSON.parse(readFileSync(file, "utf8"));
  const { $schema: _ignored, ...rest } = fixture;
  const result = liveSurfaceSnapshot.safeParse(rest);
  if (!result.success) {
    failed += 1;
    console.error(`✗ ${filename}`);
    for (const issue of result.error.issues) {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      console.error(`  ${path}: ${issue.message}`);
    }
  }
}

const onDisk = readdirSync(fixtureDir).filter(
  (f) => f.endsWith(".json") && f !== "index.json",
);
const indexed = new Set(entries.map((e) => e.replace(/^\.\//, "")));
for (const f of onDisk) {
  if (!indexed.has(f)) {
    failed += 1;
    console.error(`✗ ${f}: present on disk but missing from index.json`);
  }
}

if (failed > 0) {
  process.exit(1);
}
console.log(`Validated ${entries.length} surface fixtures.`);
