#!/usr/bin/env node
// Validates every JSON fixture under data/surface-fixtures against the Zod
// liveSurfaceSnapshot. The shared schema is the single source of truth for both
// the published JSON Schema and runtime parsing. Fixtures carry a $schema
// pointer for IDE tooling; we strip it before parsing because the wire payload
// itself does not carry $schema.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { liveSurfaceSnapshot } from "../packages/surface-contracts/src/schema.ts";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import { canonicalSchemaUrl } from "./lib/schema-url.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "validate-surface-fixtures";
const fixtureDir = resolve("data/surface-fixtures");
const indexPath = join(fixtureDir, "index.json");
const entries = JSON.parse(readFileSync(indexPath, "utf8"));
const expectedSchemaUrl = canonicalSchemaUrl();

const fixtureIssues = [];
const schemaUrlIssues = [];

for (const entry of entries) {
  const filename = entry.replace(/^\.\//, "");
  const file = resolve(fixtureDir, filename);
  const fixture = JSON.parse(readFileSync(file, "utf8"));
  const { $schema, ...rest } = fixture;
  if (expectedSchemaUrl && typeof $schema === "string" && $schema !== expectedSchemaUrl) {
    schemaUrlIssues.push({
      path: filename,
      message: `$schema points at ${$schema}; expected ${expectedSchemaUrl}`,
    });
  }
  const result = liveSurfaceSnapshot.safeParse(rest);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const issuePath = issue.path.length ? issue.path.join(".") : "(root)";
      fixtureIssues.push({
        path: `${filename}:${issuePath}`,
        message: issue.message,
      });
    }
  }
}

const onDisk = readdirSync(fixtureDir).filter(
  (f) => f.endsWith(".json") && f !== "index.json",
);
const indexed = new Set(entries.map((e) => e.replace(/^\.\//, "")));
const orphanIssues = [];
for (const f of onDisk) {
  if (!indexed.has(f)) {
    orphanIssues.push({
      path: f,
      message: "present on disk but missing from index.json",
    });
  }
}

const checks = [
  {
    id: "fixtures-parse",
    status: fixtureIssues.length === 0 ? "ok" : "fail",
    summary:
      fixtureIssues.length === 0
        ? `All ${entries.length} indexed fixtures parse against liveSurfaceSnapshot.`
        : `${fixtureIssues.length} fixture issue${fixtureIssues.length === 1 ? "" : "s"} blocking parse.`,
    trapId: "MS007",
    ...(fixtureIssues.length > 0 ? { detail: { issues: fixtureIssues } } : {}),
  },
  {
    id: "fixtures-indexed",
    status: orphanIssues.length === 0 ? "ok" : "fail",
    summary:
      orphanIssues.length === 0
        ? "Every fixture on disk is referenced from index.json."
        : `${orphanIssues.length} fixture file${orphanIssues.length === 1 ? "" : "s"} not referenced from index.json.`,
    ...(orphanIssues.length > 0 ? { detail: { issues: orphanIssues } } : {}),
  },
  {
    id: "fixtures-schema-url",
    status: schemaUrlIssues.length === 0 ? "ok" : "fail",
    summary:
      schemaUrlIssues.length === 0
        ? "Every fixture $schema URL matches the current package major.minor."
        : `${schemaUrlIssues.length} fixture${schemaUrlIssues.length === 1 ? "" : "s"} pin a stale $schema URL.`,
    trapId: "MS006",
    ...(schemaUrlIssues.length > 0
      ? {
          detail: {
            issues: schemaUrlIssues,
            message:
              "Update the fixture's $schema field to match the current @major.minor (see scripts/lib/schema-url.mjs).",
          },
        }
      : {}),
  },
];

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
