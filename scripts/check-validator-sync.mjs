#!/usr/bin/env node
// Compares the identity validators in the rename script against the copies
// in the CLI's validators module. They drift if anyone tweaks one without
// the other; this script is the CI guard that catches that.

import fs from "node:fs";
import path from "node:path";

const renamePath = "scripts/rename-starter.mjs";
const cliPath = "packages/create-mobile-surfaces/src/validators.mjs";

const renameSrc = fs.readFileSync(renamePath, "utf8");
const cliSrc = fs.readFileSync(cliPath, "utf8");

// (CLI function name, rename script function name) — same regex in both.
// Functions that don't have a counterpart (e.g. validateTeamId is CLI-only)
// are intentionally absent.
const PAIRS = [
  ["validateProjectSlug", "validateSlug"],
  ["validateScheme", "validateScheme"],
  ["validateBundleId", "validateBundleId"],
];

function extractFirstRegex(source, fnName) {
  const declRe = new RegExp(`function\\s+${fnName}\\b`);
  const m = declRe.exec(source);
  if (!m) return null;
  const after = source.slice(m.index);
  const regexMatch = after.match(/\/[^\/\n]+?\/[gimsuy]*/);
  return regexMatch ? regexMatch[0] : null;
}

let ok = true;
for (const [cliName, renameName] of PAIRS) {
  const cliRegex = extractFirstRegex(cliSrc, cliName);
  const renameRegex = extractFirstRegex(renameSrc, renameName);

  if (!cliRegex) {
    console.error(`✗ Couldn't find ${cliName} in ${cliPath}`);
    ok = false;
    continue;
  }
  if (!renameRegex) {
    console.error(`✗ Couldn't find ${renameName} in ${renamePath}`);
    ok = false;
    continue;
  }

  if (cliRegex !== renameRegex) {
    console.error(`✗ Regex drift between ${cliPath}#${cliName} and ${renamePath}#${renameName}:`);
    console.error(`    CLI:    ${cliRegex}`);
    console.error(`    rename: ${renameRegex}`);
    ok = false;
  } else {
    console.log(`✓ ${cliName} ↔ ${renameName}: ${cliRegex}`);
  }
}

if (!ok) {
  console.error(
    "\nValidator regexes have drifted. Update both files together so the CLI and the rename script agree.",
  );
  process.exit(1);
}
console.log("\nValidator regexes are in sync.");
