#!/usr/bin/env node
// Aggregates every check tool's --json output into a single DiagnosticBundle
// and writes two paste-ready files to the repo root:
//
//   ./mobile-surfaces-diagnose-<ts>.json   machine-readable bundle
//   ./mobile-surfaces-diagnose-<ts>.md     human-readable summary, safe to
//                                          paste into a public GitHub issue
//
// "Safe to paste publicly" is earned by:
//   - Every probe routes through scripts/lib/redact.mjs.
//   - APNs auth values are reported as boolean presence ("set" | "unset"),
//     never as the value itself.
//   - Path values referencing $HOME are rewritten as "~/...".
//   - PEM blocks and APNs-token-shaped strings are stripped if they appear
//     anywhere in any check's detail.
//
// The aggregator runs every check in a child process so a check that throws
// can never abort the bundle; failures are captured as a `fail`-status
// DiagnosticReport carrying the child's stderr in detail.message.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import os from "node:os";
import crypto from "node:crypto";
import {
  diagnosticReport,
  diagnosticBundle,
  rollupDiagnosticStatus,
} from "../packages/surface-contracts/src/diagnostics.ts";
import { redactDeep } from "./lib/redact.mjs";
import { diagnoseTools } from "./lib/check-registry.mjs";

// Repo root = parent of scripts/. Lets the user run `pnpm surface:diagnose`
// from any working directory inside the repo (the spawned children all
// expect repo-root paths and need to resolve TS imports against the source
// tree, not the user's current cwd).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

// The tool inventory is sourced from scripts/lib/check-registry.mjs — the
// same registry that drives surface-check. Diagnose includes every entry
// with diagnose: true and json !== false; the registry's order matches
// stage order, so the bundle reads the same as the canonical CI run.
const TOOLS = diagnoseTools();

const reports = [];
for (const { script, extra } of TOOLS) {
  const child = spawnSync(
    "node",
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      resolve(REPO_ROOT, script),
      ...extra,
      "--json",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // Strip any --experimental-strip-types warning lines from stdout (Node
  // emits them on stderr but if a child redirected them, defend anyway).
  const lastLine = child.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  let parsed;
  if (typeof lastLine === "string" && lastLine.startsWith("{")) {
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      parsed = null;
    }
  }
  const result = parsed
    ? diagnosticReport.safeParse(redactDeep(parsed))
    : { success: false, error: null };
  if (!result.success) {
    reports.push({
      schemaVersion: "1",
      tool: script.replace(/^scripts\//, "").replace(/\.mjs$/, ""),
      timestamp: new Date().toISOString(),
      status: "fail",
      checks: [
        {
          id: "tool-failed-to-run",
          status: "fail",
          summary: `${script} did not produce a valid DiagnosticReport.`,
          detail: {
            message: redactDeep(child.stderr || "no stderr").slice(0, 4000),
          },
        },
      ],
    });
    continue;
  }
  reports.push(result.data);
}

const bundleId = crypto.randomUUID().split("-")[0];
const generatedAt = new Date().toISOString();
const status = rollupDiagnosticStatus(reports.map((r) => r.status));

const xcodeVersion = (() => {
  try {
    const out = spawnSync("xcodebuild", ["-version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).stdout;
    return out?.split("\n")[0] || undefined;
  } catch {
    return undefined;
  }
})();

const pnpmVersion = (() => {
  try {
    return (
      spawnSync("pnpm", ["-v"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).stdout?.trim() || undefined
    );
  } catch {
    return undefined;
  }
})();

const bundle = diagnosticBundle.parse({
  schemaVersion: "1",
  bundleId,
  generatedAt,
  status,
  environment: {
    os: os.platform(),
    osRelease: os.release(),
    arch: os.arch(),
    node: process.versions.node,
    ...(pnpmVersion ? { pnpm: pnpmVersion } : {}),
    ...(xcodeVersion ? { xcode: xcodeVersion } : {}),
  },
  config: {
    cwd: redactDeep(process.cwd()),
  },
  reports,
});

const outDir = values.out ? resolve(values.out) : resolve(process.cwd());
const stamp = generatedAt.replace(/[:.]/g, "-");
const jsonPath = resolve(outDir, `mobile-surfaces-diagnose-${stamp}.json`);
const mdPath = resolve(outDir, `mobile-surfaces-diagnose-${stamp}.md`);

writeFileSync(jsonPath, JSON.stringify(bundle, null, 2) + "\n");
writeFileSync(mdPath, renderMarkdown(bundle));

if (values.json) {
  process.stdout.write(JSON.stringify(bundle) + "\n");
} else {
  console.log(
    `Wrote ${formatRel(jsonPath)} and ${formatRel(mdPath)} (status: ${bundle.status}).`,
  );
}

if (status === "fail") {
  process.exit(1);
}

function formatRel(p) {
  return p.replace(process.cwd() + "/", "./");
}

function renderMarkdown(bundle) {
  const lines = [];
  lines.push(`# Mobile Surfaces diagnose bundle (${bundle.bundleId})`);
  lines.push("");
  lines.push(
    "_Safe to paste into a public GitHub issue. APNs auth values are reported only as `set`/`unset`; paths are home-relative; tokens and PEM blocks are stripped._",
  );
  lines.push("");
  lines.push(`- **Generated:** ${bundle.generatedAt}`);
  lines.push(`- **Status:** ${bundle.status}`);
  lines.push(
    `- **Environment:** ${bundle.environment.os} ${bundle.environment.osRelease ?? ""} (${bundle.environment.arch}), Node ${bundle.environment.node}${bundle.environment.pnpm ? `, pnpm ${bundle.environment.pnpm}` : ""}${bundle.environment.xcode ? `, ${bundle.environment.xcode}` : ""}`,
  );
  lines.push("");
  lines.push("## Reports");
  lines.push("");
  for (const report of bundle.reports) {
    lines.push(`### ${report.tool} — \`${report.status}\``);
    lines.push("");
    for (const check of report.checks) {
      const icon =
        check.status === "ok"
          ? "✓"
          : check.status === "warn"
            ? "⚠"
            : check.status === "fail"
              ? "✗"
              : "•";
      const trapTag = check.trapId ? ` \`${check.trapId}\`` : "";
      lines.push(`- ${icon}${trapTag} **${check.id}** — ${check.summary}`);
      if (check.detail?.message) {
        lines.push(`  - ${check.detail.message}`);
      }
      if (check.detail?.issues) {
        for (const issue of check.detail.issues) {
          lines.push(`  - \`${issue.path || "(root)"}\`: ${issue.message}`);
        }
      }
      if (check.detail?.paths) {
        for (const p of check.detail.paths) {
          lines.push(`  - \`${p}\``);
        }
      }
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push(
    "_Generated by `pnpm surface:diagnose`. Schema: `@mobile-surfaces/surface-contracts` `DiagnosticBundle@1`._",
  );
  lines.push("");
  return lines.join("\n");
}
