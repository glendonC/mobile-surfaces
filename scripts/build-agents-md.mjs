#!/usr/bin/env node
// Generates AGENTS.md (full) and CLAUDE.md (compact) from data/traps.json.
//
// Why two files: AGENTS.md is the cross-tool agentic standard (Codex / Cursor
// / Aider / Windsurf / Factory / Zed / Warp / Copilot all auto-discover it).
// Claude Code does NOT yet auto-discover AGENTS.md and instead reads CLAUDE.md
// natively at conversation start, so its size is load-bearing for Claude Code
// performance — past ~40 KB the harness warns and slows down.
//
// AGENTS.md carries the full per-rule prose (Symptom + Fix per rule). CLAUDE.md
// is a compact index — intro, the same rule table, the same tag map and
// cross-reference list, the how-to, and the retired-id tombstones — with the
// rule-section links pointed at AGENTS.md so a Claude Code session can grep
// the table for the relevant trap id and fetch the prose on demand instead of
// loading 50 KB up front. The /llms-full.txt site endpoint and the trap-
// binding docsUrl strings point at AGENTS.md for the same reason.
//
// Pass --check to fail when the committed files do not match the generator
// output. Mirrors scripts/build-schema.mjs.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { trapCatalog } from "../packages/surface-contracts/src/traps.ts";
import { computeCatalogStats } from "./lib/catalog-stats.mjs";
import { checkRegistry } from "./lib/check-registry.mjs";

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

// Index counts and the index table cover only live entries. Retired entries
// (deprecated: true) used to bloat the index with "MS005 retired" rows that
// taught nothing actionable; they now live in a "Retired ids" footnote at
// the bottom of the document for external references that need them to
// keep resolving.
const liveEntries = catalog.entries.filter((e) => !e.deprecated);
const retiredEntries = catalog.entries.filter((e) => e.deprecated);

const sortedEntries = [...liveEntries].sort((a, b) => {
  const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (severity !== 0) return severity;
  return a.id.localeCompare(b.id);
});

// The headline counts come from the shared computeCatalogStats so the
// AGENTS.md / CLAUDE.md headline and the README + doc-site marker blocks
// (scripts/generate-catalog-stats.mjs) cannot count rules two different ways.
// The registry is passed so the headline can state how many rules are gated
// at PR time (stats.prGated); without it the headline would imply all rules
// are enforced, when only static and config rules bound to a surface:check
// stage are.
const stats = computeCatalogStats(catalog, checkRegistry);

const tagBuckets = new Map();
for (const entry of liveEntries) {
  for (const tag of entry.tags) {
    if (!tagBuckets.has(tag)) tagBuckets.set(tag, []);
    tagBuckets.get(tag).push(entry.id);
  }
}
const tagSummary = [...tagBuckets.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([tag, ids]) => `- \`${tag}\`: ${ids.sort().join(", ")}`)
  .join("\n");

function ruleAnchor(entry) {
  return `${entry.id.toLowerCase()}-${entry.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

function buildIndexTable(linkBase) {
  // linkBase is "" for AGENTS.md (in-document anchors) or "AGENTS.md" for
  // CLAUDE.md (cross-document anchors into the full reference).
  return sortedEntries
    .map(
      (e) =>
        `| [${e.id}](${linkBase}#${ruleAnchor(e)}) | ${e.severity} | ${e.detection} | ${e.title} |`,
    )
    .join("\n");
}

// Cross-references: pairs of trap ids that describe the same wire shape in
// two contexts or the inverse failures of the same header/setting. Each
// link is bidirectional in data/traps.json (Zod symmetry refinement), so
// we de-dupe by emitting only the pair where the lower id comes first.
const crossRefPairs = [];
const seenPairs = new Set();
for (const entry of liveEntries) {
  for (const siblingId of entry.siblings ?? []) {
    const [low, high] =
      entry.id < siblingId ? [entry.id, siblingId] : [siblingId, entry.id];
    const key = `${low}|${high}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const lowEntry = liveEntries.find((e) => e.id === low);
    const highEntry = liveEntries.find((e) => e.id === high);
    if (!lowEntry || !highEntry) continue;
    crossRefPairs.push({ low: lowEntry, high: highEntry });
  }
}
crossRefPairs.sort((a, b) => a.low.id.localeCompare(b.low.id));

const crossRefSection = crossRefPairs.length > 0
  ? crossRefPairs
      .map(
        ({ low, high }) =>
          `- **${low.id} ↔ ${high.id}** — ${low.title}; ${high.title}.`,
      )
      .join("\n")
  : "_(no cross-references registered.)_";

const retiredSection = retiredEntries.length > 0
  ? retiredEntries
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => `- **${e.id}** — ${e.summary}`)
      .join("\n")
  : "_(no retired ids reserved.)_";

const GENERATED_BANNER = [
  "<!--",
  "  THIS FILE IS GENERATED. DO NOT EDIT.",
  "  Source: data/traps.json (validated by packages/surface-contracts/src/traps.ts).",
  "  Regenerate with: node --experimental-strip-types scripts/build-agents-md.mjs",
  "  CI fails on drift via: pnpm surface:check",
  "-->",
];

const INDEX_SUMMARY = `${stats.live} live rules: ${stats.bySeverity.error} error, ${stats.bySeverity.warning} warning, ${stats.bySeverity.info} info. ${stats.prGated} are enforced at PR time by \`pnpm surface:check\`; the rest surface as runtime errors or advisory notes. ${stats.deprecated} retired ids reserved (see footnote).`;

const HOW_TO_USE_LINES = [
  "- **When generating or editing code in a Mobile Surfaces project**, treat every `error` rule as a hard invariant. Do not bypass it; if your change requires breaking the invariant, surface that to the user and stop.",
  "- **When auditing an existing project**, walk the index from top to bottom. Static rules can be checked by reading files; config rules by reading `app.json`, `package.json`, and `expo-target.config.js`; runtime rules by inspecting recent APNs response codes; advisory rules by reading the symptom and confirming the user has runbook coverage.",
  "- **When suggesting fixes**, cite the rule id (e.g. `MS013`) so the user can trace the recommendation. The catalog id is stable across releases.",
  "- **Source of truth.** This file is generated from `data/traps.json`. The long-form docs live on the live site at https://mobile-surfaces.com/docs; this catalog carries the action-oriented summary.",
];

const RELATED_DOCS_LINES = [
  "- [Architecture](https://mobile-surfaces.com/docs/architecture): the contract, the surfaces, the adapter boundary.",
  "- [Multi-surface](https://mobile-surfaces.com/docs/multi-surface): every `kind` value and the projection it drives.",
  "- [Backend integration](https://mobile-surfaces.com/docs/backend-integration): domain event to snapshot to APNs walkthrough.",
  "- [Push](https://mobile-surfaces.com/docs/push): wire-layer reference, SDK, smoke script, token taxonomy, error reasons.",
  "- [Observability](https://mobile-surfaces.com/docs/observability): which catalog-bound errors are worth alerting on, what a stuck Live Activity looks like on the wire, recommended log shape.",
  "- [Troubleshooting](https://mobile-surfaces.com/docs/troubleshooting): symptom-to-fix recipes for failures not in this catalog.",
  "- [Trap catalog maintenance](https://mobile-surfaces.com/docs/traps): schema and workflow for editing this catalog.",
];

// AGENTS.md — the full reference. Per-rule Symptom + Fix prose lives here;
// other agentic tools (Codex / Cursor / Aider / ...) auto-discover it, and
// the site's /llms-full.txt endpoint mirrors it.
const agentsBody = [
  ...GENERATED_BANNER,
  "",
  "# Mobile Surfaces: Invariants for AI Coding Assistants",
  "",
  "This document lists the mandatory invariants enforced by Mobile Surfaces' test suite. AI coding assistants working in a Mobile Surfaces project must respect these rules; `pnpm surface:check` enforces them in CI. The same rules apply to human engineers; the catalog makes them explicit. It is generated from `data/traps.json`; edits go to the catalog, not to this file.",
  "",
  "Mobile Surfaces is an Expo iOS reference architecture for Live Activities, Dynamic Island, home-screen widgets, and iOS 18 control widgets. iOS Live Activities silently fail: your code compiles, your push returns 200, and nothing appears on the Lock Screen. This catalog enumerates the failure modes that produce that silence and the static, config, and runtime checks the repo uses to surface them at PR time instead of on a customer device.",
  "",
  "Claude Code does not auto-discover AGENTS.md and instead reads [`CLAUDE.md`](./CLAUDE.md) at conversation start. CLAUDE.md is a compact index that links back to the rule sections here for per-rule prose.",
  "",
  "## Index",
  "",
  INDEX_SUMMARY,
  "",
  "| ID | Severity | Detection | Title |",
  "| --- | --- | --- | --- |",
  buildIndexTable(""),
  "",
  "## Rules by tag",
  "",
  tagSummary,
  "",
  "## Cross-references",
  "",
  "Trap ids that describe the same constraint in two contexts, or the inverse failures of the same wire shape:",
  "",
  crossRefSection,
  "",
  "## How to use this document",
  "",
  ...HOW_TO_USE_LINES,
  "",
  "## Rules",
  "",
  sortedEntries.map(renderEntry).join("\n\n"),
  "",
  "## Retired ids",
  "",
  "Trap ids are monotonic forever; retired rules keep their id with a one-line tombstone here so external references (PR comments, log lines, blog posts) keep resolving to a known marker.",
  "",
  retiredSection,
  "",
  "## Related local documentation",
  "",
  ...RELATED_DOCS_LINES,
  "",
];

// CLAUDE.md — compact. Same intro, index, tag map, cross-refs, how-to, and
// retired tombstones; the rule-section links jump to AGENTS.md so the per-
// rule Symptom + Fix prose is one hop away instead of inline. Claude Code
// auto-loads this file into every conversation, so keeping it lean is what
// the split is for.
const claudeBody = [
  ...GENERATED_BANNER,
  "",
  "# Mobile Surfaces: Invariants for AI Coding Assistants",
  "",
  "This document lists the mandatory invariants enforced by Mobile Surfaces' test suite. Treat every `error` rule as a hard invariant; `pnpm surface:check` enforces them in CI. The catalog is generated from `data/traps.json`; edits go there, not to this file.",
  "",
  "Mobile Surfaces is an Expo iOS reference architecture for Live Activities, Dynamic Island, home-screen widgets, and iOS 18 control widgets. iOS Live Activities silently fail: your code compiles, your push returns 200, and nothing appears on the Lock Screen. This catalog enumerates the failure modes that produce that silence and the checks the repo uses to surface them at PR time.",
  "",
  "The per-rule Symptom and Fix prose lives in [`AGENTS.md`](./AGENTS.md); the index rows below link to its anchors. The raw source is [`data/traps.json`](./data/traps.json). CLAUDE.md is kept compact because Claude Code loads it into every conversation.",
  "",
  "## Index",
  "",
  INDEX_SUMMARY,
  "",
  "| ID | Severity | Detection | Title |",
  "| --- | --- | --- | --- |",
  buildIndexTable("AGENTS.md"),
  "",
  "## Rules by tag",
  "",
  tagSummary,
  "",
  "## Cross-references",
  "",
  "Trap ids that describe the same constraint in two contexts, or the inverse failures of the same wire shape:",
  "",
  crossRefSection,
  "",
  "## How to use this document",
  "",
  ...HOW_TO_USE_LINES,
  "",
  "## Retired ids",
  "",
  "Trap ids are monotonic forever; retired rules keep their id with a one-line tombstone here so external references (PR comments, log lines, blog posts) keep resolving to a known marker.",
  "",
  retiredSection,
  "",
  "## Related local documentation",
  "",
  ...RELATED_DOCS_LINES,
  "",
];

function finalize(lines) {
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

const targets = [
  { path: resolve("AGENTS.md"), content: finalize(agentsBody) },
  { path: resolve("CLAUDE.md"), content: finalize(claudeBody) },
];

if (values.check) {
  let drift = false;
  for (const { path, content } of targets) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (current !== content) {
      console.error(
        `${path.replace(`${process.cwd()}/`, "")} is out of sync with data/traps.json.`,
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
  for (const { path, content } of targets) {
    writeFileSync(path, content);
    console.log(`Wrote ${path.replace(`${process.cwd()}/`, "")}.`);
  }
}
