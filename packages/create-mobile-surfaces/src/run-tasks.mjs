// Drives the scaffold steps as ora spinners so the user sees a label per
// step plus an elapsed-time stamp on success. Errors propagate; the
// entrypoint maps them to the right user-facing failure copy.

import { applyToExisting } from "./apply-existing.mjs";
import * as scaffold from "./scaffold.mjs";
import { task } from "./ui.mjs";

export async function runTasks({ config, target }) {
  await task("Copying template", () => scaffold.copyTemplate({ target }));
  await task(`Renaming to ${config.projectName}`, () =>
    scaffold.renameIdentity({ target, config }),
  );

  if (config.installNow) {
    // Greenfield always uses pnpm because the template ships pnpm-lock.yaml.
    // Add-mode uses a separate runner that respects the user's detected pm.
    const packageManager = config.packageManager ?? "pnpm";
    await task(`Installing dependencies (${packageManager} install) — usually 30–60s`, () =>
      scaffold.runInstall({ target, packageManager }),
    );
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
export async function runExistingTasks({ evidence, plan, packageManager, installNow, manifest }) {
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
