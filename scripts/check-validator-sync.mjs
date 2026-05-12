#!/usr/bin/env node
// Verifies that every consumer of @mobile-surfaces/validators imports only
// names that the source package actually exports. Two consumers exist:
//
//   packages/create-mobile-surfaces/src/validators.mjs
//     A thin re-export shim. The CLI internals import from this local file
//     so a future swap of the source package stays a one-file edit.
//
//   scripts/rename-starter.mjs
//     Imports via a relative path because it runs inside freshly-scaffolded
//     projects before `pnpm install`, when workspace symlinks don't exist
//     yet. The relative path resolves to the same source file the CLI
//     consumes via the bare specifier.
//
// Without this check, renaming or removing a validator in the source would
// silently break one consumer at runtime while the other kept compiling —
// exactly the silent-drift trap the catalog exists to prevent.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-validator-sync";
const SOURCE_FILE = path.resolve("packages/validators/src/index.mjs");
const CLI_SHIM = path.resolve(
  "packages/create-mobile-surfaces/src/validators.mjs",
);
const RENAME_STARTER = path.resolve("scripts/rename-starter.mjs");

const missing = [];
for (const file of [SOURCE_FILE, CLI_SHIM, RENAME_STARTER]) {
  if (!fs.existsSync(file)) missing.push(file);
}
if (missing.length > 0) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "load-source",
        status: "fail",
        summary: `Required file(s) not found: ${missing
          .map((m) => path.relative(process.cwd(), m))
          .join(", ")}`,
      },
    ]),
    { json: values.json },
  );
}

const sourceSrc = fs.readFileSync(SOURCE_FILE, "utf8");
const sourceExports = new Set(extractExportedNames(sourceSrc));

const cliShimSrc = fs.readFileSync(CLI_SHIM, "utf8");
const cliReExports = extractReExportedNames(cliShimSrc, "@mobile-surfaces/validators");

const renameSrc = fs.readFileSync(RENAME_STARTER, "utf8");
const renameImports = extractImportedNames(
  renameSrc,
  /["']\.\.\/packages\/validators\/src\/index\.mjs["']/,
);

const cliMissing = cliReExports.filter((name) => !sourceExports.has(name));
const renameMissing = renameImports.filter((name) => !sourceExports.has(name));

const checks = [];

checks.push({
  id: "source-exports-readable",
  status: sourceExports.size > 0 ? "ok" : "fail",
  summary:
    sourceExports.size > 0
      ? `${sourceExports.size} export(s) found in ${path.relative(process.cwd(), SOURCE_FILE)}.`
      : `No exports parsed from ${path.relative(process.cwd(), SOURCE_FILE)}.`,
});

checks.push({
  id: "cli-shim-sync",
  status: cliMissing.length === 0 ? "ok" : "fail",
  summary:
    cliMissing.length === 0
      ? `CLI re-export shim (${cliReExports.length} name(s)) is in sync with source.`
      : `CLI re-export shim imports ${cliMissing.length} name(s) not exported by source.`,
  ...(cliMissing.length > 0
    ? {
        detail: {
          message: `Add the missing exports to ${path.relative(process.cwd(), SOURCE_FILE)}, or remove the re-export from ${path.relative(process.cwd(), CLI_SHIM)}.`,
          issues: cliMissing.map((name) => ({
            path: path.relative(process.cwd(), CLI_SHIM),
            message: `re-exports "${name}" which is not exported by @mobile-surfaces/validators`,
          })),
        },
      }
    : {}),
});

checks.push({
  id: "rename-starter-sync",
  status: renameMissing.length === 0 ? "ok" : "fail",
  summary:
    renameMissing.length === 0
      ? `rename-starter (${renameImports.length} name(s)) is in sync with source.`
      : `rename-starter imports ${renameMissing.length} name(s) not exported by source.`,
  ...(renameMissing.length > 0
    ? {
        detail: {
          message: `Add the missing exports to ${path.relative(process.cwd(), SOURCE_FILE)}, or remove the import from ${path.relative(process.cwd(), RENAME_STARTER)}.`,
          issues: renameMissing.map((name) => ({
            path: path.relative(process.cwd(), RENAME_STARTER),
            message: `imports "${name}" which is not exported by the validators source`,
          })),
        },
      }
    : {}),
});

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });

// Parses `export function NAME(` and `export const NAME =` declarations.
// Does not handle `export { a, b }` re-export groups — the source file uses
// only the direct-export forms above, and switching it would be visible
// here as a test-time regression.
function extractExportedNames(src) {
  const names = [];
  const re = /export\s+(?:function|const|let|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let match;
  while ((match = re.exec(src)) !== null) names.push(match[1]);
  return names;
}

// Parses `export { a, b, c } from "<specifier>";` and returns the bracketed
// names. Handles multi-line bracket blocks.
function extractReExportedNames(src, specifier) {
  const re = new RegExp(
    `export\\s*\\{([^}]*)\\}\\s*from\\s*["']${specifier.replace(/[.*+?^${}()|[\\\]\\\\]/g, "\\\\$&")}["']`,
    "g",
  );
  const names = [];
  let match;
  while ((match = re.exec(src)) !== null) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

// Parses `import { a, b, c } from "<path-pattern>";` and returns the
// bracketed names. The path is matched as a regex to allow flexible
// quoting and to keep the caller in control of how strict the path match
// is. Handles multi-line bracket blocks.
function extractImportedNames(src, pathPattern) {
  const re = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*${pathPattern.source}`,
    "g",
  );
  const names = [];
  let match;
  while ((match = re.exec(src)) !== null) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}
