// Drives the scaffold steps as ora spinners so the user sees a label per
// step plus an elapsed-time stamp on success. Errors propagate; the
// entrypoint maps them to the right user-facing failure copy.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { applyToExisting } from "./apply-existing.mjs";
import { applyMonorepo } from "./apply-monorepo.mjs";
import { CocoapodsMissingError, PnpmMissingError } from "./errors.mjs";
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

// Back-compat tag values retained as re-exports so any external consumer
// or test still pattern-matching on `err.tag === PNPM_MISSING_TAG` continues
// to work. New call sites should instanceof-check against PnpmMissingError /
// CocoapodsMissingError instead. The error classes also set `.tag` for the
// same reason; see errors.mjs.
export const PNPM_MISSING_TAG = "pnpm-missing";
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
    const err = new PnpmMissingError(cause);
    // Back-compat: external consumers (and our own bin/index.mjs prior to
    // v7) still branch on err.tag. Keep the field populated until the v8
    // cleanup removes the duck-typed catch arm.
    err.tag = PNPM_MISSING_TAG;
    throw err;
  }
}

// CocoaPods is invoked transitively by `expo prebuild`. Preflight only warns
// when it's missing (so the user can pick installNow=false and proceed); this
// guard hard-fails before prebuild starts when they did pick installNow,
// turning a 60–90s in-the-weeds prebuild error into an immediate, actionable
// "install cocoapods" message.
export async function ensureCocoapodsAvailable({ exec = execFileAsync } = {}) {
  try {
    await exec("pod", ["--version"], { timeout: 5000 });
  } catch (cause) {
    const err = new CocoapodsMissingError(cause);
    err.tag = COCOAPODS_MISSING_TAG;
    throw err;
  }
}

// Test-only hook: when CMS_TEST_SCAFFOLD_DELAY_MS is set to a positive integer,
// the greenfield task pipeline sleeps for that many milliseconds before the
// first scaffold task. Lets the SIGINT subprocess test catch the CLI mid-task
// without depending on the tar extract being slow enough on the CI runner.
//
// The delay also installs a SIGINT listener that aborts the sleep with a
// throw. Without it, SIGINT lands on the CLI's top-level handler (which only
// flips `interrupted=true`) and the delay finishes anyway — the pipeline
// continues to the next task and exits 0, defeating the test. Production code
// never sees this path because the env var is unset; the listener is removed
// once the sleep resolves so it can't leak into the rest of the pipeline.
function maybeTestDelay() {
  const raw = process.env.CMS_TEST_SCAFFOLD_DELAY_MS;
  if (!raw) return Promise.resolve();
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onSigint = () => {
      clearTimeout(timer);
      const err = new Error("test-delay interrupted by SIGINT");
      err.code = "TEST_SIGINT";
      reject(err);
    };
    const timer = setTimeout(() => {
      process.removeListener("SIGINT", onSigint);
      resolve();
    }, ms);
    process.once("SIGINT", onSigint);
  });
}

export async function runTasks({ config, target }) {
  await task("Copying template", async () => {
    await maybeTestDelay();
    await scaffold.copyTemplate({ target });
  });

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
