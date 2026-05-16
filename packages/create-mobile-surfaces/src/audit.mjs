// `mobile-surfaces audit` orchestrator. Runs the same static gates that
// protect the Mobile Surfaces contract (probe-app-config, check-app-group-
// identity, check-ios-gitignore, doctor) against a foreign Expo project
// rooted at `rootDir`. Aggregates the resulting DiagnosticReports into one
// AuditReport that the CLI renderer turns into pass/warn/fail rows with
// MS-id chips and docsUrl links.
//
// We invoke the gate scripts as subprocesses (rather than importing their
// core functions) for two reasons:
//
//   1. The gate scripts remain the canonical implementation. Any future
//      change to a check flows automatically into the audit subcommand
//      without coupling the published `create-mobile-surfaces` package to
//      a relative-path import out of its own tree.
//   2. The gate scripts read TS source files (via Node's experimental
//      strip-types) for schema validation; the CLI bin runs in plain ESM
//      mode and does not enable strip. Subprocesses get their own flags.
//
// The subprocess approach trades a small per-check spawn overhead for a
// resilient API surface. Audit runs are not on a hot path; the user runs
// them once per PR.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findTrap } from "@mobile-surfaces/traps";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Repo-root locator. When the CLI runs from inside the monorepo (development
 * or `pnpm dev:try`), the scripts live at <repo>/scripts/. When the CLI
 * runs from a published install (`npm create mobile-surfaces audit`), the
 * scripts are NOT bundled with the CLI tarball; instead the audit
 * subcommand resolves them via `@mobile-surfaces/surface-contracts` (which
 * does publish them). For the v7 deliverable we ship the in-tree path and
 * gate the published path with a clear error — the audit subcommand is
 * primarily intended for monorepo contributors and CI consumers running
 * from a checkout.
 */
function locateRepoScripts() {
  // Walk up from HERE looking for a scripts/ dir alongside data/traps.json.
  let cursor = HERE;
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(cursor, "scripts");
    if (existsSync(resolve(candidate, "probe-app-config.mjs"))) {
      return candidate;
    }
    const parent = resolve(cursor, "..");
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

// Per-check configuration. Each entry names a script under scripts/ plus the
// MS-ids it covers (used by the renderer to print pass/fail chips even when
// the underlying DiagnosticReport row omits a trapId — see the "summary"
// roll-up below). `args` adds the foreign-audit flags (--root, --mode=audit)
// supported by the refactored scripts.
const AUDIT_CHECKS = Object.freeze([
  {
    id: "probe-app-config",
    label: "App config (deployment target, App Group, contract dep)",
    script: "probe-app-config.mjs",
    auditArgs: (rootDir) => ["--root", rootDir, "--mode", "audit"],
  },
  {
    id: "check-app-group-identity",
    label: "App Group identifier identity across sources",
    script: "check-app-group-identity.mjs",
    auditArgs: (rootDir) => ["--root", rootDir],
  },
  {
    id: "check-ios-gitignore",
    label: "apps/mobile/ios/ gitignored and untracked",
    script: "check-ios-gitignore.mjs",
    auditArgs: (rootDir) => ["--root", rootDir],
  },
  {
    id: "doctor",
    label: "Toolchain + project preflight",
    script: "doctor.mjs",
    auditArgs: (rootDir) => ["--root", rootDir, "--mode", "audit"],
  },
]);

async function runCheck({ script, args, scriptsDir }) {
  const scriptPath = resolve(scriptsDir, script);
  return new Promise((resolveOuter) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings=ExperimentalWarning",
        scriptPath,
        "--json",
        ...args,
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
      // Diagnostic scripts write JSON-on-stdout and exit non-zero when the
      // rolled-up status is "fail". Both signals are useful: the exit code
      // tells the caller fast, the JSON carries the per-check detail.
      let report = null;
      try {
        report = JSON.parse(stdout.trim());
      } catch {
        // Fall through; the renderer surfaces the parse failure as a
        // synthetic fail row.
      }
      resolveOuter({ exitCode: code ?? 1, report, stdout, stderr });
    });
  });
}

/**
 * Audit a foreign Expo project against the Mobile Surfaces trap catalog.
 * Returns an AuditReport: a structured aggregate the CLI renders into
 * pretty rows or emits as JSON.
 *
 * Schema of the returned object:
 *
 *   {
 *     rootDir: string,
 *     checks: Array<{
 *       id: string,
 *       label: string,
 *       report: DiagnosticReport | null,
 *       error?: string,
 *     }>,
 *     summary: { pass: number, warn: number, fail: number },
 *   }
 *
 * @param {{ rootDir?: string }} [options]
 */
export async function audit({ rootDir = process.cwd() } = {}) {
  const root = resolve(rootDir);
  const scriptsDir = locateRepoScripts();
  if (!scriptsDir) {
    throw new Error(
      "Could not locate Mobile Surfaces gate scripts. Run `mobile-surfaces audit` from inside the monorepo checkout (or install the workspace).",
    );
  }
  const checkResults = [];
  for (const cfg of AUDIT_CHECKS) {
    const args = cfg.auditArgs(root);
    const { report, exitCode, stderr } = await runCheck({
      script: cfg.script,
      args,
      scriptsDir,
    });
    if (!report) {
      checkResults.push({
        id: cfg.id,
        label: cfg.label,
        report: null,
        error: `Check exited ${exitCode} with no parseable DiagnosticReport. stderr: ${stderr.trim().slice(0, 400)}`,
      });
      continue;
    }
    checkResults.push({
      id: cfg.id,
      label: cfg.label,
      report,
    });
  }
  return {
    rootDir: root,
    checks: checkResults,
    summary: summarize(checkResults),
  };
}

function summarize(checkResults) {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const result of checkResults) {
    if (!result.report) {
      fail += 1;
      continue;
    }
    for (const check of result.report.checks) {
      if (check.status === "ok") pass += 1;
      else if (check.status === "warn") warn += 1;
      else if (check.status === "fail") fail += 1;
      // "skip" rows don't roll up to any bucket.
    }
  }
  return { pass, warn, fail };
}

/**
 * Lookup helper exposed for the CLI renderer. Resolves an MS-id to the
 * canonical docsUrl from `@mobile-surfaces/traps`. Returns undefined when
 * the id is not in the runtime bundle (deprecated/retired ids).
 */
export function docsUrlForTrapId(trapId) {
  if (!trapId) return undefined;
  return findTrap(trapId)?.docsUrl;
}
