// The add-to-existing-Expo *apply* phase. The detection and prompting flow
// in existing-expo.mjs produces a `plan`; this module turns that plan into
// real changes on the user's filesystem. Each operation is split so the
// task runner can wrap them in clack's tasks() with elapsed time, and the
// pure helpers (buildPatchedAppJson, renderManualSnippet, widgetCopyDecision)
// are unit-tested without filesystem I/O.

import fs from "node:fs";
import path from "node:path";
import * as logger from "./logger.mjs";
import { prepareSourceTree, runAddPackages } from "./scaffold.mjs";
import { applyStripWidgetDir } from "./strip.mjs";
import { toSwiftPrefix } from "./validators.mjs";

const DEFAULT_SURFACES = Object.freeze({
  homeWidget: true,
  controlWidget: true,
});

// Format a manifest package entry as the spec string a package manager's
// `add` subcommand expects. Workspace/file deps can't yet resolve from npm,
// so callers should filter them out via installablePackages() first.
export function formatPackageSpec({ name, version }) {
  if (!version || version === "latest" || version === "workspace") return name;
  return `${name}@${version}`;
}

export function installablePackages(plan) {
  return plan.packagesToAdd
    .filter((p) => !p.workspace)
    .map(formatPackageSpec);
}

// Apply plan.pluginsToAdd / infoPlistToAdd / deploymentTargetTo to an
// app.json string. Returns the new string (with trailing newline). Pure —
// no filesystem access — so it's easy to unit-test.
//
// teamId, when provided, is patched into expo.ios.appleTeamId only when the
// existing value is missing or the placeholder "XXXXXXXXXX". A real existing
// team id different from the input is preserved here — surfacing the conflict
// is the orchestrator's job (see applyToExisting), not this helper's.
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

  const needsIos =
    plan.deploymentTargetTo ||
    Object.keys(plan.infoPlistToAdd).length > 0 ||
    Object.keys(plan.entitlementsToAdd ?? {}).length > 0 ||
    Boolean(teamId);
  if (needsIos) expo.ios = expo.ios ?? {};

  if (plan.deploymentTargetTo) {
    expo.ios.deploymentTarget = plan.deploymentTargetTo;
  }

  if (Object.keys(plan.infoPlistToAdd).length > 0) {
    expo.ios.infoPlist = expo.ios.infoPlist ?? {};
    Object.assign(expo.ios.infoPlist, plan.infoPlistToAdd);
  }

  if (Object.keys(plan.entitlementsToAdd ?? {}).length > 0) {
    expo.ios.entitlements = expo.ios.entitlements ?? {};
    Object.assign(expo.ios.entitlements, plan.entitlementsToAdd);
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

export function patchAppJson({ appJsonPath, plan, teamId = null }) {
  const existing = fs.readFileSync(appJsonPath, "utf8");
  const patched = buildPatchedAppJson({ existing, plan, teamId });
  fs.writeFileSync(appJsonPath, patched);
}

// For app.config.js / app.config.ts / missing config, we can't safely write
// changes (we'd be modifying user code). Render a JSON snippet they can
// paste in instead. Returns a string suitable for `note()` rendering.
//
// When teamId is provided, it shows up under ios.appleTeamId so the user
// doesn't have to be told twice what their team id should be.
export function renderManualSnippet(plan, { teamId = null } = {}) {
  const snippet = {};
  if (plan.pluginsToAdd.length > 0) {
    snippet.plugins = plan.pluginsToAdd.map((p) =>
      p.config !== undefined ? [p.name, p.config] : p.name,
    );
  }
  const needsIos =
    plan.deploymentTargetTo ||
    Object.keys(plan.infoPlistToAdd).length > 0 ||
    Object.keys(plan.entitlementsToAdd ?? {}).length > 0 ||
    Boolean(teamId);
  if (needsIos) snippet.ios = {};
  if (plan.deploymentTargetTo) {
    snippet.ios.deploymentTarget = plan.deploymentTargetTo;
  }
  if (teamId) {
    snippet.ios.appleTeamId = teamId;
  }
  if (Object.keys(plan.infoPlistToAdd).length > 0) {
    snippet.ios.infoPlist = { ...plan.infoPlistToAdd };
  }
  if (Object.keys(plan.entitlementsToAdd ?? {}).length > 0) {
    snippet.ios.entitlements = { ...plan.entitlementsToAdd };
  }
  return JSON.stringify(snippet, null, 2);
}

// Where to drop the widget target dir in the user's project. The user's
// app config sits at the project root, so we anchor off its directory.
// Falls back to cwd when the project has no config file at all.
export function resolveAppRoot(evidence) {
  if (evidence.config?.path) return path.dirname(evidence.config.path);
  return evidence.cwd;
}

// Decide whether copying the widget target is safe. We refuse to clobber
// an existing target directory that has any contents — the user may have
// a different widget there from another tool or a prior run.
export function widgetCopyDecision({ destDir }) {
  if (!fs.existsSync(destDir)) return { kind: "fresh" };
  const entries = fs.readdirSync(destDir);
  if (entries.length === 0) return { kind: "empty" };
  return { kind: "conflict", entries };
}

// Derive a Swift-friendly prefix for the user's app from whatever evidence
// we have. Prefer the Expo `name` (it's how the user sees the app), fall
// back to the package.json name. Returns null when nothing usable is found
// — callers then leave the widget files alone and surface a follow-up note.
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

// Rewrite the just-copied widget target dir in place so the bundled
// MobileSurfaces* identity becomes the user's app identity.
//
// Why we do this in the user's tree, not in our bundled package:
//   The published @mobile-surfaces/live-activity package keeps its own
//   `MobileSurfacesActivityAttributes` symbol — that's the type the JS
//   wrapper imports and binds to. The widget target on the user's side
//   uses a *different* Swift module (the Xcode extension target), so it's
//   safe to rename: ActivityKit binds the two by ContentState/Attributes
//   shape, not by symbol name. Default `Codable` key derivation gives
//   identical JSON for identical fields, so `Activity<T>.request()` from
//   the published module still talks to `ActivityConfiguration(for:)` in
//   the user's renamed widget target.
//
// Pure-ish: takes a destDir on disk and a swiftPrefix string; returns a
// summary describing what changed. No spawning, no manifest reads, no
// network — easy to unit-test by writing a small fake widget tree.
export function applyWidgetRename({ destDir, swiftPrefix }) {
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

  // Two-phase: walk + collect, then apply. Coordinating writes and renames
  // through a single set of {path, newContent, newName} records makes the
  // ordering explicit (write rewritten content first, then rename) and keeps
  // the apply step easy to reason about — no in-walk side effects.
  const ops = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      let newContent;
      // Only rewrite text-y files. Asset bundles (.car, images) won't
      // contain literal "MobileSurfaces" strings, but reading them as utf8
      // is wasteful and risks false-positive substitutions.
      if (TEXTY_EXTS.has(path.extname(entry.name).toLowerCase())) {
        const original = fs.readFileSync(full, "utf8");
        const rewritten = rewriteContent({ source: original, swiftPrefix, widgetTarget });
        if (rewritten !== original) newContent = rewritten;
      }

      // MobileSurfaces<Suffix>.swift → <swiftPrefix><Suffix>.swift. Only the
      // prefix at the start of the basename is rewritten so unrelated uses
      // of the literal "MobileSurfaces" string elsewhere are left alone.
      const renamed = renameWidgetFilename(entry.name, swiftPrefix);
      const newName = renamed && renamed !== entry.name ? renamed : undefined;

      if (newContent !== undefined || newName !== undefined) {
        ops.push({ dir, name: entry.name, newContent, newName });
      }
    }
  }
  walk(destDir);

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

// Pure file-content rewrite. Single regex pass over the source: alternation
// is left-to-right so `MobileSurfacesWidget` is matched before the broader
// `MobileSurfaces` at each position, which is what makes the order-dependent
// substitution work — the widget token must rewrite to `widgetTarget`, not
// `${swiftPrefix}Widget` (those diverge when the user picks a custom widget
// name). Replaces two sequential split/join passes with one allocation-free
// scan.
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

// Copy the widget target dir from a materialized source root into the
// user's project. The source dir lives at manifest.widgetTargetDir
// (e.g. apps/mobile/targets/widget) inside the source tree; we put it at
// targets/<basename> inside the user's app root, matching the convention
// that @bacons/apple-targets expects.
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

// Top-level orchestration: install packages, patch app config, and copy
// the widget target dir. Prebuild is *not* part of this — the task runner
// owns that step so it gets its own spinner and elapsed-time stamp.
//
// Returns a summary the success renderer consumes; followups accumulate
// into summary.followups (some come from plan, some from this step).
export async function applyToExisting({ evidence, plan, packageManager, manifest, teamId = null }) {
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
    followups,
  };

  // 1) Install packages we have real versions for.
  const installable = installablePackages(plan);
  const skipped = plan.packagesToAdd.filter((p) => p.workspace);
  summary.packagesSkipped = skipped.map((p) => p.name);
  if (installable.length > 0) {
    await runAddPackages({ target, packageManager, packages: installable });
    summary.packagesInstalled = installable;
  }
  if (skipped.length > 0) {
    followups.push(
      `These packages aren't on npm yet so they were skipped: ${skipped
        .map((p) => p.name)
        .join(", ")}. They ship in the next release of mobile-surfaces.`,
    );
  }

  // 2) Patch app config — write JSON in place, or stage a paste-ready
  //    snippet for app.config.{js,ts}.
  if (plan.appConfigManual) {
    summary.manualSnippet = renderManualSnippet(plan, { teamId });
  } else if (evidence.config?.kind === "json" && evidence.config.path) {
    // Only write the team id when we don't risk overwriting an existing
    // real value. The buildPatchedAppJson helper enforces the same rule
    // internally; here we additionally surface a follow-up so the user
    // notices the divergence instead of silently keeping the old value.
    const existingTeamId = evidence.config.parsed?.ios?.appleTeamId ?? null;
    const isPlaceholder = existingTeamId === "XXXXXXXXXX";
    if (
      teamId &&
      existingTeamId &&
      !isPlaceholder &&
      existingTeamId !== teamId
    ) {
      followups.push(
        `Your app.json already has expo.ios.appleTeamId set to ${existingTeamId}. Left it alone — update it manually if you meant to switch to ${teamId}.`,
      );
    }
    patchAppJson({ appJsonPath: evidence.config.path, plan, teamId });
    summary.appJsonPatched = true;
  }

  // 3) Copy the widget target dir from the template into the user's app,
  //    strip it to match the surface picker (deletes deselected widget
  //    Swift files; trims marker regions in the bundle), then rename the
  //    bundled MobileSurfaces* identity to the user's app identity so they
  //    don't end up with `MobileSurfacesWidget` wired into their (e.g.)
  //    "Acme" project. Strip runs before rename so deletion paths stay on
  //    the original "MobileSurfaces*" names.
  const source = await prepareSourceTree();
  try {
    const result = copyWidgetTarget({
      sourceRoot: source.rootDir,
      manifest,
      destAppRoot: appRoot,
    });
    summary.widgetDestDir = result.destDir;
    if (result.copied) {
      summary.widgetCopied = true;

      const surfaces = plan.surfaces ?? DEFAULT_SURFACES;
      applyStripWidgetDir({ widgetDir: result.destDir, surfaces });

      const swiftPrefix = deriveSwiftPrefixFromEvidence(evidence);
      if (swiftPrefix) {
        const renameResult = applyWidgetRename({
          destDir: result.destDir,
          swiftPrefix,
        });
        if (renameResult.renamed) {
          summary.widgetRenamed = {
            from: "MobileSurfaces",
            to: swiftPrefix,
          };
        }
      } else {
        followups.push(
          `Couldn't derive a Swift prefix from your project name. The widget target was copied with the bundled "MobileSurfaces" identifiers — rename them by hand to match your app.`,
        );
      }
    } else {
      summary.widgetConflict = result.decision;
      followups.push(
        `${path.relative(target, result.destDir) || result.destDir} already exists with files. Skipped to avoid clobbering. Move it aside and rerun if you want the bundled widget.`,
      );
    }
  } finally {
    source.cleanup();
  }

  return summary;
}
