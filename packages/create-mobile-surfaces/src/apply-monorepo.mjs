// Apply phase for the existing-monorepo-no-Expo mode. Materializes the
// template's apps/mobile/ subtree into the host workspace, rewrites the
// bundled "MobileSurfaces" identity to the user's identity in place, and
// merges the apps/* glob into the host's workspace declaration.
//
// Pure-ish helpers (substitution list, content rewrite, package.json patch)
// are split out from the orchestrator so they're easy to unit-test without
// filesystem fixtures.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import * as logger from "./logger.mjs";
import { prepareSourceTree, runInstall } from "./scaffold.mjs";
import { applyStripWidgetDir, stripMarkersInTree } from "./strip.mjs";
import { toSwiftPrefix } from "./validators.mjs";
import { makeTextFileFilter, walkFiles } from "./fs-walk.mjs";

// Concurrency cap for the identity-rewrite pass. 8 keeps a 100+ file tree
// off the event loop's blocking I/O path without flooring the FD table on
// constrained CI runners. The walk itself stays synchronous (fast on
// readdirSync), only the per-file read/write fans out.
const REWRITE_CONCURRENCY = 8;

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

const IS_TEXT_FILE = makeTextFileFilter({
  textExts: TEXT_EXTS,
  textBasenames: TEXT_BASENAMES,
});

// Apply substitutions to every text file under rootDir. Returns count of
// files actually rewritten. No git, no logging — pure I/O so it's safe to
// run inside a task wrapper. Async with bounded concurrency so a 100+ file
// tree does not block the event loop while serializing read/write syscalls.
export async function applyIdentityRewrites({ rootDir, substitutions }) {
  const files = walkFiles({
    rootDir,
    skipDirs: SKIP_DIRS,
    filter: IS_TEXT_FILE,
  });
  let touched = 0;
  for (let i = 0; i < files.length; i += REWRITE_CONCURRENCY) {
    const batch = files.slice(i, i + REWRITE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (abs) => {
        const original = await fsp.readFile(abs, "utf8");
        const updated = applySubstitutionsToString(original, substitutions);
        if (updated === original) return 0;
        await fsp.writeFile(abs, updated);
        return 1;
      }),
    );
    for (const result of results) touched += result;
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
// that's the only subtree we're scaffolding. Per-directory readdir + Set
// membership avoids one stat syscall per candidate file.
export function applyIdentityFileRenames({ appsMobileRoot, current, next }) {
  if (current.swiftPrefix === next.swiftPrefix) return [];
  const widgetDir = path.join(appsMobileRoot, "targets", "widget");
  const sharedDir = path.join(widgetDir, "_shared");
  const candidatesByDir = [
    {
      dir: widgetDir,
      basenames: [
        `${current.swiftPrefix}ActivityAttributes.swift`,
        `${current.swiftPrefix}ControlWidget.swift`,
        `${current.swiftPrefix}HomeWidget.swift`,
        `${current.swiftPrefix}LiveActivity.swift`,
        `${current.swiftPrefix}WidgetBundle.swift`,
      ],
    },
    {
      dir: sharedDir,
      basenames: [
        `${current.swiftPrefix}ControlIntents.swift`,
        `${current.swiftPrefix}SharedState.swift`,
      ],
    },
  ];
  const prefixRegex = new RegExp(`^${escapeRegex(current.swiftPrefix)}`);
  const renamed = [];
  for (const { dir, basenames } of candidatesByDir) {
    let present;
    try {
      present = new Set(fs.readdirSync(dir));
    } catch (err) {
      // Directory may not exist when the user deselected a surface that
      // owned the only files under it — same outcome as the previous
      // per-file existsSync miss.
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
    for (const base of basenames) {
      if (!present.has(base)) continue;
      const newBase = base.replace(prefixRegex, next.swiftPrefix);
      if (newBase === base) continue;
      const fromPath = path.join(dir, base);
      const toPath = path.join(dir, newBase);
      fs.renameSync(fromPath, toPath);
      renamed.push({ from: fromPath, to: toPath });
    }
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

  await stageAndCopyAppsMobile({ summary });
  stripSurfacesAndMarkers({ config, summary });
  await rewriteIdentityInTree({ config, summary });
  patchAppJsonStep({ config, summary });
  rewriteWorkspaceDeps({ manifest, summary });
  mergeHostWorkspace({ evidence, summary });

  followups.push(
    "We didn't touch your root package.json, tsconfig.json, eslint, or prettier configs. Adjust those if you want apps/mobile/ to share them.",
  );

  return summary;
}

// Step 1: stage the template, copy apps/mobile/ into the host. Deliberately
// skips packages/* and root files — the user already has a workspace and we
// don't want to clobber their lint/tsconfig/pnpm-workspace surface.
async function stageAndCopyAppsMobile({ summary }) {
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
}

// Step 2: strip surface markers + delete deselected widget files. Runs before
// the identity rename so deletion paths still match the bundled "MobileSurfaces*"
// basenames. Two passes: widget-dir for file deletes (those paths only make
// sense relative to the widget dir), then a wider marker pass so harness
// sources in apps/mobile/src/ also get their SURFACE-BEGIN/END comments stripped.
function stripSurfacesAndMarkers({ config, summary }) {
  const surfaces = config.surfaces ?? {
    homeWidget: true,
    controlWidget: true,
    lockAccessoryWidget: true,
    standbyWidget: true,
  };
  applyStripWidgetDir({
    widgetDir: path.join(summary.appsMobileRoot, "targets", "widget"),
    surfaces,
  });
  stripMarkersInTree({ rootDir: summary.appsMobileRoot, surfaces });
  summary.surfacesStripped = true;
}

// Step 3: rewrite identity in the freshly-copied apps/mobile/ subtree. Two
// passes: text content (substitutions) and Swift filename renames.
async function rewriteIdentityInTree({ config, summary }) {
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
  summary.identityFilesTouched = await applyIdentityRewrites({
    rootDir: summary.appsMobileRoot,
    substitutions: subs,
  });
  const renamed = applyIdentityFileRenames({
    appsMobileRoot: summary.appsMobileRoot,
    current: DEFAULT_IDENTITY,
    next: newIdentity,
  });
  summary.identityFilesRenamed = renamed.length;
}

// Step 4: patch app.json with explicit scheme/bundleId/teamId/appGroup.
// Identity rewrite already updated literal occurrences, but app.json's
// derived appGroup ("group.<bundleId>") needs to match the new bundleId
// exactly, and the team id is a brand-new field the rewrite never sees.
function patchAppJsonStep({ config, summary }) {
  const appGroup = `group.${config.bundleId}`;
  patchAppsMobileAppJson({
    appsMobileRoot: summary.appsMobileRoot,
    config,
    appGroup,
  });
  summary.appJsonPatched = true;
}

// Step 5: rewrite apps/mobile/package.json workspace:* @mobile-surfaces/* deps
// to npm versions from the manifest.
function rewriteWorkspaceDeps({ manifest, summary }) {
  const depResult = rewriteAppsMobileWorkspaceDeps({
    appsMobileRoot: summary.appsMobileRoot,
    manifest,
  });
  summary.workspaceDepsRewrote = depResult.rewrote;
}

// Step 6: merge "apps/*" into the host's workspace declaration so apps/mobile/
// is picked up by the host's package manager.
function mergeHostWorkspace({ evidence, summary }) {
  const workspace = {
    kind: evidence.workspaceKind,
    path: evidence.workspacePath,
    globs: evidence.workspaceGlobs,
    packageJsonPath: path.join(evidence.cwd, "package.json"),
  };
  summary.workspaceMerged = mergeWorkspaceGlobs({ workspace });
}

// Run install + prebuild. Split from applyMonorepo so the task runner can
// give each its own spinner with elapsed-time stamp.
export async function runMonorepoInstall({ evidence, packageManager }) {
  await runInstall({ target: evidence.cwd, packageManager });
}
