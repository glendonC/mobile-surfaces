#!/usr/bin/env node
// Bump the `$schema` URL pinned in every JSON file under data/surface-fixtures/
// to match the current packages/surface-contracts/package.json major.minor.
// scripts/lib/schema-url.mjs is the single source of truth for the URL shape.
//
// Why this exists as a separate step: changesets/action bumps package.json
// versions during `pnpm release:version`, but the fixture JSON files pin a
// `$schema` field that scripts/validate-surface-fixtures.mjs cross-checks
// against the package version. Without this script the fixtures drift the
// moment a minor or major bump runs, and surface:check fails on the
// Version packages PR. Past releases (3.1.0, 3.2.0) hit this and had to
// patch the bot's PR by hand. Wired into the release:version pnpm script
// so the next bump fixes the drift before it reaches CI.

import fs from "node:fs";
import path from "node:path";
import { canonicalSchemaUrl } from "./lib/schema-url.mjs";

const FIXTURE_DIR = "data/surface-fixtures";
const url = canonicalSchemaUrl();
if (!url) {
  // Fork or non-upstream package name; nothing to bump.
  process.exit(0);
}

let touched = 0;
for (const filename of fs.readdirSync(FIXTURE_DIR)) {
  if (!filename.endsWith(".json")) continue;
  if (filename === "index.json") continue;
  const fullPath = path.join(FIXTURE_DIR, filename);
  const raw = fs.readFileSync(fullPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`✗ ${filename}: invalid JSON (${err.message})`);
    process.exit(1);
  }
  if (parsed.$schema === url) continue;
  parsed.$schema = url;
  // Preserve trailing newline; JSON.stringify with 2-space indent matches
  // the existing file shape produced by the rest of the toolchain.
  fs.writeFileSync(fullPath, JSON.stringify(parsed, null, 2) + "\n");
  touched += 1;
  console.log(`updated ${filename}`);
}

console.log(`${touched} fixture(s) updated to ${url}`);
