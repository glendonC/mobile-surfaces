#!/usr/bin/env node
// Toolchain + project preflight. Catches the setup mistakes that produce the
// most confusing downstream errors: wrong Node major, missing pnpm, Xcode
// older than the row in https://mobile-surfaces.com/docs/compatibility, missing simulator, and
// app.json placeholders that block device builds. Direct port of the prior
// scripts/doctor.sh; emits a DiagnosticReport so the surface:diagnose
// bundle and any AI tooling can consume the results structurally.
//
// MS010 covers the toolchain-row constraint; MS025 covers App Group
// declaration in app.json.
//
// Phase 6 (refactor/v7): exposes a rootDir-parameterised core function so
// the `mobile-surfaces audit` subcommand can run the doctor checks against
// a foreign project. CLI behavior preserved when invoked without --root.
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import {
  discoverAppConfig,
  loadAppJson,
  readAppGroups,
  readAppleTeamId,
} from "./lib/app-config.mjs";
import { loadToolchainMinimums } from "./lib/toolchain-minimums.mjs";

const TOOL = "doctor";

/**
 * Run the doctor checks against a project rooted at `rootDir`. When
 * `mode === "audit"` the app.json location is discovered (root-shaped or
 * monorepo-shaped); otherwise the canonical apps/mobile/ layout is used.
 *
 * Pure: no process.exit, no console output. Callers feed the returned
 * report through emitDiagnosticReport.
 *
 * @param {{ rootDir?: string, mode?: "in-tree" | "audit", device?: string }} [options]
 */
export function runDoctor({
  rootDir = process.cwd(),
  mode = "in-tree",
  device,
} = {}) {
  const root = resolve(rootDir);
  // Toolchain minimums come from the root package.json `mobileSurfaces` block
  // (the single source of truth). The fallback numbers here are defensive only;
  // the field is expected to be present.
  const minimums = loadToolchainMinimums();
  const REQUIRED_NODE_MAJOR = minimums.node ?? 24;
  const REQUIRED_XCODE_MAJOR = minimums.xcode ?? 26;
  const DEFAULT_DEVICE = device ?? process.env.DEVICE ?? "iPhone 17 Pro";

  const checks = [];

  // --- Node ----------------------------------------------------------------
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    id: "node-version",
    status: nodeMajor === REQUIRED_NODE_MAJOR ? "ok" : "fail",
    trapId: "MS010",
    summary:
      nodeMajor === REQUIRED_NODE_MAJOR
        ? `Node ${process.versions.node}`
        : `Node ${process.versions.node}: expected major ${REQUIRED_NODE_MAJOR}.`,
    ...(nodeMajor === REQUIRED_NODE_MAJOR
      ? {}
      : {
          detail: {
            message:
              "Switch via your version manager: `nvm install 24 && nvm use`, `mise use node@24`, `fnm install 24 && fnm use 24`, or `brew install node@24`.",
          },
        }),
  });

  // --- pnpm ----------------------------------------------------------------
  const pnpmVersion = tryRun("pnpm", ["-v"]);
  checks.push({
    id: "pnpm",
    status: pnpmVersion.ok ? "ok" : "fail",
    trapId: "MS010",
    summary: pnpmVersion.ok
      ? `pnpm ${pnpmVersion.value.trim()}`
      : "pnpm is not installed or not on PATH.",
    ...(pnpmVersion.ok
      ? {}
      : {
          detail: {
            message: "Install via Corepack: `corepack enable pnpm`.",
          },
        }),
  });

  // --- xcodebuild ----------------------------------------------------------
  const xcodebuildVersion = tryRun("xcodebuild", ["-version"]);
  if (!xcodebuildVersion.ok) {
    checks.push({
      id: "xcodebuild",
      status: "fail",
      trapId: "MS010",
      summary: "xcodebuild is not on PATH.",
      detail: {
        message: "Install Xcode and run: `sudo xcodebuild -runFirstLaunch`.",
      },
    });
  } else {
    const firstLine = xcodebuildVersion.value.split("\n")[0] ?? "";
    const majorMatch = firstLine.match(/^Xcode\s+(\d+)/);
    const major = majorMatch ? Number(majorMatch[1]) : NaN;
    const ok = Number.isFinite(major) && major >= REQUIRED_XCODE_MAJOR;
    checks.push({
      id: "xcodebuild",
      status: ok ? "ok" : "fail",
      trapId: "MS010",
      summary: ok
        ? firstLine
        : `${firstLine} is below the required Xcode ${REQUIRED_XCODE_MAJOR}.`,
      ...(ok
        ? {}
        : {
            detail: {
              message:
                "Update Xcode via the Mac App Store before running iOS prebuild or device builds.",
            },
          }),
    });
  }

  // --- xcrun ---------------------------------------------------------------
  const xcrunVersion = tryRun("xcrun", ["--version"]);
  checks.push({
    id: "xcrun",
    status: xcrunVersion.ok ? "ok" : "fail",
    trapId: "MS010",
    summary: xcrunVersion.ok
      ? `xcrun ${xcrunVersion.value.trim().split("\n")[0]}`
      : "xcrun is not on PATH.",
    ...(xcrunVersion.ok
      ? {}
      : {
          detail: { message: "Install Xcode command line tools." },
        }),
  });

  // --- Simulator -----------------------------------------------------------
  if (xcrunVersion.ok) {
    const simctl = tryRun("xcrun", ["simctl", "list", "devices", "available"]);
    if (!simctl.ok) {
      checks.push({
        id: "simulator",
        status: "warn",
        trapId: "MS010",
        summary: "Could not query iOS simulators.",
        detail: { message: simctl.error },
      });
    } else {
      const found = simctl.value.includes(DEFAULT_DEVICE);
      checks.push({
        id: "simulator",
        status: found ? "ok" : "warn",
        trapId: "MS010",
        summary: found
          ? `Simulator: ${DEFAULT_DEVICE} available`
          : `Simulator: ${DEFAULT_DEVICE} not found.`,
        ...(found
          ? {}
          : {
              detail: {
                message: `Set DEVICE="<simulator name>" when running pnpm mobile:sim, or install ${DEFAULT_DEVICE} via Xcode → Settings → Components.`,
              },
            }),
      });
    }
  }

  // --- app.json: Team ID + App Groups -------------------------------------
  let appJsonPath;
  if (mode === "audit") {
    const discovery = discoverAppConfig(root);
    appJsonPath = discovery.found ? discovery.appJsonPath : null;
  } else {
    appJsonPath = join(root, "apps/mobile/app.json");
  }
  if (!appJsonPath) {
    checks.push({
      id: "app-json-present",
      status: "skip",
      summary: `No Expo app.json found under ${root}; skipping Team ID and App Group checks.`,
    });
    return buildReport(TOOL, checks);
  }
  const appJsonResult = loadAppJson(appJsonPath);
  if (appJsonResult.status === "invalid") {
    checks.push({
      id: "app-json-parse",
      status: "fail",
      summary: `${appJsonPath} is not valid JSON.`,
      detail: { message: appJsonResult.error },
    });
  } else if (appJsonResult.status === "ok") {
    const { appJson } = appJsonResult;
    const teamId = readAppleTeamId(appJson);
    if (!teamId) {
      checks.push({
        id: "apple-team-id",
        status: "warn",
        summary: "Apple Team ID not set.",
        detail: {
          message:
            "Add expo.ios.appleTeamId to apps/mobile/app.json before running expo run:ios --device.",
        },
      });
    } else if (teamId === "XXXXXXXXXX") {
      checks.push({
        id: "apple-team-id",
        status: "warn",
        summary: "Apple Team ID is the placeholder value.",
        detail: {
          message:
            "Replace expo.ios.appleTeamId with your 10-character team id (Xcode → Signing & Capabilities → Team, or developer.apple.com → Membership).",
        },
      });
    } else {
      checks.push({
        id: "apple-team-id",
        status: "ok",
        summary: `Apple Team ID: ${teamId}`,
      });
    }

    const { declared, groups } = readAppGroups(appJson);
    checks.push({
      id: "app-groups",
      status: declared ? "ok" : "fail",
      trapId: "MS025",
      summary: declared
        ? `App Groups: ${groups.join(", ")}`
        : "App Groups not declared in app.json.",
      ...(declared
        ? {}
        : {
            detail: {
              message:
                "Add expo.ios.entitlements['com.apple.security.application-groups'] so widgets and controls can share state with the host app.",
            },
          }),
    });
  } else {
    // status === "missing"
    checks.push({
      id: "app-json-present",
      status: "skip",
      summary: `${appJsonPath} not found; skipping Team ID and App Group checks.`,
    });
  }

  return buildReport(TOOL, checks);
}

function tryRun(cmd, args) {
  try {
    const value = execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      value: "",
      error: error?.message ?? String(error),
    };
  }
}

const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectInvocation) {
  const { values } = parseArgs({
    options: {
      json: { type: "boolean", default: false },
      root: { type: "string" },
      mode: { type: "string" },
    },
  });
  const report = runDoctor({
    rootDir: values.root ?? process.cwd(),
    mode: values.mode === "audit" ? "audit" : "in-tree",
  });
  emitDiagnosticReport(report, { json: values.json });
}
