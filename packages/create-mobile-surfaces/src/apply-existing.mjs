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
export function buildPatchedAppJson({ existing, plan }) {
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
    Object.keys(plan.infoPlistToAdd).length > 0;
  if (needsIos) expo.ios = expo.ios ?? {};

  if (plan.deploymentTargetTo) {
    expo.ios.deploymentTarget = plan.deploymentTargetTo;
  }

  if (Object.keys(plan.infoPlistToAdd).length > 0) {
    expo.ios.infoPlist = expo.ios.infoPlist ?? {};
    Object.assign(expo.ios.infoPlist, plan.infoPlistToAdd);
  }

  return JSON.stringify(data, null, 2) + "\n";
}

export function patchAppJson({ appJsonPath, plan }) {
  const existing = fs.readFileSync(appJsonPath, "utf8");
  const patched = buildPatchedAppJson({ existing, plan });
  fs.writeFileSync(appJsonPath, patched);
}

// For app.config.js / app.config.ts / missing config, we can't safely write
// changes (we'd be modifying user code). Render a JSON snippet they can
// paste in instead. Returns a string suitable for `note()` rendering.
export function renderManualSnippet(plan) {
  const snippet = {};
  if (plan.pluginsToAdd.length > 0) {
    snippet.plugins = plan.pluginsToAdd.map((p) =>
      p.config !== undefined ? [p.name, p.config] : p.name,
    );
  }
  const needsIos =
    plan.deploymentTargetTo ||
    Object.keys(plan.infoPlistToAdd).length > 0;
  if (needsIos) snippet.ios = {};
  if (plan.deploymentTargetTo) {
    snippet.ios.deploymentTarget = plan.deploymentTargetTo;
  }
  if (Object.keys(plan.infoPlistToAdd).length > 0) {
    snippet.ios.infoPlist = { ...plan.infoPlistToAdd };
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
export async function applyToExisting({ evidence, plan, packageManager, manifest }) {
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
    summary.manualSnippet = renderManualSnippet(plan);
  } else if (evidence.config?.kind === "json" && evidence.config.path) {
    patchAppJson({ appJsonPath: evidence.config.path, plan });
    summary.appJsonPatched = true;
  }

  // 3) Copy the widget target dir from the template into the user's app.
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
