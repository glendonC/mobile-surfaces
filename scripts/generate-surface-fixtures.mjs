#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

// Convert a fixture source filename (no extension) into the camelCase key used
// in the generated TS export. Note that hyphenated and already-camelCased
// inputs can collapse to the same key (e.g. "active-progress" and
// "activeProgress" both map to "activeProgress"); detectCollisions surfaces
// that as an error so two source files cannot silently shadow each other.
export function toCamelKey(value) {
  return value.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

// Given fixture source filenames (with or without `.json`), return the list of
// colliding pairs as `{ key, files: [a, b] }`. Files are reported in input
// order so the error message names which file shadowed which.
export function detectCollisions(filenames) {
  const seen = new Map();
  const collisions = [];
  for (const raw of filenames) {
    const filename = raw.replace(/^\.\//, "").replace(/\.json$/, "");
    const key = toCamelKey(filename);
    if (seen.has(key)) {
      collisions.push({ key, files: [seen.get(key), filename] });
    } else {
      seen.set(key, filename);
    }
  }
  return collisions;
}

// CLI entrypoint. Wrapped so the file can be imported by tests without
// triggering side effects.
function main() {
  const { values } = parseArgs({
    options: {
      check: { type: "boolean", default: false },
    },
  });

  const fixtureDir = path.resolve("data/surface-fixtures");
  const indexPath = path.join(fixtureDir, "index.json");
  const outputPath = path.resolve("packages/surface-contracts/src/fixtures.ts");
  const entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));

  // Collision check before any file IO: two source filenames must never
  // produce the same camelCase export key.
  const collisions = detectCollisions(entries);
  if (collisions.length > 0) {
    console.error("Fixture filename collision detected:");
    for (const c of collisions) {
      console.error(
        `- key "${c.key}" produced by both "${c.files[0]}.json" and "${c.files[1]}.json" (the second would shadow the first)`,
      );
    }
    process.exit(1);
  }

  // The order of `entries` is product-meaningful (curated to surface the
  // primary states first); intentionally preserved here so the generated TS
  // is stable AND keeps that ordering. Do not sort.
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
}

const isCli =
  import.meta.url === `file://${process.argv[1]}` ||
  fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  main();
}
