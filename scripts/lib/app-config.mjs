// Shared apps/mobile/app.json parsing for the check scripts. Centralises the
// "load + JSON.parse + dig out the load-bearing fields" boilerplate that
// previously lived in doctor.mjs and probe-app-config.mjs. Both scripts now
// call into this module so the access paths for App Groups, deployment
// target, Team ID, etc. only have to be right in one place.
//
// Pure: every function takes either a path (and reads the file) or an
// already-parsed appJson object. No process.exit, no console output — callers
// emit DiagnosticReport rows from the returned structured results.

import { readFileSync, existsSync } from "node:fs";

/**
 * Load and parse apps/mobile/app.json (or any path the caller supplies).
 * Returns one of three discriminated shapes so the caller can branch cleanly:
 *   { status: "missing" }                — file does not exist at path
 *   { status: "invalid", error }         — file exists but JSON.parse threw
 *   { status: "ok", appJson, path }      — parsed successfully
 *
 * @param {string} appJsonPath  Absolute path to app.json.
 */
export function loadAppJson(appJsonPath) {
  if (!existsSync(appJsonPath)) {
    return { status: "missing", path: appJsonPath };
  }
  try {
    const appJson = JSON.parse(readFileSync(appJsonPath, "utf8"));
    return { status: "ok", appJson, path: appJsonPath };
  } catch (error) {
    return {
      status: "invalid",
      path: appJsonPath,
      error: error?.message ?? String(error),
    };
  }
}

/**
 * Read the App Group entitlement array from an already-parsed app.json.
 * Returns { declared: boolean, groups: string[] }. `declared` is true only
 * when the entitlement key is present AND the value is a non-empty array.
 *
 * @param {object} appJson  Parsed contents of app.json.
 */
export function readAppGroups(appJson) {
  const groups =
    appJson?.expo?.ios?.entitlements?.["com.apple.security.application-groups"];
  if (Array.isArray(groups) && groups.length > 0) {
    return { declared: true, groups };
  }
  return { declared: false, groups: [] };
}

/**
 * Read the iOS deployment target from an already-parsed app.json, considering
 * both the explicit expo.ios.deploymentTarget and the expo-build-properties
 * plugin form. Returns the effective target string (explicit takes
 * precedence) plus the raw values so callers can distinguish sources in
 * error messages.
 *
 * @param {object} appJson  Parsed contents of app.json.
 */
export function readDeploymentTarget(appJson) {
  const explicit = appJson?.expo?.ios?.deploymentTarget ?? null;
  const buildPropsPlugin = (appJson?.expo?.plugins ?? []).find(
    (p) => Array.isArray(p) && p[0] === "expo-build-properties",
  );
  const fromBuildProps = buildPropsPlugin?.[1]?.ios?.deploymentTarget ?? null;
  const effective = explicit ?? fromBuildProps ?? null;
  return { effective, explicit, fromBuildProps };
}

/**
 * Read the Apple Team ID from an already-parsed app.json. Returns the raw
 * string (possibly empty); doctor.mjs treats the literal "XXXXXXXXXX" as the
 * placeholder shipped by the scaffold.
 *
 * @param {object} appJson  Parsed contents of app.json.
 */
export function readAppleTeamId(appJson) {
  return appJson?.expo?.ios?.appleTeamId ?? "";
}
