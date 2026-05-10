// First decision the CLI makes: are we creating a new project, adding to an
// existing Expo project, or looking at something we can't help with? Returns
// the kind plus enough evidence for the next phase to recap and prompt
// without re-reading the same files.
//
// Two collaborators are factored out: workspace.mjs (pnpm-workspace.yaml +
// package.json `workspaces` parsing) and package-manager.mjs (user-agent +
// lockfile walk). Both are usable on their own without going through the
// wider mode-detection flow.

import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { refuse as refuseCopy } from "./copy.mjs";
import { detectPackageManager } from "./package-manager.mjs";
import { detectWorkspace, parsePnpmWorkspaceGlobs } from "./workspace.mjs";

// Re-exported for tests and any callers that want the YAML parser directly.
// New code should import from ./workspace.mjs.
export { parsePnpmWorkspaceGlobs };

export const MODE = Object.freeze({
  GREENFIELD: "greenfield",
  EXISTING_EXPO: "existing-expo",
  EXISTING_MONOREPO_NO_EXPO: "existing-monorepo-no-expo",
  EXISTING_NON_EXPO: "existing-non-expo",
});

export function detectMode({ cwd, targetName }) {
  // Read cwd's package.json (if any) before deciding whether targetName means
  // "new sibling project" or "name for the apps/mobile/ inside this workspace".
  // The original rule — explicit name → greenfield, full stop — broke the
  // monorepo flow because --yes always passes a name. Now: if cwd looks like
  // a workspace without Expo, an explicit name routes to monorepo mode.
  const pkgPath = path.join(cwd, "package.json");
  let pkg = null;
  let pkgErr = null;
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      pkgErr = "invalid-package-json";
    }
  }

  if (pkg) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const hasExpo = "expo" in allDeps;
    const workspace = detectWorkspace({ cwd, pkg });
    const appsMobileExists = fs.existsSync(path.join(cwd, "apps", "mobile"));

    if (workspace && !hasExpo && !appsMobileExists) {
      return {
        kind: MODE.EXISTING_MONOREPO_NO_EXPO,
        evidence: gatherMonorepoEvidence({ cwd, pkg, workspace }),
      };
    }
  }

  // An explicit name is the user's "I want a new project as a sibling" gesture
  // — but only when we haven't already detected a more specific mode above.
  // Take it at face value, even if cwd happens to be inside another project.
  if (targetName) {
    return {
      kind: MODE.GREENFIELD,
      target: path.join(cwd, targetName),
      explicitName: targetName,
    };
  }

  // No name: read cwd to figure out what the user is sitting on.
  const visibleEntries = fs
    .readdirSync(cwd)
    .filter((e) => !e.startsWith("."));
  if (visibleEntries.length === 0) {
    return { kind: MODE.GREENFIELD, target: null };
  }

  if (!pkg) {
    return {
      kind: MODE.EXISTING_NON_EXPO,
      evidence: { reason: pkgErr ?? "no-package-json", cwd },
    };
  }

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if ("expo" in allDeps) {
    return {
      kind: MODE.EXISTING_EXPO,
      evidence: gatherExpoEvidence({ cwd, pkg, allDeps }),
    };
  }

  const appsMobileExists = fs.existsSync(path.join(cwd, "apps", "mobile"));
  return {
    kind: MODE.EXISTING_NON_EXPO,
    evidence: {
      reason: appsMobileExists ? "apps-mobile-exists" : "no-expo-dep",
      cwd,
      packageName: pkg.name ?? path.basename(cwd),
    },
  };
}

function gatherMonorepoEvidence({ cwd, pkg, workspace }) {
  return {
    cwd,
    packageName: pkg.name ?? path.basename(cwd),
    packageManager: detectPackageManager(cwd),
    workspaceKind: workspace.kind,
    workspacePath: workspace.path,
    workspaceGlobs: workspace.globs,
  };
}

function gatherExpoEvidence({ cwd, pkg, allDeps }) {
  const evidence = {
    cwd,
    packageName: pkg.name ?? path.basename(cwd),
    expoVersion: allDeps.expo ?? null,
    config: null,
    packageManager: detectPackageManager(cwd),
    hasIosDir: fs.existsSync(path.join(cwd, "ios")),
    pluginsPresent: [],
  };

  const appJson = path.join(cwd, "app.json");
  const appJs = path.join(cwd, "app.config.js");
  const appTs = path.join(cwd, "app.config.ts");

  if (fs.existsSync(appJson)) {
    evidence.config = readJsonConfig(appJson);
  } else if (fs.existsSync(appTs)) {
    evidence.config = { kind: "ts", path: appTs };
  } else if (fs.existsSync(appJs)) {
    evidence.config = { kind: "js", path: appJs };
  }

  if (evidence.config?.parsed) {
    evidence.pluginsPresent = (evidence.config.parsed.plugins ?? []).map((p) =>
      Array.isArray(p) ? p[0] : p,
    );
  }

  return evidence;
}

function readJsonConfig(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const parsed = raw.expo ?? raw;
    return {
      kind: "json",
      path: filePath,
      parsed,
      appName: parsed.name ?? null,
      bundleId: parsed.ios?.bundleIdentifier ?? null,
      deploymentTarget: parsed.ios?.deploymentTarget ?? null,
    };
  } catch {
    return { kind: "json", path: filePath, parsed: null, error: "invalid-json" };
  }
}

// Render path. Each refuse reason gets a tailored screen — the value here
// is naming the user's actual situation and the smallest concrete next step.
export function renderRefuse(mode) {
  const { evidence } = mode;
  let body;
  switch (evidence.reason) {
    case "no-package-json":
      body = refuseCopy.noPackageJson;
      break;
    case "invalid-package-json":
      body = refuseCopy.invalidPackageJson(evidence.cwd);
      break;
    case "no-expo-dep":
      body = refuseCopy.noExpoDep(evidence.packageName);
      break;
    case "apps-mobile-exists":
      body = refuseCopy.appsMobileExists(evidence.packageName);
      break;
    default:
      body = refuseCopy.noPackageJson;
  }

  process.stdout.write("\n" + pc.yellow("▲  ") + pc.bold("Can't add Mobile Surfaces here.") + "\n\n");
  for (const line of body.split("\n")) {
    process.stdout.write(line ? "   " + line + "\n" : "\n");
  }
  process.stdout.write("\n");
}
