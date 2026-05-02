#!/usr/bin/env node
// Reports environment state needed to diagnose APNs and toolchain issues.
// Designed to be safe to paste into a public GitHub issue: every value
// routes through scripts/lib/redact.mjs and APNs auth values are reported
// only as boolean presence ("set" | "unset"). Never logs secret values.
//
// Standalone in --json mode; aggregated by scripts/diagnose.mjs.
import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import os from "node:os";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import { envPresence, redactHomePath } from "./lib/redact.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "probe-environment";
const REQUIRED_APNS = [
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_BUNDLE_ID",
  "APNS_KEY_PATH",
];

const checks = [];

// --- APNs config presence -----------------------------------------------
const apnsPresence = REQUIRED_APNS.map((name) => ({
  name,
  status: envPresence(name),
}));
const missing = apnsPresence.filter((p) => p.status === "unset").map((p) => p.name);
checks.push({
  id: "apns-env-vars",
  status: missing.length === 0 ? "ok" : "fail",
  trapId: "MS028",
  summary:
    missing.length === 0
      ? "All four APNs auth env vars are set."
      : `${missing.length} of 4 APNs auth env var${missing.length === 1 ? " is" : "s are"} unset.`,
  detail: {
    issues: apnsPresence.map((p) => ({
      path: p.name,
      message: p.status,
    })),
  },
});

// --- APNs key file existence (presence + permissions only) --------------
const keyPath = process.env.APNS_KEY_PATH;
if (typeof keyPath === "string" && keyPath.trim().length > 0) {
  const resolved = resolve(keyPath);
  const exists = existsSync(resolved);
  const stat = exists ? statSync(resolved) : null;
  const isFile = !!stat && stat.isFile();
  const sizeOk = !!stat && stat.size >= 200 && stat.size <= 4096;
  checks.push({
    id: "apns-key-path",
    status: exists && isFile && sizeOk ? "ok" : "fail",
    trapId: "MS028",
    summary: !exists
      ? `APNS_KEY_PATH does not point at an existing file (${redactHomePath(resolved)}).`
      : !isFile
        ? `APNS_KEY_PATH is not a regular file (${redactHomePath(resolved)}).`
        : !sizeOk
          ? `APNS_KEY_PATH file size is unusual; .p8 keys are typically 200–400 bytes.`
          : `APNS_KEY_PATH points at a readable .p8 file (${stat.size} bytes).`,
    detail: { paths: [redactHomePath(resolved)] },
  });
}

// --- Runtime toolchain --------------------------------------------------
const nodeMajor = Number(process.versions.node.split(".")[0]);
checks.push({
  id: "node-version",
  status: nodeMajor === 24 ? "ok" : "warn",
  trapId: "MS010",
  summary: `Node ${process.versions.node}${nodeMajor === 24 ? "" : " (target: 24.x)"}`,
});

const pnpmVersion = (() => {
  try {
    return execFileSync("pnpm", ["-v"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
})();
checks.push({
  id: "pnpm-version",
  status: pnpmVersion ? "ok" : "warn",
  trapId: "MS010",
  summary: pnpmVersion ? `pnpm ${pnpmVersion}` : "pnpm not on PATH.",
});

// --- Host OS -------------------------------------------------------------
const platform = os.platform();
checks.push({
  id: "host-os",
  status: platform === "darwin" ? "ok" : "warn",
  summary:
    platform === "darwin"
      ? `Host: ${platform} ${os.release()} (${os.arch()})`
      : `Host: ${platform} (${os.arch()}) — Mobile Surfaces requires macOS for iOS builds.`,
});

// --- CI context (informational) -----------------------------------------
const ciFlags = ["CI", "GITHUB_ACTIONS"].filter(
  (name) => typeof process.env[name] === "string" && process.env[name].length > 0,
);
checks.push({
  id: "ci-context",
  status: "ok",
  summary:
    ciFlags.length === 0
      ? "Running outside CI."
      : `Running in CI: ${ciFlags.join(", ")}.`,
});

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
