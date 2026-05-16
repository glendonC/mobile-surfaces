#!/usr/bin/env node
// Generates AGENTS.md and CLAUDE.md (identical content) from data/traps.json.
//
// Why two files: AGENTS.md is the cross-tool agentic standard (Codex / Cursor
// / Aider / Windsurf / Factory / Zed / Warp / Copilot all auto-discover it).
// Claude Code does NOT yet auto-discover AGENTS.md and instead reads CLAUDE.md
// natively. We generate both from the same source so the two files cannot
// drift; nobody hand-edits either one.
//
// Pass --check to fail when the committed files do not match the generator
// output. Mirrors scripts/build-schema.mjs.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { trapCatalog } from "../packages/surface-contracts/src/traps.ts";

const { values } = parseArgs({
  options: { check: { type: "boolean", default: false } },
});

const catalogPath = resolve("data/traps.json");
const raw = readFileSync(catalogPath, "utf8");
const parsed = JSON.parse(raw);
const result = trapCatalog.safeParse(parsed);
if (!result.success) {
  console.error("✗ data/traps.json failed validation. Run validate-trap-catalog first.");
  for (const issue of result.error.issues) {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    console.error(`  ${path}: ${issue.message}`);
  }
  process.exit(1);
}
const catalog = result.data;

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
const DETECTION_LABEL = {
  static: "static (script-checkable)",
  config: "config (declarative file)",
  runtime: "runtime (only at send/receive)",
  advisory: "advisory (no programmatic check)",
};

function indent(text, prefix) {
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? line : prefix + line))
    .join("\n");
}

function renderEntry(entry) {
  const lines = [];
  lines.push(`### ${entry.id}: ${entry.title}`);
  lines.push("");
  const meta = [
    `**severity:** ${entry.severity}`,
    `**detection:** ${DETECTION_LABEL[entry.detection]}`,
    `**tags:** ${entry.tags.join(", ")}`,
  ];
  if (entry.iosMin) meta.push(`**ios min:** ${entry.iosMin}`);
  if (entry.enforcement) {
    meta.push(`**enforced by:** \`${entry.enforcement.script}\``);
  }
  lines.push(meta.join("  •  "));
  lines.push("");
  lines.push(entry.summary);
  lines.push("");
  lines.push(`**Symptom.** ${entry.symptom}`);
  lines.push("");
  lines.push(`**Fix.** ${entry.fix}`);
  if (entry.docs && entry.docs.length > 0) {
    lines.push("");
    // data/traps.json `docs` entries are full URLs (the long-form pages
    // live at https://mobile-surfaces.com/docs). Emit each as a clickable
    // markdown link with the URL as both label and target.
    lines.push(
      `**See:** ${entry.docs.map((d) => `[${d}](${d})`).join(", ")}`,
    );
  }
  if (entry.appleDocs && entry.appleDocs.length > 0) {
    lines.push("");
    lines.push(
      `**Apple docs:** ${entry.appleDocs.map((url, idx) => `[ref ${idx + 1}](${url})`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

const sortedEntries = [...catalog.entries].sort((a, b) => {
  const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (severity !== 0) return severity;
  return a.id.localeCompare(b.id);
});

const errorCount = catalog.entries.filter((e) => e.severity === "error").length;
const warningCount = catalog.entries.filter((e) => e.severity === "warning").length;
const infoCount = catalog.entries.filter((e) => e.severity === "info").length;

const tagBuckets = new Map();
for (const entry of catalog.entries) {
  for (const tag of entry.tags) {
    if (!tagBuckets.has(tag)) tagBuckets.set(tag, []);
    tagBuckets.get(tag).push(entry.id);
  }
}
const tagSummary = [...tagBuckets.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([tag, ids]) => `- \`${tag}\`: ${ids.sort().join(", ")}`)
  .join("\n");

const indexTable = sortedEntries
  .map(
    (e) =>
      `| [${e.id}](#${e.id.toLowerCase()}-${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}) | ${e.severity} | ${e.detection} | ${e.title} |`,
  )
  .join("\n");

const body = [
  "<!--",
  "  THIS FILE IS GENERATED. DO NOT EDIT.",
  "  Source: data/traps.json (validated by packages/surface-contracts/src/traps.ts).",
  "  Regenerate with: node --experimental-strip-types scripts/build-agents-md.mjs",
  "  CI fails on drift via: pnpm surface:check",
  "-->",
  "",
  "# Mobile Surfaces: Invariants for AI Coding Assistants",
  "",
  "This document lists the mandatory invariants enforced by Mobile Surfaces' test suite. AI coding assistants working in a Mobile Surfaces project must respect these rules; `pnpm surface:check` enforces them in CI. The same rules apply to human engineers; the catalog makes them explicit. It is generated from `data/traps.json` — edits go to the catalog, not to this file.",
  "",
  "Mobile Surfaces is an Expo iOS reference architecture for Live Activities, Dynamic Island, home-screen widgets, and iOS 18 control widgets. iOS Live Activities silently fail: your code compiles, your push returns 200, and nothing appears on the Lock Screen. This catalog enumerates the failure modes that produce that silence and the static, config, and runtime checks the repo uses to surface them at PR time instead of on a customer device.",
  "",
  "## Index",
  "",
  `${catalog.entries.length} rules total: ${errorCount} error, ${warningCount} warning, ${infoCount} info.`,
  "",
  "| ID | Severity | Detection | Title |",
  "| --- | --- | --- | --- |",
  indexTable,
  "",
  "## Rules by tag",
  "",
  tagSummary,
  "",
  "## How to use this document",
  "",
  "- **When generating or editing code in a Mobile Surfaces project**, treat every `error` rule as a hard invariant. Do not bypass it; if your change requires breaking the invariant, surface that to the user and stop.",
  "- **When auditing an existing project**, walk the index from top to bottom. Static rules can be checked by reading files; config rules by reading `app.json`, `package.json`, and `expo-target.config.js`; runtime rules by inspecting recent APNs response codes; advisory rules by reading the symptom and confirming the user has runbook coverage.",
  "- **When suggesting fixes**, cite the rule id (e.g. `MS013`) so the user can trace the recommendation. The catalog id is stable across releases.",
  "- **Source of truth.** This file is generated from `data/traps.json`. The long-form docs live on the live site at https://mobile-surfaces.com/docs; this catalog carries the action-oriented summary.",
  "",
  "## Rules",
  "",
  sortedEntries.map(renderEntry).join("\n\n"),
  "",
  "## Related local documentation",
  "",
  "- [Architecture](https://mobile-surfaces.com/docs/architecture): the contract, the surfaces, the adapter boundary.",
  "- [Multi-surface](https://mobile-surfaces.com/docs/multi-surface): every `kind` value and the projection it drives.",
  "- [Backend integration](https://mobile-surfaces.com/docs/backend-integration): domain event to snapshot to APNs walkthrough.",
  "- [Push](https://mobile-surfaces.com/docs/push): wire-layer reference, SDK, smoke script, token taxonomy, error reasons.",
  "- [Observability](https://mobile-surfaces.com/docs/observability): which catalog-bound errors are worth alerting on, what a stuck Live Activity looks like on the wire, recommended log shape.",
  "- [Troubleshooting](https://mobile-surfaces.com/docs/troubleshooting): symptom-to-fix recipes for failures not in this catalog.",
  "- [Trap catalog maintenance](https://mobile-surfaces.com/docs/traps): schema and workflow for editing this catalog.",
  "",
];

const out = body.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";

const targets = [resolve("AGENTS.md"), resolve("CLAUDE.md")];

if (values.check) {
  let drift = false;
  for (const target of targets) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current !== out) {
      console.error(
        `${target.replace(`${process.cwd()}/`, "")} is out of sync with data/traps.json.`,
      );
      drift = true;
    }
  }
  if (drift) {
    console.error(
      "Run: node --experimental-strip-types scripts/build-agents-md.mjs",
    );
    process.exit(1);
  }
  console.log("AGENTS.md and CLAUDE.md are in sync with data/traps.json.");
} else {
  for (const target of targets) {
    writeFileSync(target, out);
    console.log(`Wrote ${target.replace(`${process.cwd()}/`, "")}.`);
  }
}
