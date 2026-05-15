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
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "probe-app-config";
const APP_JSON_PATH = resolve("apps/mobile/app.json");
const APP_PACKAGE_JSON_PATH = resolve("apps/mobile/package.json");
const WIDGET_CONFIG_PATH = resolve(
  "apps/mobile/targets/widget/expo-target.config.js",
);

const checks = [];

if (!existsSync(APP_JSON_PATH)) {
  checks.push({
    id: "app-json-present",
    status: "skip",
    summary:
      "apps/mobile/app.json not found — running outside the starter monorepo. Skipping app/widget config probe.",
  });
  emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
}

let appJson;
try {
  appJson = JSON.parse(readFileSync(APP_JSON_PATH, "utf8"));
} catch (error) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "app-json-parse",
        status: "fail",
        summary: "apps/mobile/app.json is not valid JSON.",
        detail: { message: error?.message ?? String(error) },
      },
    ]),
    { json: values.json },
  );
}

// --- Deployment target ---------------------------------------------------
const explicitDeploymentTarget = appJson?.expo?.ios?.deploymentTarget;
const buildPropsPlugin = (appJson?.expo?.plugins ?? []).find(
  (p) => Array.isArray(p) && p[0] === "expo-build-properties",
);
const buildPropsTarget = buildPropsPlugin?.[1]?.ios?.deploymentTarget;
const effectiveTarget = explicitDeploymentTarget ?? buildPropsTarget;
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
  appPackageJson = JSON.parse(readFileSync(APP_PACKAGE_JSON_PATH, "utf8"));
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
    ? "apps/mobile/package.json declares @mobile-surfaces/surface-contracts."
    : "apps/mobile/package.json does not declare @mobile-surfaces/surface-contracts.",
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
const hostAppGroups =
  appJson?.expo?.ios?.entitlements?.["com.apple.security.application-groups"];
const hostHasGroups = Array.isArray(hostAppGroups) && hostAppGroups.length > 0;
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
if (existsSync(WIDGET_CONFIG_PATH)) {
  const widgetSrc = readFileSync(WIDGET_CONFIG_PATH, "utf8");
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
      "Widget target config (apps/mobile/targets/widget/expo-target.config.js) not found.",
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

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
