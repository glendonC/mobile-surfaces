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
import { detectPackageManager } from "./package-manager.mjs";
import { detectWorkspace, parsePnpmWorkspaceGlobs } from "./workspace.mjs";

// Re-exported for tests and any callers that want the YAML parser directly.
// New code should import from ./workspace.mjs.
export { parsePnpmWorkspaceGlobs };

// Re-exported so existing callers that grouped detection + presentation
// imports from mode.mjs keep working. New code should import directly from
// ./refuse.mjs.
export { renderRefuse } from "./refuse.mjs";

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
  //
  // Decision tree, in precedence order:
  //   1. Workspace + no Expo + no apps/mobile/  -> EXISTING_MONOREPO_NO_EXPO
  //   2. Otherwise, an explicit targetName       -> GREENFIELD (sibling project)
  //   3. Empty cwd                               -> GREENFIELD (in place)
  //   4. No package.json (or invalid JSON)       -> EXISTING_NON_EXPO (refuse)
  //   5. Expo dep present                        -> EXISTING_EXPO
  //   6. apps/mobile/ exists                     -> EXISTING_NON_EXPO (refuse)
  //   7. Fallback                                -> EXISTING_NON_EXPO (refuse)
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

  // One readdir instead of three existsSync probes. Picks the first config in
  // priority order (json > ts > js) — matching how Expo itself resolves
  // app.config.* — without three separate stat syscalls.
  const cwdEntries = new Set(safeReaddir(cwd));
  if (cwdEntries.has("app.json")) {
    evidence.config = readJsonConfig(path.join(cwd, "app.json"));
  } else if (cwdEntries.has("app.config.ts")) {
    evidence.config = { kind: "ts", path: path.join(cwd, "app.config.ts") };
  } else if (cwdEntries.has("app.config.js")) {
    evidence.config = { kind: "js", path: path.join(cwd, "app.config.js") };
  }

  if (evidence.config?.parsed) {
    evidence.pluginsPresent = (evidence.config.parsed.plugins ?? []).map((p) =>
      Array.isArray(p) ? p[0] : p,
    );
  }

  return evidence;
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
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

