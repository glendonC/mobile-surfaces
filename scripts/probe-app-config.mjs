#!/usr/bin/env node
// Reports the static config state that drives MS012 (deployment target),
// MS013 (App Group match between host and widget), MS024 (project depends
// on @mobile-surfaces/surface-contracts), MS025 (App Group declared at
// all), MS026 (widget target managed by @bacons/apple-targets), and MS027
// (foreign Expo project iOS 17.2+; same constraint as MS012 applied at
// audit). Reads apps/mobile/app.json, apps/mobile/package.json, and
// apps/mobile/targets/widget/expo-target.config.js. Emits "skip" cleanly
// when the apps/mobile/ tree is absent so a foreign consumer running
// surface:diagnose still gets a useful bundle.
//
// Phase 6 (refactor/v7): added `rootDir` API surface so the
// `mobile-surfaces audit` subcommand can probe a foreign project without
// changing process.cwd. CLI behavior is preserved when invoked without
// --root (rootDir defaults to process.cwd()).
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import {
  discoverAppConfig,
  loadAppJson,
  readAppGroups,
  readDeploymentTarget,
} from "./lib/app-config.mjs";

const TOOL = "probe-app-config";

/**
 * Build the probe-app-config DiagnosticReport for the project rooted at
 * `rootDir`. When `mode === "audit"` the script discovers the app.json
 * location (root-shaped, monorepo-shaped, or arbitrary apps/* shape) and
 * anchors sibling paths off whatever it finds; otherwise it uses the
 * canonical apps/mobile/ layout the Mobile Surfaces starter ships.
 *
 * Pure: no process.exit, no I/O beyond the file reads. Callers feed the
 * report through emitDiagnosticReport when they want CLI output.
 *
 * @param {{ rootDir?: string, mode?: "in-tree" | "audit" }} [options]
 */
export function probeAppConfig({ rootDir = process.cwd(), mode = "in-tree" } = {}) {
  const root = resolve(rootDir);
  let appJsonPath;
  let mobileRoot;
  if (mode === "audit") {
    const discovery = discoverAppConfig(root);
    if (!discovery.found) {
      return buildReport(TOOL, [
        {
          id: "app-json-present",
          status: "fail",
          summary: `No Expo app.json found under ${root}.`,
          detail: {
            message:
              "Looked for app.json at the project root, apps/mobile/, and any apps/<dir>/ subfolder. Run mobile-surfaces audit against the directory that contains your Expo project.",
          },
        },
      ]);
    }
    appJsonPath = discovery.appJsonPath;
    mobileRoot = discovery.mobileRoot;
  } else {
    appJsonPath = resolve(root, "apps/mobile/app.json");
    mobileRoot = resolve(root, "apps/mobile");
  }
  const appPackageJsonPath = join(mobileRoot, "package.json");
  const widgetConfigPath = join(
    mobileRoot,
    "targets/widget/expo-target.config.js",
  );

  const checks = [];

  const appJsonResult = loadAppJson(appJsonPath);
  if (appJsonResult.status === "missing") {
    checks.push({
      id: "app-json-present",
      status: "skip",
      summary:
        "apps/mobile/app.json not found — running outside the starter monorepo. Skipping app/widget config probe.",
    });
    return buildReport(TOOL, checks);
  }

  if (appJsonResult.status === "invalid") {
    return buildReport(TOOL, [
      {
        id: "app-json-parse",
        status: "fail",
        summary: `${appJsonPath} is not valid JSON.`,
        detail: { message: appJsonResult.error },
      },
    ]);
  }

  const appJson = appJsonResult.appJson;

  // --- Deployment target ---------------------------------------------------
  const { effective: effectiveTarget } = readDeploymentTarget(appJson);
  const targetMeetsFloor =
    typeof effectiveTarget === "string" && parseFloat(effectiveTarget) >= 17.2;
  checks.push({
    id: "deployment-target",
    status: targetMeetsFloor ? "ok" : "fail",
    trapId: "MS012",
    summary: targetMeetsFloor
      ? `iOS deployment target ${effectiveTarget} (>= 17.2 floor).`
      : effectiveTarget
        ? `iOS deployment target ${effectiveTarget} is below the 17.2 floor required by push-to-start.`
        : "iOS deployment target not declared in app.json or expo-build-properties.",
    ...(targetMeetsFloor
      ? {}
      : {
          detail: {
            message:
              "Set expo.ios.deploymentTarget (or expo-build-properties.ios.deploymentTarget) to 17.2 and rerun prebuild.",
          },
        }),
  });

  // MS027 is the same constraint as MS012, framed as a foreign-consumer audit
  // rule. Same check, separate trap binding so a foreign project running
  // surface:diagnose sees the audit-flavored row in the report.
  checks.push({
    id: "foreign-deployment-target",
    status: targetMeetsFloor ? "ok" : "fail",
    trapId: "MS027",
    summary: targetMeetsFloor
      ? "Foreign-audit deployment-target check passes."
      : "Foreign-audit deployment-target check fails; see deployment-target row.",
  });

  // --- Contract package declared in apps/mobile/package.json (MS024) ------
  let appPackageJson = null;
  try {
    appPackageJson = JSON.parse(readFileSync(appPackageJsonPath, "utf8"));
  } catch {
    // fall through; null handled below
  }
  const declaredDeps = {
    ...(appPackageJson?.dependencies ?? {}),
    ...(appPackageJson?.peerDependencies ?? {}),
  };
  const declaresContract = "@mobile-surfaces/surface-contracts" in declaredDeps;
  checks.push({
    id: "contract-package-declared",
    status: declaresContract ? "ok" : "fail",
    trapId: "MS024",
    summary: declaresContract
      ? `${appPackageJsonPath} declares @mobile-surfaces/surface-contracts.`
      : `${appPackageJsonPath} does not declare @mobile-surfaces/surface-contracts.`,
    ...(declaresContract
      ? {}
      : {
          detail: {
            message:
              "Every layer that emits or consumes a snapshot must depend on @mobile-surfaces/surface-contracts. Add it (workspace:* in the starter monorepo, or the published version in foreign projects).",
          },
        }),
  });

  // --- App Group declared in app.json -------------------------------------
  const { declared: hostHasGroups, groups: hostAppGroups } = readAppGroups(appJson);
  checks.push({
    id: "app-group-declared",
    status: hostHasGroups ? "ok" : "fail",
    trapId: "MS025",
    summary: hostHasGroups
      ? `Host app declares App Group(s): ${hostAppGroups.join(", ")}`
      : "Host app does not declare any App Group entitlement.",
    ...(hostHasGroups
      ? {}
      : {
          detail: {
            message:
              "Add expo.ios.entitlements['com.apple.security.application-groups'] so widgets and controls can share state with the host app.",
          },
        }),
  });

  // --- Widget target App Group inheritance --------------------------------
  if (existsSync(widgetConfigPath)) {
    const widgetSrc = readFileSync(widgetConfigPath, "utf8");
    // The widget config is JS; we don't execute it (avoid arbitrary code).
    // Instead we look for the canonical inheritance pattern shipped by the
    // starter and warn if it's been replaced with a hardcoded array.
    const inheritsFromHost = /entitlements\?\.\[?\s*['"]com\.apple\.security\.application-groups['"]\s*\]?/.test(
      widgetSrc,
    );
    checks.push({
      id: "widget-app-group-inheritance",
      status: inheritsFromHost ? "ok" : "warn",
      trapId: "MS013",
      summary: inheritsFromHost
        ? "Widget target inherits App Group from host app config."
        : "Widget target's expo-target.config.js does not appear to inherit App Group from the host config; verify it matches.",
      ...(inheritsFromHost
        ? {}
        : {
            detail: {
              message:
                "The starter pattern is `config.ios?.entitlements?.['com.apple.security.application-groups'] ?? []`. Hardcoded arrays are valid but must match the host app exactly.",
            },
          }),
    });
  } else {
    checks.push({
      id: "widget-app-group-inheritance",
      status: "warn",
      trapId: "MS026",
      summary:
        "Widget target config (targets/widget/expo-target.config.js) not found.",
      detail: {
        message:
          "If you intend to ship widgets/controls, materialize the target via @bacons/apple-targets.",
      },
    });
  }

  // --- Bundle identifier sanity (MS018 — bare bundle id, no suffix) -------
  const bundleId = appJson?.expo?.ios?.bundleIdentifier;
  if (typeof bundleId === "string") {
    const hasSuffix = /\.push-type\.liveactivity$/.test(bundleId);
    checks.push({
      id: "bundle-id-shape",
      status: hasSuffix ? "fail" : "ok",
      trapId: "MS018",
      summary: hasSuffix
        ? `bundleIdentifier "${bundleId}" includes the .push-type.liveactivity suffix; the SDK appends it.`
        : `bundleIdentifier: ${bundleId}`,
    });
  }

  // --- Scheme presence (informational) ------------------------------------
  const scheme = appJson?.expo?.scheme;
  checks.push({
    id: "url-scheme",
    status: typeof scheme === "string" && scheme.length > 0 ? "ok" : "warn",
    summary:
      typeof scheme === "string" && scheme.length > 0
        ? `URL scheme: ${scheme}`
        : "expo.scheme not set; deepLink fields in fixtures may not route to your app.",
  });

  return buildReport(TOOL, checks);
}

// CLI entrypoint: only runs when this module is invoked directly. Importing
// the file from audit.mjs is a no-op beyond pulling probeAppConfig into
// scope.
import { fileURLToPath } from "node:url";
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
  const report = probeAppConfig({
    rootDir: values.root ?? process.cwd(),
    mode: values.mode === "audit" ? "audit" : "in-tree",
  });
  emitDiagnosticReport(report, { json: values.json });
}
