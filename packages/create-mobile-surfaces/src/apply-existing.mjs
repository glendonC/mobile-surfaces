// The add-to-existing-Expo *apply* phase. The detection and prompting flow
// in existing-expo.mjs produces a `plan`; this module turns that plan into
// real changes on the user's filesystem. Each operation is split so the
// task runner can wrap them in clack's tasks() with elapsed time, and the
// pure helpers (buildPatchedAppJson, renderManualSnippet, widgetCopyDecision)
// are unit-tested without filesystem I/O.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import * as logger from "./logger.mjs";
import {
  prepareSourceTree as defaultPrepareSourceTree,
  runAddPackages as defaultRunAddPackages,
} from "./scaffold.mjs";
import { applyStripWidgetDir } from "./strip.mjs";
import { toSwiftPrefix } from "./validators.mjs";
import { walkFiles } from "./fs-walk.mjs";
import { BackupSession } from "./backup.mjs";

// Lockfiles to back up alongside package.json before `pnpm add` (or
// equivalent) runs. Whichever exists at the project root gets snapshotted;
// rollback restores the manifest + lockfile so a follow-up `pnpm install`
// (or equivalent) reconverges node_modules to the pre-apply state.
const LOCKFILE_NAMES = Object.freeze([
  "pnpm-lock.yaml",
  "bun.lockb",
  "yarn.lock",
  "package-lock.json",
]);

const DEFAULT_SURFACES = Object.freeze({
  homeWidget: true,
  controlWidget: true,
  lockAccessoryWidget: true,
  standbyWidget: true,
});

// Concurrency cap for the per-file read+rewrite pass in applyWidgetRename.
// Matches apply-monorepo's identity-rewrite cap so a widget target with many
// files doesn't serialize blocking I/O on the event loop, but stays low
// enough to avoid flooring the FD table on constrained CI runners.
const REWRITE_CONCURRENCY = 8;

// Format a manifest package entry as the spec string a package manager's
// `add` subcommand expects. Workspace/file deps can't yet resolve from npm,
// so callers should filter them out via installablePackages() first.
export function formatPackageSpec({ name, version }) {
  if (!version || version === "latest" || version === "workspace") return name;
  return `${name}@${version}`;
}

/**
 * Reduce `plan.packagesToAdd` to the npm-resolvable specs a package
 * manager's `add` subcommand can install. Workspace/file refs are filtered
 * out since the user's host has no way to resolve them.
 */
export function installablePackages(plan) {
  return plan.packagesToAdd
    .filter((p) => !p.workspace)
    .map(formatPackageSpec);
}

/**
 * Apply plan plugins/infoPlist/entitlements/deploymentTarget/teamId to an
 * `app.json` string and return the new string (trailing newline). Pure - no
 * filesystem access - so it is easy to unit-test. A real existing team id
 * different from `teamId` is preserved; surfacing the conflict is the
 * orchestrator's job (see `applyToExisting`).
 * @param {{ existing: string, plan: object, teamId?: string | null }} params
 */
export function buildPatchedAppJson({ existing, plan, teamId = null }) {
  const data = JSON.parse(existing);
  const expo = (data.expo = data.expo ?? {});

  if (plan.pluginsToAdd.length > 0) {
    expo.plugins = expo.plugins ?? [];
    for (const p of plan.pluginsToAdd) {
      const entry = p.config !== undefined ? [p.name, p.config] : p.name;
      expo.plugins.push(entry);
    }
  }

  const infoPlistKeys = Object.keys(plan.infoPlistToAdd);
  const entitlementsToAdd = plan.entitlementsToAdd ?? {};
  const entitlementsKeys = Object.keys(entitlementsToAdd);
  const needsIos =
    plan.deploymentTargetTo ||
    infoPlistKeys.length > 0 ||
    entitlementsKeys.length > 0 ||
    Boolean(teamId);
  if (needsIos) expo.ios = expo.ios ?? {};

  if (plan.deploymentTargetTo) {
    expo.ios.deploymentTarget = plan.deploymentTargetTo;
  }

  if (infoPlistKeys.length > 0) {
    expo.ios.infoPlist = expo.ios.infoPlist ?? {};
    Object.assign(expo.ios.infoPlist, plan.infoPlistToAdd);
  }

  if (entitlementsKeys.length > 0) {
    expo.ios.entitlements = expo.ios.entitlements ?? {};
    Object.assign(expo.ios.entitlements, entitlementsToAdd);
  }

  if (teamId) {
    const current = expo.ios.appleTeamId;
    if (!current || current === "XXXXXXXXXX") {
      expo.ios.appleTeamId = teamId;
    }
    // If a real, different team id is already there, leave it. The caller
    // checks the same condition and surfaces a follow-up note.
  }

  return JSON.stringify(data, null, 2) + "\n";
}

/**
 * Read `appJsonPath`, apply `buildPatchedAppJson` to its contents, and
 * write the result back in place.
 */
export function patchAppJson({ appJsonPath, plan, teamId = null }) {
  const existing = fs.readFileSync(appJsonPath, "utf8");
  const patched = buildPatchedAppJson({ existing, plan, teamId });
  fs.writeFileSync(appJsonPath, patched);
}

/**
 * Render the same plan as a paste-ready JSON snippet for users whose config
 * lives in `app.config.{js,ts}` (or is missing). We refuse to rewrite user
 * code; this is the manual-followup payload the success screen prints.
 */
export function renderManualSnippet(plan, { teamId = null } = {}) {
  const snippet = {};
  if (plan.pluginsToAdd.length > 0) {
    snippet.plugins = plan.pluginsToAdd.map((p) =>
      p.config !== undefined ? [p.name, p.config] : p.name,
    );
  }
  const infoPlistKeys = Object.keys(plan.infoPlistToAdd);
  const entitlementsToAdd = plan.entitlementsToAdd ?? {};
  const entitlementsKeys = Object.keys(entitlementsToAdd);
  const needsIos =
    plan.deploymentTargetTo ||
    infoPlistKeys.length > 0 ||
    entitlementsKeys.length > 0 ||
    Boolean(teamId);
  if (needsIos) snippet.ios = {};
  if (plan.deploymentTargetTo) {
    snippet.ios.deploymentTarget = plan.deploymentTargetTo;
  }
  if (teamId) {
    snippet.ios.appleTeamId = teamId;
  }
  if (infoPlistKeys.length > 0) {
    snippet.ios.infoPlist = { ...plan.infoPlistToAdd };
  }
  if (entitlementsKeys.length > 0) {
    snippet.ios.entitlements = { ...entitlementsToAdd };
  }
  return JSON.stringify(snippet, null, 2);
}

/**
 * Resolve the directory where the widget target should land in the user's
 * project. Anchors off the app config's directory; falls back to `cwd` when
 * the project has no config file at all.
 */
export function resolveAppRoot(evidence) {
  if (evidence.config?.path) return path.dirname(evidence.config.path);
  return evidence.cwd;
}

/**
 * Decide whether copying the widget target is safe. Returns `{ kind:
 * "fresh" | "empty" | "conflict", entries? }`. We refuse to clobber an
 * existing target dir that has any contents - the user may have a different
 * widget there from another tool or a prior run.
 */
export function widgetCopyDecision({ destDir }) {
  if (!fs.existsSync(destDir)) return { kind: "fresh" };
  const entries = fs.readdirSync(destDir);
  if (entries.length === 0) return { kind: "empty" };
  return { kind: "conflict", entries };
}

/**
 * Derive a Swift-friendly prefix for the user's app from the detection
 * evidence. Prefers the Expo `name` (how the user sees the app), falls back
 * to the `package.json` name. Returns null when nothing usable is found  - 
 * callers then leave the widget files alone and surface a follow-up note.
 */
export function deriveSwiftPrefixFromEvidence(evidence) {
  if (evidence?.config?.kind === "json") {
    const expoName = evidence.config.parsed?.name;
    if (expoName && typeof expoName === "string") {
      const prefix = toSwiftPrefix(expoName);
      if (prefix) return prefix;
    }
  }
  if (evidence?.packageName && typeof evidence.packageName === "string") {
    const prefix = toSwiftPrefix(evidence.packageName);
    if (prefix) return prefix;
  }
  return null;
}

/**
 * Rewrite the just-copied widget target dir in place so the bundled
 * `MobileSurfaces*` identity becomes the user's app identity. Returns a
 * summary describing what was renamed/rewritten. Safe to rename even though
 * the published `@mobile-surfaces/live-activity` keeps its own symbol  - 
 * ActivityKit binds by ContentState/Attributes shape, not by symbol name.
 * Async with bounded per-file read concurrency so a large widget tree does
 * not serialize blocking I/O on the event loop.
 */
export async function applyWidgetRename({ destDir, swiftPrefix }) {
  if (!swiftPrefix) {
    return { renamed: false, reason: "no-swift-prefix" };
  }
  if (swiftPrefix === "MobileSurfaces") {
    // No-op: user's identity already matches the bundled one.
    return { renamed: false, reason: "already-matches" };
  }
  if (!fs.existsSync(destDir)) {
    return { renamed: false, reason: "missing-dest" };
  }

  const widgetTarget = `${swiftPrefix}Widget`;
  const TEXTY_EXTS = new Set([".swift", ".js", ".ts", ".json", ".plist", ".strings", ".md"]);

  // Walk first (sync, cheap), classify each entry, then fan out the
  // per-file reads in bounded batches. Writes/renames apply after all reads
  // resolve - keeps ordering explicit (write rewritten content first, then
  // rename) so paths collected during the walk remain valid.
  const candidates = [];
  for (const full of walkFiles({ rootDir: destDir })) {
    const dir = path.dirname(full);
    const name = path.basename(full);
    const isText = TEXTY_EXTS.has(path.extname(name).toLowerCase());
    // MobileSurfaces<Suffix>.swift → <swiftPrefix><Suffix>.swift. Only the
    // prefix at the start of the basename is rewritten so unrelated uses
    // of the literal "MobileSurfaces" string elsewhere are left alone.
    const renamed = renameWidgetFilename(name, swiftPrefix);
    const newName = renamed && renamed !== name ? renamed : undefined;
    candidates.push({ full, dir, name, isText, newName });
  }

  const ops = [];
  for (let i = 0; i < candidates.length; i += REWRITE_CONCURRENCY) {
    const batch = candidates.slice(i, i + REWRITE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (c) => {
        let newContent;
        // Only rewrite text-y files. Asset bundles (.car, images) won't
        // contain literal "MobileSurfaces" strings, but reading them as
        // utf8 is wasteful and risks false-positive substitutions.
        if (c.isText) {
          const original = await fsp.readFile(c.full, "utf8");
          const rewritten = rewriteContent({ source: original, swiftPrefix, widgetTarget });
          if (rewritten !== original) newContent = rewritten;
        }
        if (newContent === undefined && c.newName === undefined) return null;
        return { dir: c.dir, name: c.name, newContent, newName: c.newName };
      }),
    );
    for (const r of results) if (r) ops.push(r);
  }

  const filesTouched = [];
  const filesRenamed = [];
  for (const op of ops) {
    const full = path.join(op.dir, op.name);
    if (op.newContent !== undefined) {
      fs.writeFileSync(full, op.newContent);
      filesTouched.push(full);
    }
    if (op.newName !== undefined) {
      const newFull = path.join(op.dir, op.newName);
      fs.renameSync(full, newFull);
      filesRenamed.push({ from: full, to: newFull });
    }
  }

  return {
    renamed: true,
    swiftPrefix,
    widgetTarget,
    filesTouched,
    filesRenamed,
  };
}

/**
 * Pure file-content rewrite for the widget rename pass. Single regex scan;
 * the alternation order makes `MobileSurfacesWidget` match before the
 * broader `MobileSurfaces` so the widget token rewrites to `widgetTarget`
 * rather than `${swiftPrefix}Widget` (those diverge when the user picks a
 * custom widget name).
 */
export function rewriteContent({ source, swiftPrefix, widgetTarget }) {
  if (!source) return source;
  return source.replace(/MobileSurfacesWidget|MobileSurfaces/g, (match) =>
    match === "MobileSurfacesWidget" ? widgetTarget : swiftPrefix,
  );
}

// Pure filename rewrite for the widget target dir.
// MobileSurfacesActivityAttributes.swift → AcmeActivityAttributes.swift
export function renameWidgetFilename(name, swiftPrefix) {
  const m = /^MobileSurfaces(.+)$/.exec(name);
  if (!m) return null;
  return `${swiftPrefix}${m[1]}`;
}

/**
 * Copy the widget target dir from a materialized source root into the
 * user's project at `targets/<basename>`, matching the convention that
 * `@bacons/apple-targets` expects. Returns `{ copied, destDir, decision }`;
 * skips the copy and surfaces the conflict when the destination already has
 * files.
 */
export function copyWidgetTarget({ sourceRoot, manifest, destAppRoot }) {
  const srcDir = path.join(sourceRoot, manifest.widgetTargetDir);
  const destDir = path.join(destAppRoot, "targets", path.basename(manifest.widgetTargetDir));
  const decision = widgetCopyDecision({ destDir });
  if (decision.kind === "conflict") {
    return { copied: false, destDir, decision };
  }
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Widget source missing at ${srcDir}.`);
  }
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.cpSync(srcDir, destDir, { recursive: true });
  logger.header(`copy widget target → ${destDir}`);
  logger.write(`source: ${srcDir}\n`);
  return { copied: true, destDir, decision };
}

/**
 * Top-level orchestration for the add-to-existing-Expo flow: install
 * packages, patch (or stage a manual snippet for) the app config, copy and
 * trim the widget target dir, and rename the bundled identity. Prebuild is
 * deliberately not run here - the task runner owns that step so it gets its
 * own spinner. Returns the summary the success renderer consumes.
 */
export async function applyToExisting({
  evidence,
  plan,
  packageManager,
  manifest,
  teamId = null,
  // Injection seams for tests so we can exercise the rollback path without
  // really shelling out to pnpm or materializing the template tarball.
  // Production callers omit `runners`; the defaults are the real impls.
  runners = {},
}) {
  const target = evidence.cwd;
  const appRoot = resolveAppRoot(evidence);
  const followups = [...plan.manualFollowups];
  const summary = {
    target,
    appRoot,
    packagesInstalled: [],
    packagesSkipped: [],
    appJsonPatched: false,
    manualSnippet: null,
    widgetCopied: false,
    widgetDestDir: null,
    widgetConflict: null,
    widgetRenamed: null, // { from: "MobileSurfaces", to: swiftPrefix } when the rename pass ran
    prebuilt: false, // run-tasks flips this to true after prebuild succeeds
    rolledBack: false, // set true when an apply error triggered a rollback
    followups,
  };

  const runAddPackages = runners.runAddPackages ?? defaultRunAddPackages;
  const prepareSourceTree = runners.prepareSourceTree ?? defaultPrepareSourceTree;

  // Snapshot every file we are about to modify or create. On any thrown
  // error from an apply step (pnpm install fails, disk full mid-rewrite,
  // widget rename throws), the backup is restored and the user's project
  // returns to its pre-apply state. On success the backup is deleted.
  const session = new BackupSession({ root: target });

  try {
    await applyPackageInstall({
      plan,
      target,
      packageManager,
      summary,
      session,
      runAddPackages,
    });
    applyAppConfigPatch({ plan, evidence, teamId, summary, session });
    await applyWidgetCopyStripRename({
      plan,
      evidence,
      manifest,
      appRoot,
      target,
      summary,
      session,
      prepareSourceTree,
    });
    await session.commit();
    return summary;
  } catch (err) {
    summary.rolledBack = true;
    try {
      await session.rollback();
    } catch (rollbackErr) {
      // Attach rollback errors to the original failure rather than masking
      // it - the apply failure is the primary cause; the rollback issues
      // matter for ops follow-up.
      err.rollbackError = rollbackErr;
    }
    throw err;
  }
}

// Step 1: install packages we have real npm versions for; queue followups for
// workspace-only entries that the host can't resolve yet. The package
// manager rewrites package.json and the lockfile in place, so both are
// snapshotted BEFORE the add command runs; if pnpm fails partway, rollback
// restores the manifest and the user reruns `pnpm install` to reconverge
// node_modules.
async function applyPackageInstall({ plan, target, packageManager, summary, session, runAddPackages }) {
  const installable = installablePackages(plan);
  const skipped = plan.packagesToAdd.filter((p) => p.workspace);
  summary.packagesSkipped = skipped.map((p) => p.name);
  if (installable.length > 0) {
    const pkgJsonPath = path.join(target, "package.json");
    session.recordFile(pkgJsonPath);
    for (const lockfile of LOCKFILE_NAMES) {
      const lockPath = path.join(target, lockfile);
      if (fs.existsSync(lockPath)) session.recordFile(lockPath);
    }
    await runAddPackages({ target, packageManager, packages: installable });
    summary.packagesInstalled = installable;
  }
  if (skipped.length > 0) {
    summary.followups.push(
      `Skipped local-only refs (workspace:* or file:): ${skipped
        .map((p) => p.name)
        .join(", ")}. Install them manually or replace the ref with a concrete version.`,
    );
  }
}

// Step 2: write app config in place when JSON; stage a paste-ready snippet for
// app.config.{js,ts}. Surfaces a follow-up when the user's existing team id
// conflicts with the one they typed at the prompt.
function applyAppConfigPatch({ plan, evidence, teamId, summary, session }) {
  if (plan.appConfigManual) {
    summary.manualSnippet = renderManualSnippet(plan, { teamId });
    return;
  }
  if (!(evidence.config?.kind === "json" && evidence.config.path)) return;

  // Only write the team id when we don't risk overwriting an existing real
  // value. buildPatchedAppJson enforces the same rule internally; here we
  // additionally surface a follow-up so the user notices the divergence
  // instead of silently keeping the old value.
  const existingTeamId = evidence.config.parsed?.ios?.appleTeamId ?? null;
  const isPlaceholder = existingTeamId === "XXXXXXXXXX";
  if (teamId && existingTeamId && !isPlaceholder && existingTeamId !== teamId) {
    summary.followups.push(
      `Your app.json already has expo.ios.appleTeamId set to ${existingTeamId}. Left it alone - update it manually if you meant to switch to ${teamId}.`,
    );
  }
  session.recordFile(evidence.config.path);
  patchAppJson({ appJsonPath: evidence.config.path, plan, teamId });
  summary.appJsonPatched = true;
}

// Step 3: copy the widget target dir from the template into the user's app,
// strip it to match the surface picker, then rename the bundled MobileSurfaces*
// identity to the user's. Strip runs before rename so deletion paths stay on
// the original "MobileSurfaces*" names.
async function applyWidgetCopyStripRename({ plan, evidence, manifest, appRoot, target, summary, session, prepareSourceTree }) {
  const source = await prepareSourceTree();
  try {
    // Decide first so the backup only tracks the dir when we are actually
    // going to populate it. A "conflict" decision returns early below.
    const destDir = path.join(
      appRoot,
      "targets",
      path.basename(manifest.widgetTargetDir),
    );
    const decision = widgetCopyDecision({ destDir });
    if (decision.kind !== "conflict") session.recordDir(destDir);

    const result = copyWidgetTarget({
      sourceRoot: source.rootDir,
      manifest,
      destAppRoot: appRoot,
    });
    summary.widgetDestDir = result.destDir;
    if (!result.copied) {
      summary.widgetConflict = result.decision;
      summary.followups.push(
        `${path.relative(target, result.destDir) || result.destDir} already exists with files. Skipped to avoid clobbering. Move it aside and rerun if you want the bundled widget.`,
      );
      return;
    }
    summary.widgetCopied = true;

    const surfaces = plan.surfaces ?? DEFAULT_SURFACES;
    applyStripWidgetDir({ widgetDir: result.destDir, surfaces });

    const swiftPrefix = deriveSwiftPrefixFromEvidence(evidence);
    if (!swiftPrefix) {
      summary.followups.push(
        `Couldn't derive a Swift prefix from your project name. The widget target was copied with the bundled "MobileSurfaces" identifiers - rename them by hand to match your app.`,
      );
      return;
    }
    const renameResult = await applyWidgetRename({
      destDir: result.destDir,
      swiftPrefix,
    });
    if (renameResult.renamed) {
      summary.widgetRenamed = { from: "MobileSurfaces", to: swiftPrefix };
    }
  } finally {
    source.cleanup();
  }
}
