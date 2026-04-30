#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
  },
});

const fixtureDir = path.resolve("data/surface-fixtures");
const indexPath = path.join(fixtureDir, "index.json");
const outputPath = path.resolve("packages/surface-contracts/src/fixtures.ts");
const entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));

const fixtures = Object.fromEntries(
  entries.map((entry) => {
    const filename = entry.replace(/^\.\//, "");
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, filename), "utf8"));
    // Strip $schema before generating the TS literal: it is JSON-only metadata
    // for IDE tooling and would not satisfy LiveSurfaceSnapshot (strict).
    delete fixture.$schema;
    return [toCamelKey(filename.replace(/\.json$/, "")), fixture];
  }),
);

const source = `import type { LiveSurfaceSnapshot } from "./index";

// Generated from data/surface-fixtures by scripts/generate-surface-fixtures.mjs.
// Edit the JSON fixtures, then run pnpm surface:check.
export const surfaceFixtureSnapshots = ${JSON.stringify(fixtures, null, 2)} as const satisfies Record<string, LiveSurfaceSnapshot>;
`;

if (values.check) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current !== source) {
    console.error(
      "packages/surface-contracts/src/fixtures.ts is out of sync with data/surface-fixtures.",
    );
    console.error("Run: node scripts/generate-surface-fixtures.mjs");
    process.exit(1);
  }
  console.log("Generated TS fixtures are in sync with JSON fixtures.");
} else {
  fs.writeFileSync(outputPath, source);
  console.log(`Wrote ${path.relative(process.cwd(), outputPath)}.`);
}

function toCamelKey(value) {
  return value.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}
