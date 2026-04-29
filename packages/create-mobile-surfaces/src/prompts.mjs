// The 6-prompt clack flow. Returns a config object the rest of the CLI
// uses to materialize the project. Cancellation is handled here so the
// entrypoint stays focused on orchestration.

import { cancel, confirm, isCancel, log, note, select, text } from "@clack/prompts";
import pc from "picocolors";
import { cancelled, prompts as copy } from "./copy.mjs";
import {
  toBundleId,
  toScheme,
  validateBundleId,
  validateProjectSlug,
  validateScheme,
  validateTeamId,
} from "./validators.mjs";

function bail(value) {
  if (isCancel(value)) {
    cancel(cancelled);
    process.exit(0);
  }
  return value;
}

// Clack renders a `message` as the prompt label on row 1; subsequent newlines
// in the same string drop out of the left rail. We re-add the rail manually
// so multi-line helper text stays visually attached to its prompt.
function buildMessage({ message, helper }) {
  if (!helper) return message;
  const railed = helper
    .split("\n")
    .map((line) => pc.gray("│  ") + pc.dim(line))
    .join("\n");
  return `${message}\n${railed}`;
}

export async function runPrompts({ initialName }) {
  const projectName = bail(
    await text({
      message: buildMessage(copy.projectName),
      placeholder: copy.projectName.placeholder,
      initialValue: initialName,
      validate: validateProjectSlug,
    }),
  );

  const scheme = bail(
    await text({
      message: buildMessage(copy.scheme),
      initialValue: toScheme(projectName),
      validate: validateScheme,
    }),
  );

  const bundleId = bail(
    await text({
      message: buildMessage(copy.bundleId),
      initialValue: toBundleId(projectName),
      validate: validateBundleId,
    }),
  );

  const teamId = bail(
    await text({
      message: buildMessage(copy.teamId),
      placeholder: "(skip)",
      validate: validateTeamId,
    }),
  );

  const installNow = bail(
    await select({
      message: buildMessage(copy.install),
      initialValue: true,
      options: [
        { value: true, label: copy.install.yes },
        { value: false, label: copy.install.no },
      ],
    }),
  );

  // Recap, rendered as a clack note, then a confirm with named choices.
  note(
    [
      `name        ${pc.bold(projectName)}`,
      `scheme      ${pc.bold(scheme)}`,
      `bundle      ${pc.bold(bundleId)}`,
      `team id     ${teamId ? pc.bold(teamId) : pc.dim("skip — set later in app.json")}`,
      `install     ${installNow ? pc.bold("yes") : pc.dim("no")}`,
    ].join("\n"),
    "Recap",
  );

  const proceed = bail(
    await select({
      message: copy.confirm.message,
      initialValue: true,
      options: [
        { value: true, label: copy.confirm.yes },
        { value: false, label: copy.confirm.no },
      ],
    }),
  );

  if (!proceed) {
    log.info("Starting over.");
    return runPrompts({ initialName: projectName });
  }

  return {
    projectName,
    scheme,
    bundleId,
    teamId: teamId || null,
    installNow,
  };
}
