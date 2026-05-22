#!/usr/bin/env node
// `pnpm surface:audit --root <path>` — run the Mobile Surfaces static gates
// against a foreign Expo project from inside a Mobile Surfaces checkout.
//
// This is the in-checkout replacement for the dropped `mobile-surfaces audit`
// subcommand. Shipping a foreign-project scanner inside the published CLI
// tarball meant bundling the gate scripts plus their scripts/lib/ dependency
// closure into the package; one of those libs hard-codes the monorepo root,
// so bundling forked the libs into a second copy that drifts. The gates
// already accept `--root` / `--mode=audit`, so the capability lives here
// instead: clone Mobile Surfaces, point this script at your project.
//
// The four gates below are the ones that can meaningfully run against a
// project that is not the Mobile Surfaces monorepo itself: app-config probe,
// App Group identity, the ios/ gitignore check, and the toolchain doctor.
// The Zod/Swift parity gates are not included — they audit the contract
// package's own source, which a foreign project does not carry.
//
// Flags:
//   --root <path>   Project root to audit (required).
//   --json          Emit one machine-readable JSON object instead of pretty
//                    rows. Exit code is non-zero when any gate fails either
//                    way.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

// Each gate script under scripts/, plus the foreign-audit flags it accepts.
// All four branch on --mode=audit: it switches the gate from the fixed
// monorepo layout to discovering the audited project's Expo app directory,
// so a foreign project whose app.json sits at its own root is handled
// instead of false-failing against a hard-coded apps/mobile path.
const AUDIT_CHECKS = Object.freeze([
  {
    id: "probe-app-config",
    label: "App config (deployment target, App Group, contract dep)",
    script: "probe-app-config.mjs",
    args: (root) => ["--root", root, "--mode", "audit"],
  },
  {
    id: "check-app-group-identity",
    label: "App Group identifier identity across sources",
    script: "check-app-group-identity.mjs",
    args: (root) => ["--root", root, "--mode", "audit"],
  },
  {
    id: "check-ios-gitignore",
    label: "Generated ios/ gitignored and untracked",
    script: "check-ios-gitignore.mjs",
    args: (root) => ["--root", root, "--mode", "audit"],
  },
  {
    id: "doctor",
    label: "Toolchain + project preflight",
    script: "doctor.mjs",
    args: (root) => ["--root", root, "--mode", "audit"],
  },
]);

const { values: cli } = parseArgs({
  options: {
    root: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (cli.help) {
  console.log("Usage: pnpm surface:audit --root <path> [--json]");
  process.exit(0);
}

if (!cli.root) {
  console.error("surface:audit: --root <path> is required.");
  console.error("Usage: pnpm surface:audit --root <path> [--json]");
  process.exit(2);
}

const root = resolve(cli.root);
if (!existsSync(root)) {
  console.error(`surface:audit: root path does not exist: ${root}`);
  process.exit(2);
}

function runCheck(cfg) {
  const scriptPath = resolve(SCRIPTS_DIR, cfg.script);
  return new Promise((resolveOuter) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings=ExperimentalWarning",
        scriptPath,
        "--json",
        ...cfg.args(root),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      // Gate scripts write a DiagnosticReport JSON on stdout and exit
      // non-zero when the rolled-up status is "fail". Parse the JSON for
      // detail; fall back to a synthetic fail row when it is unparseable.
      let report = null;
      try {
        report = JSON.parse(stdout.trim());
      } catch {
        // handled below
      }
      resolveOuter({ exitCode: code ?? 1, report, stderr });
    });
  });
}

const results = [];
for (const cfg of AUDIT_CHECKS) {
  const { report, exitCode, stderr } = await runCheck(cfg);
  results.push({ id: cfg.id, label: cfg.label, report, exitCode, stderr });
}

let pass = 0;
let warn = 0;
let fail = 0;
for (const r of results) {
  if (!r.report) {
    fail += 1;
    continue;
  }
  for (const check of r.report.checks) {
    if (check.status === "ok") pass += 1;
    else if (check.status === "warn") warn += 1;
    else if (check.status === "fail") fail += 1;
  }
}

const failed = fail > 0;

if (cli.json) {
  process.stdout.write(
    JSON.stringify({
      tool: "surface-audit",
      root,
      generatedAt: new Date().toISOString(),
      status: failed ? "fail" : warn > 0 ? "warn" : "ok",
      summary: { pass, warn, fail },
      checks: results.map((r) => ({
        id: r.id,
        label: r.label,
        report: r.report,
        ...(r.report
          ? {}
          : { error: `gate exited ${r.exitCode} with no parseable report` }),
      })),
    }) + "\n",
  );
} else {
  const HR = "─".repeat(72);
  console.log(`${HR}\nsurface:audit — ${root}\n${HR}`);
  for (const r of results) {
    console.log(`\n${r.label}  (${r.id})`);
    if (!r.report) {
      console.log(`  ✗ gate exited ${r.exitCode} with no parseable report.`);
      if (r.stderr.trim()) {
        console.log(`    ${r.stderr.trim().slice(0, 400)}`);
      }
      continue;
    }
    for (const check of r.report.checks) {
      const icon =
        check.status === "ok"
          ? "✓"
          : check.status === "warn"
            ? "⚠"
            : check.status === "fail"
              ? "✗"
              : "•";
      const trapTag = check.trapId ? ` [${check.trapId}]` : "";
      console.log(`  ${icon}${trapTag} ${check.summary}`);
      if (check.detail?.message) {
        console.log(`    ${check.detail.message}`);
      }
      for (const issue of check.detail?.issues ?? []) {
        console.log(`    - ${issue.path || "(root)"}: ${issue.message}`);
      }
      for (const p of check.detail?.paths ?? []) {
        console.log(`    - ${p}`);
      }
    }
  }
  console.log(
    `\n${HR}\n${pass} ok, ${warn} warn, ${fail} fail\n${HR}`,
  );
  if (failed) {
    console.log(
      "\nFAIL: one or more gates failed against the audited project.",
    );
  } else {
    console.log("\nOK: every gate passed against the audited project.");
  }
}

process.exit(failed ? 1 : 0);
