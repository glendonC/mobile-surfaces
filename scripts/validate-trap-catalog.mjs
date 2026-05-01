#!/usr/bin/env node
// Validates data/traps.json against the Zod trapCatalog schema. The catalog is
// the load-bearing source of truth for AGENTS.md / CLAUDE.md and (in a later
// milestone) the `mobile-surfaces check` CLI. Drift between the schema and the
// catalog must fail CI before downstream consumers regenerate against bad
// data.
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { trapCatalog } from "../packages/surface-contracts/src/traps.ts";

const target = resolve("data/traps.json");
if (!existsSync(target)) {
  console.error(`✗ data/traps.json missing at ${target}`);
  process.exit(1);
}

const raw = readFileSync(target, "utf8");
let parsed;
try {
  parsed = JSON.parse(raw);
} catch (error) {
  console.error("✗ data/traps.json is not valid JSON.");
  console.error(`  ${error.message}`);
  process.exit(1);
}

const result = trapCatalog.safeParse(parsed);
if (!result.success) {
  console.error("✗ data/traps.json failed Zod validation:");
  for (const issue of result.error.issues) {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    console.error(`  ${path}: ${issue.message}`);
  }
  process.exit(1);
}

// Cross-check: every enforcement.script path must exist on disk. A rule that
// claims an enforcement script that has been moved or deleted is worse than
// no rule at all — it makes the catalog lie.
const missingScripts = [];
for (const entry of result.data.entries) {
  if (entry.enforcement) {
    const scriptPath = resolve(entry.enforcement.script);
    if (!existsSync(scriptPath) || !statSync(scriptPath).isFile()) {
      missingScripts.push({ id: entry.id, script: entry.enforcement.script });
    }
  }
}

if (missingScripts.length > 0) {
  console.error("✗ Catalog references enforcement scripts that do not exist:");
  for (const { id, script } of missingScripts) {
    console.error(`  ${id}: ${script}`);
  }
  process.exit(1);
}

console.log(`Validated ${result.data.entries.length} trap entries.`);
