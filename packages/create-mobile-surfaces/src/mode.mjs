// First decision the CLI makes: are we creating a new project, adding to an
// existing Expo project, or looking at something we can't help with? Returns
// the kind plus enough evidence for the next phase to recap and prompt
// without re-reading the same files.

import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { refuse as refuseCopy } from "./copy.mjs";

export const MODE = Object.freeze({
  GREENFIELD: "greenfield",
  EXISTING_EXPO: "existing-expo",
  EXISTING_NON_EXPO: "existing-non-expo",
});

export function detectMode({ cwd, targetName }) {
  // An explicit name is the user's "I want a new project as a sibling" gesture.
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

  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return {
      kind: MODE.EXISTING_NON_EXPO,
      evidence: { reason: "no-package-json", cwd },
    };
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return {
      kind: MODE.EXISTING_NON_EXPO,
      evidence: { reason: "invalid-package-json", cwd },
    };
  }

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if ("expo" in allDeps) {
    return {
      kind: MODE.EXISTING_EXPO,
      evidence: gatherExpoEvidence({ cwd, pkg, allDeps }),
    };
  }

  return {
    kind: MODE.EXISTING_NON_EXPO,
    evidence: {
      reason: "no-expo-dep",
      cwd,
      packageName: pkg.name ?? path.basename(cwd),
    },
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

function detectPackageManager(cwd) {
  // 1. The user-agent set by `<pm> create ...` is the strongest signal
  //    because it reflects what the user actually typed.
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm/")) return "pnpm";
  if (ua.startsWith("bun/")) return "bun";
  if (ua.startsWith("yarn/")) return "yarn";
  if (ua.startsWith("npm/")) return "npm";

  // 2. Walk up looking for a lockfile, so monorepo subdirs find the
  //    workspace's package manager.
  let dir = cwd;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
    if (fs.existsSync(path.join(dir, "bun.lockb"))) return "bun";
    if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn";
    if (fs.existsSync(path.join(dir, "package-lock.json"))) return "npm";
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
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
    default:
      body = refuseCopy.noPackageJson;
  }

  process.stdout.write("\n" + pc.yellow("▲  ") + pc.bold("Can't add Mobile Surfaces here.") + "\n\n");
  for (const line of body.split("\n")) {
    process.stdout.write(line ? "   " + line + "\n" : "\n");
  }
  process.stdout.write("\n");
}
