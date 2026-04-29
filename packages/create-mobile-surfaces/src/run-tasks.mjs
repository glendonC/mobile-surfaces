// Drives the scaffold steps through clack's tasks() so the user sees a
// named checklist with per-step elapsed time. Errors propagate; the
// entrypoint maps them to the right user-facing failure copy.

import { tasks } from "@clack/prompts";
import pc from "picocolors";
import { applyToExisting } from "./apply-existing.mjs";
import * as scaffold from "./scaffold.mjs";

function formatElapsed(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Wraps a task so its completion line includes a dim elapsed-time stamp.
// The label is what shows on success; the spinner during work shows the title.
function timed(label, fn) {
  return async () => {
    const start = Date.now();
    await fn();
    return `${label}  ${pc.dim(`(${formatElapsed(Date.now() - start)})`)}`;
  };
}

export async function runTasks({ config, target }) {
  const steps = [
    {
      title: "Copying template",
      task: timed("Copied template", () => scaffold.copyTemplate({ target })),
    },
    {
      title: `Renaming to ${config.projectName}`,
      task: timed(`Renamed to ${config.projectName}`, () =>
        scaffold.renameIdentity({ target, config }),
      ),
    },
  ];

  if (config.installNow) {
    // Greenfield always uses pnpm because the template ships pnpm-lock.yaml.
    // Add-mode (separate task runner) will pass the user's detected manager.
    const packageManager = config.packageManager ?? "pnpm";
    steps.push({
      title: `Installing dependencies (${packageManager} install)`,
      task: timed("Installed dependencies", () =>
        scaffold.runInstall({ target, packageManager }),
      ),
    });
    // Expo prebuild internally runs CocoaPods; we keep the label honest about
    // the full scope rather than implying CocoaPods is a separate sub-step.
    steps.push({
      title: "Preparing iOS (expo prebuild + CocoaPods)",
      task: timed("Prepared iOS", () =>
        scaffold.prebuildIos({ target, packageManager }),
      ),
    });
  }

  await tasks(steps);
}

// Add-to-existing variant. The plan was already confirmed by the user; this
// runner narrates the apply phase as a single grouped task so the spinner
// shows progress against the work that's actually happening (install,
// patch, copy, prebuild) and the summary returned can drive the success
// screen and the manual-followups list.
export async function runExistingTasks({ evidence, plan, packageManager, installNow, manifest }) {
  const installable = plan.packagesToAdd.filter((p) => !p.workspace).length;
  const installLabel = installable > 0
    ? `Adding ${installable} package${installable === 1 ? "" : "s"} (${packageManager} add)`
    : `Skipping install (no installable packages)`;

  let summary;
  await tasks([
    {
      title: installLabel,
      task: timed(installable > 0 ? "Added packages" : "No packages to add", async () => {
        // The single applyToExisting() call covers all four steps. We bunch
        // them under one spinner because they run quickly (compared to
        // install/prebuild) and splitting would make the output noisy.
        summary = await applyToExisting({
          evidence,
          plan,
          packageManager,
          manifest,
        });
      }),
    },
  ]);

  if (installNow && !plan.appConfigManual) {
    await tasks([
      {
        title: "Preparing iOS (expo prebuild + CocoaPods)",
        task: timed("Prepared iOS", async () => {
          await scaffold.prebuildIos({ target: evidence.cwd, packageManager });
          summary.prebuilt = true;
        }),
      },
    ]);
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
