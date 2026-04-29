// The post-install screen. Rendered manually rather than via clack's outro()
// so the four-section layout has the exact spacing the design calls for.

import path from "node:path";
import pc from "picocolors";
import {
  existingSuccessSections,
  existingSuccessTitle,
  successSections,
  successTitle,
} from "./copy.mjs";

const indent = "   ";
const inner = "     ";

function section(title, lines) {
  return [
    "",
    indent + pc.bold(title),
    ...lines.map((l) => inner + l),
  ].join("\n");
}

export function renderSuccess(config) {
  const s = successSections(config.projectName);

  const blocks = [
    "",
    pc.cyan("◆  ") + pc.bold(successTitle),
    section("What's in the box", s.inTheBox.split("\n")),
    section("Try it now", s.tryItNow),
    section("When you're ready", s.whenReady),
    section("Learn more", s.learnMore),
    "",
  ];

  process.stdout.write(blocks.join("\n") + "\n");
}

// Add-mode success: shows what landed in the user's project, surfaces any
// manual followups (paste-ready snippet, conflicts, deferred packages),
// and points at the dev commands they'd run next. The structure differs
// from greenfield because the user already has a project shape — we're
// reporting changes, not introducing the whole world.
export function renderExistingSuccess({ summary, evidence, packageManager, plan }) {
  const projectName = evidence.packageName;

  const blocks = ["", pc.cyan("◆  ") + pc.bold(existingSuccessTitle)];

  // What we did — only show non-empty subsections so the screen stays tight.
  const did = [];
  if (summary.packagesInstalled.length > 0) {
    did.push(
      `Added ${summary.packagesInstalled.length} package${summary.packagesInstalled.length === 1 ? "" : "s"}`,
    );
  }
  if (summary.appJsonPatched) {
    did.push(`Patched ${path.basename(evidence.config.path)}`);
  }
  if (summary.widgetCopied && summary.widgetDestDir) {
    const rel = path.relative(evidence.cwd, summary.widgetDestDir);
    did.push(`Copied widget target to ${rel}`);
  }
  if (summary.prebuilt) {
    did.push(`Ran expo prebuild`);
  }
  if (did.length > 0) {
    blocks.push(section("What landed", did));
  }

  // Paste-ready snippet for app.config.{js,ts}.
  if (summary.manualSnippet) {
    const snippetLines = summary.manualSnippet.split("\n");
    blocks.push(
      section(
        `Paste this into your app.config.${plan.appConfigKind}`,
        snippetLines,
      ),
    );
  }

  // Manual followups — workspace deferrals, conflicts, prebuild reminders.
  if (summary.followups.length > 0) {
    blocks.push(section("Follow-ups", summary.followups));
  }

  const next = existingSuccessSections({ projectName, packageManager });
  blocks.push(section("Try it now", next.tryItNow));
  blocks.push(section("Learn more", next.learnMore));
  blocks.push("");

  process.stdout.write(blocks.join("\n") + "\n");
}
