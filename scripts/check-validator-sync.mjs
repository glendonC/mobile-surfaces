#!/usr/bin/env node
// Compares the identity validators in the rename script against the copies
// in the CLI's validators module. They drift if anyone tweaks one without
// the other; this script is the CI guard that catches that.

import fs from "node:fs";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-validator-sync";
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
  const out = [];
  const re = /(^|[\s(!=,;:])(\/(?:\\.|[^\/\n\\])+\/[gimsuy]*)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push(m[2]);
  }
  return out;
}

const checks = [];

for (const [cliName, renameName] of PAIRS) {
  const cliRegexes = extractAllRegexes(cliSrc, cliName);
  const renameRegexes = extractAllRegexes(renameSrc, renameName);

  const issues = [];
  if (!cliRegexes || cliRegexes.length === 0) {
    issues.push({
      path: `${cliPath}#${cliName}`,
      message: `Couldn't find ${cliName} in ${cliPath}`,
    });
  }
  if (!renameRegexes || renameRegexes.length === 0) {
    issues.push({
      path: `${renamePath}#${renameName}`,
      message: `Couldn't find ${renameName} in ${renamePath}`,
    });
  }
  if (cliRegexes && renameRegexes) {
    if (cliRegexes.length !== renameRegexes.length) {
      issues.push({
        path: `${cliName}↔${renameName}`,
        message: `Regex count differs (${cliRegexes.length} vs ${renameRegexes.length}). CLI: ${cliRegexes.join("  ")} | rename: ${renameRegexes.join("  ")}`,
      });
    } else {
      for (let i = 0; i < cliRegexes.length; i += 1) {
        if (cliRegexes[i] !== renameRegexes[i]) {
          issues.push({
            path: `${cliName}↔${renameName}#${i + 1}`,
            message: `CLI: ${cliRegexes[i]} | rename: ${renameRegexes[i]}`,
          });
        }
      }
    }
  }

  checks.push({
    id: `pair-${cliName}`,
    status: issues.length === 0 ? "ok" : "fail",
    trapId: "MS005",
    summary:
      issues.length === 0
        ? `${cliName} ↔ ${renameName}: ${cliRegexes.join("  ")}`
        : `${cliName} ↔ ${renameName} drift detected.`,
    ...(issues.length > 0 ? { detail: { issues } } : {}),
  });
}

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
