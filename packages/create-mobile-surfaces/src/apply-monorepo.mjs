// Apply phase for the existing-monorepo-no-Expo mode. Materializes the
// template's apps/mobile/ subtree into the host workspace, rewrites the
// bundled "MobileSurfaces" identity to the user's identity in place, and
// merges the apps/* glob into the host's workspace declaration.
//
// Pure-ish helpers (substitution list, content rewrite, package.json patch)
// are split out from the orchestrator so they're easy to unit-test without
// filesystem fixtures.

import fs from "node:fs";
import path from "node:path";
import * as logger from "./logger.mjs";
import { prepareSourceTree, runInstall } from "./scaffold.mjs";
import { applyStripWidgetDir, stripMarkersInTree } from "./strip.mjs";
import { toSwiftPrefix } from "./validators.mjs";

// Mirrors scripts/rename-starter.mjs DEFAULT_IDENTITY. Kept small so any
// monorepo-mode rewrite stays in lockstep with the canonical rename script.
// MS005 (validator regex parity) covers the validator side; if these literals
// drift, the failure mode is a half-renamed apps/mobile/ tree at the user.
export const DEFAULT_IDENTITY = Object.freeze({
  name: "Mobile Surfaces",
  scheme: "mobilesurfaces",
  bundleId: "com.example.mobilesurfaces",
  widgetTarget: "MobileSurfacesWidget",
  swiftPrefix: "MobileSurfaces",
  slug: "mobile-surfaces",
  appPackageName: "mobile-surfaces-app",
});

// Order matters: longest/most-specific first so shorter matches don't clobber
// pieces of a longer one (e.g. "MobileSurfacesWidget" before "MobileSurfaces",
// and "com.example.mobilesurfaces" before "mobilesurfaces"). Same ordering
// rule the rename-starter script applies.
//
// Each entry is { kind: "literal" | "regex", from, to }. The slug entry uses
// a regex with a negative lookbehind so `@mobile-surfaces/foo` (the npm scope
// of our published packages) is not rewritten. In greenfield the workspace
// siblings get renamed in lockstep so a literal substitution is safe; in
// monorepo-no-Expo the user installs @mobile-surfaces/* from npm and those
// names must stay intact.
export function buildIdentitySubstitutions(newIdentity, current = DEFAULT_IDENTITY) {
  const slugRegex = new RegExp(
    `(?<!@)${escapeRegex(current.slug)}`,
    "g",
  );
  return [
    { kind: "literal", from: current.bundleId, to: newIdentity.bundleId },
    { kind: "literal", from: current.name, to: newIdentity.name },
    { kind: "literal", from: current.widgetTarget, to: newIdentity.widgetTarget },
    { kind: "literal", from: current.swiftPrefix, to: newIdentity.swiftPrefix },
    { kind: "literal", from: current.appPackageName, to: newIdentity.appPackageName },
    { kind: "regex", from: slugRegex, to: newIdentity.slug },
    { kind: "literal", from: current.scheme, to: newIdentity.scheme },
  ];
}

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".mdx",
  ".swift", ".m", ".h", ".mm",
  ".plist", ".entitlements",
  ".yaml", ".yml",
  ".sh",
]);
const TEXT_BASENAMES = new Set([".gitignore", ".env.example"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  // CNG regenerates ios/ on prebuild; rewriting it would be wiped out.
  "ios",
  "Pods",
  "dist",
  "build",
  ".expo",
  ".turbo",
]);

function walkTextFiles(rootDir) {
  const out = [];
  walk(rootDir, "");
  return out;

  function walk(absDir, relDir) {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(absDir, entry.name), childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_EXTS.has(ext) || TEXT_BASENAMES.has(entry.name)) {
        out.push(childRel);
      }
    }
  }
}

// Apply substitutions to every text file under rootDir. Returns count of
// files actually rewritten. No git, no logging — pure I/O so it's safe to
// run inside a task wrapper.
export function applyIdentityRewrites({ rootDir, substitutions }) {
  let touched = 0;
  for (const rel of walkTextFiles(rootDir)) {
    const abs = path.join(rootDir, rel);
    const original = fs.readFileSync(abs, "utf8");
    const updated = applySubstitutionsToString(original, substitutions);
    if (updated !== original) {
      fs.writeFileSync(abs, updated);
      touched += 1;
    }
  }
  return touched;
}

// Apply every substitution in one pass over the input where possible. The
// literal entries collapse into a single alternation regex so the engine
// walks the string once and picks the longest-prefix match at each position
// (alternation is left-to-right, so the input order — most-specific first —
// is preserved). Regex entries stay one-pass-each because they encode their
// own context (negative lookbehinds, character classes, etc.) that does not
// compose cleanly with literal alternation.
//
// Replaces the previous per-substitution split/join loop, which scanned and
// re-allocated the full string once per literal. For a typical apps/mobile
// rewrite with 6 literals + 1 regex, that was 7 passes; this is 2.
export function applySubstitutionsToString(input, substitutions) {
  if (substitutions.length === 0) return input;
  const literals = substitutions.filter(
    (sub) => sub.kind === "literal" && sub.from !== sub.to,
  );
  let out = input;
  if (literals.length > 0) {
    const lookup = new Map(literals.map((sub) => [sub.from, sub.to]));
    const pattern = new RegExp(
      literals.map((sub) => escapeRegex(sub.from)).join("|"),
      "g",
    );
    out = out.replace(pattern, (match) => lookup.get(match) ?? match);
  }
  for (const sub of substitutions) {
    if (sub.kind === "regex") {
      out = out.replace(sub.from, sub.to);
    }
  }
  return out;
}

// File renames for the widget target dir's swift sources. Mirrors the
// rename targets in scripts/rename-starter.mjs, scoped to apps/mobile/ since
// that's the only subtree we're scaffolding.
export function applyIdentityFileRenames({ appsMobileRoot, current, next }) {
  if (current.swiftPrefix === next.swiftPrefix) return [];
  const widgetDir = path.join(appsMobileRoot, "targets", "widget");
  const sharedDir = path.join(widgetDir, "_shared");
  const candidates = [
    path.join(widgetDir, `${current.swiftPrefix}ActivityAttributes.swift`),
    path.join(widgetDir, `${current.swiftPrefix}ControlWidget.swift`),
    path.join(widgetDir, `${current.swiftPrefix}HomeWidget.swift`),
    path.join(widgetDir, `${current.swiftPrefix}LiveActivity.swift`),
    path.join(widgetDir, `${current.swiftPrefix}WidgetBundle.swift`),
    path.join(sharedDir, `${current.swiftPrefix}ControlIntents.swift`),
    path.join(sharedDir, `${current.swiftPrefix}SharedState.swift`),
  ];
  const renamed = [];
  for (const fromPath of candidates) {
    if (!fs.existsSync(fromPath)) continue;
    const dir = path.dirname(fromPath);
    const base = path.basename(fromPath);
    const newBase = base.replace(
      new RegExp(`^${escapeRegex(current.swiftPrefix)}`),
      next.swiftPrefix,
    );
    if (newBase === base) continue;
    const toPath = path.join(dir, newBase);
    fs.renameSync(fromPath, toPath);
    renamed.push({ from: fromPath, to: toPath });
  }
  return renamed;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Replace workspace:* / file: refs to @mobile-surfaces/* in the freshly-
// scaffolded apps/mobile/package.json with concrete npm versions from the
// manifest. The host has no pnpm-lock.yaml from the template, so workspace
// refs would fail to resolve at install time.
export function rewriteAppsMobileWorkspaceDeps({ appsMobileRoot, manifest }) {
  const pkgPath = path.join(appsMobileRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const versionByName = new Map();
  for (const entry of manifest.addPackages ?? []) {
    if (!entry.workspace && entry.version && entry.version !== "latest") {
      versionByName.set(entry.name, entry.version);
    }
  }

  let rewrote = 0;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, current] of Object.entries(deps)) {
      if (!name.startsWith("@mobile-surfaces/")) continue;
      if (typeof current !== "string") continue;
      const isLocal = current.startsWith("workspace:") || current.startsWith("file:");
      if (!isLocal) continue;
      const replacement = versionByName.get(name);
      if (!replacement) continue;
      deps[name] = replacement;
      rewrote += 1;
    }
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return { rewrote };
}

// Patch app.json with the user's identity values. The template's app.json
// already has the right shape; we just write user-supplied scheme/bundleId/
// teamId on top. Identity rewrite handled separately because app.json values
// are not always exact "MobileSurfaces"/"mobile-surfaces" literals (the
// scheme is a derived camel-collapse of the slug, etc.).
export function patchAppsMobileAppJson({
  appsMobileRoot,
  config,
  appGroup,
}) {
  const p = path.join(appsMobileRoot, "app.json");
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const expo = (j.expo = j.expo ?? {});
  expo.name = config.projectName;
  expo.slug = config.projectName;
  expo.scheme = config.scheme;
  expo.ios = expo.ios ?? {};
  expo.ios.bundleIdentifier = config.bundleId;
  if (config.teamId) {
    expo.ios.appleTeamId = config.teamId;
  } else if (expo.ios.appleTeamId === "XXXXXXXXXX") {
    // Mirror the greenfield behavior: when no team id is provided, drop the
    // upstream placeholder so expo's own missing-team-id error surfaces
    // instead of an opaque signing failure.
    delete expo.ios.appleTeamId;
  }
  if (config.newArchEnabled !== undefined) {
    expo.newArchEnabled = config.newArchEnabled;
  }
  if (appGroup) {
    expo.ios.entitlements = expo.ios.entitlements ?? {};
    expo.ios.entitlements["com.apple.security.application-groups"] = [appGroup];
  }
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
}

// Ensure the host's workspace declaration includes "apps/*" (so apps/mobile/
// is picked up). Returns { changed, kind, addedGlobs }. Pure for the
// package-json case; the pnpm-workspace case writes YAML in place since we
// don't pull a YAML library.
export function mergeWorkspaceGlobs({ workspace, requiredGlobs = ["apps/*"] }) {
  const missing = requiredGlobs.filter((g) => !workspace.globs.includes(g));
  if (missing.length === 0) {
    return { changed: false, kind: workspace.kind, addedGlobs: [] };
  }

  if (workspace.kind === "pnpm-workspace") {
    const yaml = fs.readFileSync(workspace.path, "utf8");
    const updated = appendPnpmGlobs(yaml, missing);
    fs.writeFileSync(workspace.path, updated);
    return { changed: true, kind: "pnpm-workspace", addedGlobs: missing };
  }

  // package.json workspaces — caller passes the package.json path on
  // workspace.packageJsonPath since `path` is null for this kind.
  const pkgPath = workspace.packageJsonPath;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (Array.isArray(pkg.workspaces)) {
    pkg.workspaces = [...pkg.workspaces, ...missing];
  } else if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
    pkg.workspaces.packages = [...pkg.workspaces.packages, ...missing];
  } else {
    pkg.workspaces = [...missing];
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return { changed: true, kind: "package-json", addedGlobs: missing };
}

// Append entries to the `packages:` list of a pnpm-workspace.yaml, preserving
// surrounding lines. Falls back to a brand-new `packages:` block when the
// file has none.
export function appendPnpmGlobs(yaml, globsToAdd) {
  const lines = yaml.split(/\r?\n/);
  const trailingNewline = yaml.endsWith("\n");
  const formatted = globsToAdd.map((g) => `  - "${g}"`);

  let packagesIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^packages\s*:/.test(lines[i])) {
      packagesIdx = i;
      break;
    }
  }
  if (packagesIdx === -1) {
    const out = [...lines];
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
    out.push("packages:", ...formatted, "");
    return out.join("\n");
  }

  // Find the last list item under the packages: key.
  let lastEntry = packagesIdx;
  for (let i = packagesIdx + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].replace(/#.*$/, "").trim();
    if (trimmed === "") continue;
    if (/^\s+-/.test(lines[i])) {
      lastEntry = i;
      continue;
    }
    if (!/^\s/.test(lines[i])) break; // start of a new top-level key
  }

  const result = [
    ...lines.slice(0, lastEntry + 1),
    ...formatted,
    ...lines.slice(lastEntry + 1),
  ];
  let out = result.join("\n");
  if (trailingNewline && !out.endsWith("\n")) out += "\n";
  return out;
}

// Top-level orchestration. Mirrors apply-existing.mjs's applyToExisting in
// shape: produces a summary object the success renderer consumes; followups
// accumulate as we go.
export async function applyMonorepo({
  evidence,
  config,
  manifest,
  packageManager,
}) {
  const followups = [];
  const summary = {
    target: evidence.cwd,
    appsMobileRoot: path.join(evidence.cwd, "apps", "mobile"),
    appsMobileCreated: false,
    workspaceMerged: null, // { changed, kind, addedGlobs }
    appJsonPatched: false,
    workspaceDepsRewrote: 0,
    identityFilesTouched: 0,
    identityFilesRenamed: 0,
    surfacesStripped: false,
    installed: false,
    prebuilt: false,
    followups,
  };

  // 1) Stage the template, copy apps/mobile/ into the host. We deliberately
  //    skip packages/* and root files: the user already has a workspace and
  //    we don't want to clobber their lint/tsconfig/pnpm-workspace surface.
  const source = await prepareSourceTree();
  try {
    const sourceAppsMobile = path.join(source.rootDir, "apps", "mobile");
    if (!fs.existsSync(sourceAppsMobile)) {
      throw new Error(`Template missing apps/mobile/ at ${sourceAppsMobile}.`);
    }
    fs.mkdirSync(path.dirname(summary.appsMobileRoot), { recursive: true });
    fs.cpSync(sourceAppsMobile, summary.appsMobileRoot, { recursive: true });
    summary.appsMobileCreated = true;
    logger.header(`copy apps/mobile → ${summary.appsMobileRoot}`);
  } finally {
    source.cleanup();
  }

  // 2) Strip surface markers + delete deselected widget files. Runs before
  //    the identity rename so the deletion paths still match the bundled
  //    "MobileSurfaces*" basenames. Two passes: widget-dir for file deletes
  //    (those paths only make sense relative to the widget dir), then a
  //    wider marker pass so harness sources in apps/mobile/src/ also get
  //    their SURFACE-BEGIN/END comments stripped.
  const surfaces = config.surfaces ?? { homeWidget: true, controlWidget: true };
  applyStripWidgetDir({
    widgetDir: path.join(summary.appsMobileRoot, "targets", "widget"),
    surfaces,
  });
  stripMarkersInTree({ rootDir: summary.appsMobileRoot, surfaces });
  summary.surfacesStripped = true;

  // 3) Rewrite identity in the freshly-copied apps/mobile/ subtree. Two
  //    passes: text content (substitutions) and Swift filename renames.
  const newIdentity = {
    name: config.projectName,
    scheme: config.scheme,
    bundleId: config.bundleId,
    widgetTarget: `${toSwiftPrefix(config.projectName)}Widget`,
    swiftPrefix: toSwiftPrefix(config.projectName),
    slug: config.projectName,
    appPackageName: `${config.projectName}-app`,
  };
  const subs = buildIdentitySubstitutions(newIdentity);
  summary.identityFilesTouched = applyIdentityRewrites({
    rootDir: summary.appsMobileRoot,
    substitutions: subs,
  });
  const renamed = applyIdentityFileRenames({
    appsMobileRoot: summary.appsMobileRoot,
    current: DEFAULT_IDENTITY,
    next: newIdentity,
  });
  summary.identityFilesRenamed = renamed.length;

  // 4) Patch app.json — explicit values for scheme/bundleId/teamId/appGroup.
  //    Identity rewrite already updated literal occurrences, but app.json's
  //    derived appGroup ("group.<bundleId>") needs to match the new bundleId
  //    exactly, and the team id is a brand-new field the rewrite never sees.
  const appGroup = `group.${config.bundleId}`;
  patchAppsMobileAppJson({
    appsMobileRoot: summary.appsMobileRoot,
    config,
    appGroup,
  });
  summary.appJsonPatched = true;

  // 5) Rewrite apps/mobile/package.json workspace:* @mobile-surfaces/* deps
  //    to npm versions from the manifest.
  const depResult = rewriteAppsMobileWorkspaceDeps({
    appsMobileRoot: summary.appsMobileRoot,
    manifest,
  });
  summary.workspaceDepsRewrote = depResult.rewrote;

  // 6) Merge "apps/*" into the host's workspace declaration so apps/mobile/
  //    is picked up by the host's package manager.
  const workspace = {
    kind: evidence.workspaceKind,
    path: evidence.workspacePath,
    globs: evidence.workspaceGlobs,
    packageJsonPath: path.join(evidence.cwd, "package.json"),
  };
  summary.workspaceMerged = mergeWorkspaceGlobs({ workspace });

  // Followups for things we deliberately left to the user.
  followups.push(
    "We didn't touch your root package.json, tsconfig.json, eslint, or prettier configs. Adjust those if you want apps/mobile/ to share them.",
  );

  return summary;
}

// Run install + prebuild. Split from applyMonorepo so the task runner can
// give each its own spinner with elapsed-time stamp.
export async function runMonorepoInstall({ evidence, packageManager }) {
  await runInstall({ target: evidence.cwd, packageManager });
}
