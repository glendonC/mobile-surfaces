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

function extractFunctionBody(source, fnName) {
  const declRe = new RegExp(`function\\s+${fnName}\\b`);
  const m = declRe.exec(source);
  if (!m) return null;
  // Walk forward from the function keyword, find the opening brace, then
  // balance braces to the close. Cheap-and-cheerful: comments/strings
  // containing braces would fool this, but the rename script and CLI
  // validators are short and brace-clean.
  const start = source.indexOf("{", m.index);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function extractAllRegexes(source, fnName) {
  const body = extractFunctionBody(source, fnName);
  if (body == null) return null;
  // Match regex literals that follow positions where a regex is legal.
  // Validator bodies are simple — just look for /…/flags after `(` or `!`
  // or whitespace, which is how all our checks read .test(s).
  const out = [];
  const re = /(^|[\s(!=,;:])(\/(?:\\.|[^\/\n\\])+\/[gimsuy]*)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push(m[2]);
  }
  return out;
}

let ok = true;
for (const [cliName, renameName] of PAIRS) {
  const cliRegexes = extractAllRegexes(cliSrc, cliName);
  const renameRegexes = extractAllRegexes(renameSrc, renameName);

  if (!cliRegexes || cliRegexes.length === 0) {
    console.error(`✗ Couldn't find ${cliName} in ${cliPath}`);
    ok = false;
    continue;
  }
  if (!renameRegexes || renameRegexes.length === 0) {
    console.error(`✗ Couldn't find ${renameName} in ${renamePath}`);
    ok = false;
    continue;
  }

  if (cliRegexes.length !== renameRegexes.length) {
    console.error(
      `✗ Regex count differs between ${cliPath}#${cliName} (${cliRegexes.length}) and ${renamePath}#${renameName} (${renameRegexes.length}). Both functions must hold the same set of structural and placeholder checks.`,
    );
    console.error(`    CLI:    ${cliRegexes.join("  ")}`);
    console.error(`    rename: ${renameRegexes.join("  ")}`);
    ok = false;
    continue;
  }

  let pairOk = true;
  for (let i = 0; i < cliRegexes.length; i += 1) {
    if (cliRegexes[i] !== renameRegexes[i]) {
      console.error(
        `✗ Regex drift between ${cliPath}#${cliName} and ${renamePath}#${renameName} (regex #${i + 1}):`,
      );
      console.error(`    CLI:    ${cliRegexes[i]}`);
      console.error(`    rename: ${renameRegexes[i]}`);
      ok = false;
      pairOk = false;
    }
  }
  if (pairOk) {
    console.log(`✓ ${cliName} ↔ ${renameName}: ${cliRegexes.join("  ")}`);
  }
}

if (!ok) {
  console.error(
    "\nValidator regexes have drifted. Update both files together so the CLI and the rename script agree.",
  );
  process.exit(1);
}
console.log("\nValidator regexes are in sync.");
