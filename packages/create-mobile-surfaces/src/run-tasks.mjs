// Drives the scaffold steps as ora spinners so the user sees a label per
// step plus an elapsed-time stamp on success. Errors propagate; the
// entrypoint maps them to the right user-facing failure copy.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { applyToExisting } from "./apply-existing.mjs";
import { applyMonorepo } from "./apply-monorepo.mjs";
import * as scaffold from "./scaffold.mjs";
import { applyStripGreenfield } from "./strip.mjs";
import { task } from "./ui.mjs";

// Defaults preserve pre-3A behavior for any caller that doesn't thread the
// surface picker through (e.g. legacy tests). The CLI prompts always supply
// a real selection.
const DEFAULT_SURFACES = Object.freeze({
  homeWidget: true,
  controlWidget: true,
  lockAccessoryWidget: true,
  standbyWidget: true,
});

const execFileAsync = promisify(execFile);

// Tag used by bin/index.mjs to swap the generic "install failed" copy for
// a specific corepack pointer. The string lives in the error message itself
// so the install log shows exactly what the user needs.
export const PNPM_MISSING_TAG = "pnpm-missing";

// Tag used by bin/index.mjs to swap the generic "install failed" copy for
// a specific CocoaPods install pointer. expo prebuild calls pods internally
// so the failure would otherwise show as a deep-in-prebuild error 60–90s
// after the spinner starts.
export const COCOAPODS_MISSING_TAG = "cocoapods-missing";

// Greenfield always installs with pnpm because the template ships a
// pnpm-lock.yaml. Preflight only warns when pnpm is missing (so the
// add-to-existing path stays usable on npm/yarn/bun). This guard catches
// the greenfield case before we shell out and produce a generic ENOENT.
//
// Implemented as a probe rather than a `which` check so we lean on the
// same execFile path the rest of preflight uses — works the same way on
// macOS regardless of the user's shell config.
export async function ensurePnpmAvailable({ exec = execFileAsync } = {}) {
  try {
    await exec("pnpm", ["-v"], { timeout: 5000 });
  } catch (cause) {
    const err = new Error(
      "pnpm not found on PATH. The Mobile Surfaces template ships a pnpm-lock.yaml. Enable pnpm with: corepack enable pnpm",
    );
    err.tag = PNPM_MISSING_TAG;
    err.cause = cause;
    throw err;
  }
}

// CocoaPods is invoked transitively by `expo prebuild`. Preflight only warns
// when it's missing (so the user can pick installNow=false and proceed); this
// guard hard-fails before prebuild starts when they did pick installNow,
// turning a 60–90s in-the-weeds prebuild error into an immediate, actionable
// "install cocoapods" message. Mirrors ensurePnpmAvailable's shape so
// bin/index.mjs handles both with one error-tag pattern.
export async function ensureCocoapodsAvailable({ exec = execFileAsync } = {}) {
  try {
    await exec("pod", ["--version"], { timeout: 5000 });
  } catch (cause) {
    const err = new Error(
      "CocoaPods not found on PATH. expo prebuild needs it to install iOS pods. Install with: brew install cocoapods (or sudo gem install cocoapods)",
    );
    err.tag = COCOAPODS_MISSING_TAG;
    err.cause = cause;
    throw err;
  }
}

export async function runTasks({ config, target }) {
  await task("Copying template", () => scaffold.copyTemplate({ target }));

  // Strip the freshly-extracted tree to match the surface picker. Always
  // runs — even with every surface selected, this pass removes the
  // SURFACE-BEGIN/END marker comments so users never see them in their
  // generated project.
  // Merge rather than replace: callers can pass a partial { homeWidget,
  // controlWidget } and still get the defaults for any newer keys they don't
  // know about (lockAccessoryWidget, standbyWidget). Without the merge, an
  // undefined key would be treated as "deselected" and the strip pass would
  // drop a surface the caller never opted out of.
  const surfaces = { ...DEFAULT_SURFACES, ...(config.surfaces ?? {}) };
  await task("Trimming to selected surfaces", async () => {
    applyStripGreenfield({ rootDir: target, surfaces });
  });

  await task(`Renaming to ${config.projectName}`, () =>
    scaffold.renameIdentity({ target, config }),
  );

  if (config.installNow) {
    // Greenfield always uses pnpm because the template ships pnpm-lock.yaml.
    // Add-mode uses a separate runner that respects the user's detected pm.
    const packageManager = config.packageManager ?? "pnpm";

    // Catch the missing-pnpm case here (not in preflight) so add-to-existing
    // — which legitimately runs on npm/yarn/bun — never gets blocked by it.
    if (packageManager === "pnpm") {
      await ensurePnpmAvailable();
    }

    await task(`Installing dependencies (${packageManager} install) — usually 30–60s`, () =>
      scaffold.runInstall({ target, packageManager }),
    );
    // Hard-fail before prebuild if CocoaPods is missing. Prebuild would
    // otherwise spin for 60–90s and surface a generic Pods error; failing
    // here gives the user the brew/gem install pointer immediately.
    await ensureCocoapodsAvailable();
    // Expo prebuild internally runs CocoaPods; the label keeps that honest
    // rather than implying CocoaPods is a separate sub-step.
    await task(
      "Preparing iOS (expo prebuild + CocoaPods) — usually 60–120s on a fresh checkout",
      () => scaffold.prebuildIos({ target, packageManager }),
    );
  }
}

// Add-to-existing variant. The plan was already confirmed; this runner
// narrates the apply phase as one or two grouped tasks. The summary
// returned drives the success screen and the manual-followups list.
export async function runExistingTasks({ evidence, plan, packageManager, installNow, manifest, teamId = null }) {
  const installable = plan.packagesToAdd.filter((p) => !p.workspace).length;
  const installLabel = installable > 0
    ? `Adding ${installable} package${installable === 1 ? "" : "s"} (${packageManager} add) — usually under 30s`
    : `Skipping install (no installable packages)`;

  let summary;
  // The applyToExisting() call covers install + patch + copy as a single
  // chunk. Splitting them produces a noisy spinner cascade; bundling keeps
  // the screen tight. Prebuild is its own task so its longer wait gets a
  // dedicated spinner with elapsed time.
  await task(installLabel, async () => {
    summary = await applyToExisting({
      evidence,
      plan,
      packageManager,
      manifest,
      teamId,
    });
  });

  if (installNow && !plan.appConfigManual) {
    await task(
      "Preparing iOS (expo prebuild + CocoaPods) — usually 60–120s on a fresh checkout",
      async () => {
        await scaffold.prebuildIos({ target: evidence.cwd, packageManager });
        summary.prebuilt = true;
      },
    );
  } else if (installNow && plan.appConfigManual) {
    // Don't run prebuild against an unpatched config — it would regenerate
    // the iOS tree without the new plugins and Info.plist keys, which is
    // worse than not running it. Surface as a followup instead.
    summary.followups.push(
      `Skipped expo prebuild because your app config wasn't patched (manual). Apply the snippet above, then run: npx expo prebuild --platform ios`,
    );
  }

  return summary;
}

// Existing-monorepo-no-Expo variant. Scaffold apps/mobile/ inside the host
// workspace, merge workspace globs, optionally run install + prebuild. The
// install always runs from the host root because that's where the user's
// lockfile lives.
export async function runMonorepoTasks({ evidence, plan, manifest, config, packageManager }) {
  let summary;
  await task(
    `Scaffolding apps/mobile/ in your workspace`,
    async () => {
      summary = await applyMonorepo({ evidence, config, manifest, packageManager });
    },
  );

  if (!config.installNow) return summary;

  if (packageManager === "pnpm") {
    await ensurePnpmAvailable();
  }
  await task(
    `Installing workspace dependencies (${packageManager} install) — usually 30–90s`,
    async () => {
      await scaffold.runInstall({ target: evidence.cwd, packageManager });
      summary.installed = true;
    },
  );
  await ensureCocoapodsAvailable();
  await task(
    "Preparing iOS (expo prebuild + CocoaPods) — usually 60–120s on a fresh checkout",
    async () => {
      await scaffold.prebuildIosInAppsMobile({
        appsMobileRoot: summary.appsMobileRoot,
      });
      summary.prebuilt = true;
    },
  );

  return summary;
}
