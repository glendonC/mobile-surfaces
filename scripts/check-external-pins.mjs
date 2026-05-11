#!/usr/bin/env node
// Enforces external pin discipline for dependencies that must stay
// exact-pinned across releases. @bacons/apple-targets materializes the
// widget Xcode target at prebuild time (MS026); a floating range there
// would silently shift the generated ios/ output across contributors.
// Other published Mobile Surfaces packages already pin everything via
// release.md; this script catches the one dep we cannot ship around.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildReport,
  emitDiagnosticReport,
} from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-external-pins";

const PINNED = [
  {
    file: "apps/mobile/package.json",
    name: "@bacons/apple-targets",
    trapId: "MS026",
  },
];

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const checks = PINNED.map((entry) => {
  const abs = path.resolve(entry.file);
  if (!fs.existsSync(abs)) {
    return {
      id: entry.name,
      status: "fail",
      summary: `${entry.file} not found.`,
      trapId: entry.trapId,
    };
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (err) {
    return {
      id: entry.name,
      status: "fail",
      summary: `${entry.file} is not valid JSON: ${err.message}`,
      trapId: entry.trapId,
    };
  }
  const sources = ["dependencies", "devDependencies", "peerDependencies"];
  const found = sources
    .map((s) => (pkg[s] ? { source: s, range: pkg[s][entry.name] } : null))
    .find((hit) => hit && hit.range != null);
  if (!found) {
    return {
      id: entry.name,
      status: "fail",
      summary: `${entry.name} is not declared in ${entry.file}.`,
      trapId: entry.trapId,
    };
  }
  if (!EXACT_VERSION.test(found.range)) {
    return {
      id: entry.name,
      status: "fail",
      summary: `${entry.name} must be exact-pinned in ${entry.file} (got "${found.range}" under ${found.source}).`,
      trapId: entry.trapId,
      detail: {
        message:
          "Range operators (^, ~, *, x) silently drift the generated widget target. Pin to an exact version and update with a changeset when bumping.",
        issues: [
          {
            path: `${entry.file}`,
            message: `${entry.name}: "${found.range}"`,
          },
        ],
      },
    };
  }
  return {
    id: entry.name,
    status: "ok",
    summary: `${entry.name} pinned to ${found.range} in ${entry.file}.`,
    trapId: entry.trapId,
  };
});

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
