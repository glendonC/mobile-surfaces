#!/usr/bin/env node
// Validates data/traps.json against the Zod trapCatalog schema. The catalog is
// the load-bearing source of truth for AGENTS.md / CLAUDE.md and (in a later
// milestone) the `mobile-surfaces check` CLI. Drift between the schema and the
// catalog must fail CI before downstream consumers regenerate against bad
// data.
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { trapCatalog } from "../packages/surface-contracts/src/traps.ts";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "validate-trap-catalog";
const target = resolve("data/traps.json");

if (!existsSync(target)) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "load-traps",
        status: "fail",
        summary: `data/traps.json missing at ${target}`,
      },
    ]),
    { json: values.json },
  );
}

const raw = readFileSync(target, "utf8");
let parsed;
try {
  parsed = JSON.parse(raw);
} catch (error) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "parse-traps",
        status: "fail",
        summary: "data/traps.json is not valid JSON.",
        detail: { message: error.message ?? String(error) },
      },
    ]),
    { json: values.json },
  );
}

const result = trapCatalog.safeParse(parsed);
const checks = [];

if (!result.success) {
  checks.push({
    id: "trap-catalog-zod",
    status: "fail",
    summary: "data/traps.json failed Zod validation.",
    detail: {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.length ? issue.path.join(".") : "(root)",
        message: issue.message,
      })),
    },
  });
  emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
}

checks.push({
  id: "trap-catalog-zod",
  status: "ok",
  summary: `Validated ${result.data.entries.length} trap entries.`,
});

const missingScripts = [];
for (const entry of result.data.entries) {
  if (entry.enforcement) {
    const scriptPath = resolve(entry.enforcement.script);
    if (!existsSync(scriptPath) || !statSync(scriptPath).isFile()) {
      missingScripts.push({
        path: entry.id,
        message: `enforcement.script does not exist: ${entry.enforcement.script}`,
      });
    }
  }
}

checks.push({
  id: "enforcement-scripts-exist",
  status: missingScripts.length === 0 ? "ok" : "fail",
  summary:
    missingScripts.length === 0
      ? "Every cited enforcement script resolves to a real file."
      : `${missingScripts.length} trap${missingScripts.length === 1 ? "" : "s"} cite a missing enforcement script.`,
  ...(missingScripts.length > 0
    ? { detail: { issues: missingScripts } }
    : {}),
});

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
