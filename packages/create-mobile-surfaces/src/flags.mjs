// CLI flag parsing for create-mobile-surfaces. Exposed as pure functions so
// the bin/ entrypoint stays thin and the parsing/validation logic is testable
// without mocking parseArgs side-effects or stdin.
//
// Precedence:
//   1. Positional: `pnpm create mobile-surfaces my-app` → initialName="my-app".
//   2. --name: explicit override of the project name (wins over positional).
//   3. Other flags: each replaces the corresponding interactive prompt.
//   4. --yes: turns on non-interactive mode. With --yes, missing required
//      fields are an error rather than a prompt.

import { parseArgs } from "node:util";
import path from "node:path";
import {
  toBundleId,
  toScheme,
  validateBundleId,
  validateProjectSlug,
  validateScheme,
  validateTeamId,
} from "./validators.mjs";

export const FLAG_OPTIONS = Object.freeze({
  name: { type: "string" },
  scheme: { type: "string" },
  "bundle-id": { type: "string" },
  "team-id": { type: "string" },
  "home-widget": { type: "boolean" },
  "no-home-widget": { type: "boolean" },
  "control-widget": { type: "boolean" },
  "no-control-widget": { type: "boolean" },
  install: { type: "boolean" },
  "no-install": { type: "boolean" },
  "new-arch": { type: "boolean" },
  "no-new-arch": { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  help: { type: "boolean", short: "h" },
});

// Returns { values, positionals, initialName, overrides, yes, help }.
// `argv` is whatever you'd pass to parseArgs's `args` option (defaults to
// process.argv.slice(2) at the call site).
export function parseCliFlags(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: FLAG_OPTIONS,
    strict: true,
  });
  const initialName = derivePositionalName(positionals[0]);
  const overrides = flagsToOverrides(values);
  return {
    values,
    positionals,
    initialName,
    overrides,
    yes: values.yes === true,
    help: values.help === true,
  };
}

function derivePositionalName(positional) {
  if (!positional) return undefined;
  return path.basename(positional).toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

// Translate the parseArgs `values` object into the override shape the prompt
// flows expect. Boolean pairs (--home-widget / --no-home-widget): explicit
// negation wins, then explicit affirmation, otherwise the field is left
// unset (which makes the prompt flow fall through to its default).
export function flagsToOverrides(values) {
  const overrides = {};
  if (values.name !== undefined) overrides.projectName = values.name;
  if (values.scheme !== undefined) overrides.scheme = values.scheme;
  if (values["bundle-id"] !== undefined) overrides.bundleId = values["bundle-id"];
  if (values["team-id"] !== undefined) overrides.teamId = values["team-id"];

  if (values["no-home-widget"]) overrides.homeWidget = false;
  else if (values["home-widget"]) overrides.homeWidget = true;

  if (values["no-control-widget"]) overrides.controlWidget = false;
  else if (values["control-widget"]) overrides.controlWidget = true;

  if (values["no-install"]) overrides.installNow = false;
  else if (values.install) overrides.installNow = true;

  // newArchEnabled defaults to Expo's default (true on SDK 55) when neither
  // flag is set; the override only fires when the user explicitly opts out
  // (--no-new-arch) or back in (--new-arch). Negation wins on the rare case
  // where both flags appear together — it's the safer signal.
  if (values["no-new-arch"]) overrides.newArchEnabled = false;
  else if (values["new-arch"]) overrides.newArchEnabled = true;

  return overrides;
}

// Returns an array of human-readable error strings; empty array means clean.
// Run this before any prompting so bad flags fail fast at the top of the run.
export function validateOverrides(overrides) {
  const errors = [];
  if (overrides.projectName !== undefined) {
    const err = validateProjectSlug(overrides.projectName);
    if (err) errors.push(`--name: ${err}`);
  }
  if (overrides.scheme !== undefined) {
    const err = validateScheme(overrides.scheme);
    if (err) errors.push(`--scheme: ${err}`);
  }
  if (overrides.bundleId !== undefined) {
    const err = validateBundleId(overrides.bundleId);
    if (err) errors.push(`--bundle-id: ${err}`);
  }
  if (overrides.teamId !== undefined && overrides.teamId !== "") {
    const err = validateTeamId(overrides.teamId);
    if (err) errors.push(`--team-id: ${err}`);
  }
  return errors;
}

// Resolve overrides into a fully-populated config for non-interactive (--yes)
// runs. Required fields without an override are reported as errors. Optional
// fields fall back to their interactive defaults (or, for scheme/bundleId,
// derive from projectName the same way the prompts would).
export function resolveYesConfig(overrides) {
  const errors = [];
  const config = {};

  if (overrides.projectName === undefined) {
    errors.push("--yes requires --name (or a positional project name).");
  } else {
    config.projectName = overrides.projectName;
  }

  if (errors.length > 0) return { config: null, errors };

  config.scheme = overrides.scheme ?? toScheme(config.projectName);
  config.bundleId = overrides.bundleId ?? toBundleId(config.projectName);
  config.teamId = overrides.teamId && overrides.teamId.length > 0 ? overrides.teamId : null;
  config.surfaces = {
    homeWidget: overrides.homeWidget ?? true,
    controlWidget: overrides.controlWidget ?? true,
  };
  config.installNow = overrides.installNow ?? true;
  // newArchEnabled left undefined when the user passed neither flag — the
  // template's app.json default (Expo's own default, currently true on SDK
  // 55) wins. We only write to app.json when overrides.newArchEnabled is set.
  if (overrides.newArchEnabled !== undefined) {
    config.newArchEnabled = overrides.newArchEnabled;
  }

  // Re-validate derived fields. With a placeholder-friendly --name like
  // `example-app`, toBundleId would emit `com.example.example-app`, which the
  // bundle-id validator rejects. Surface that here rather than at first use.
  const derivedErrors = [];
  const schemeErr = validateScheme(config.scheme);
  if (schemeErr) derivedErrors.push(`derived --scheme "${config.scheme}": ${schemeErr}`);
  const bundleErr = validateBundleId(config.bundleId);
  if (bundleErr) derivedErrors.push(`derived --bundle-id "${config.bundleId}": ${bundleErr}`);

  if (derivedErrors.length > 0) {
    derivedErrors.push("Pass --scheme and --bundle-id explicitly to override the derived defaults.");
    return { config: null, errors: derivedErrors };
  }

  return { config, errors: [] };
}

export const HELP_TEXT = `Usage: pnpm create mobile-surfaces [<project-name>] [options]

Interactive (default):
  pnpm create mobile-surfaces

Scripted (non-interactive):
  pnpm create mobile-surfaces --yes \\
    --name my-app --bundle-id com.acme.myapp \\
    --no-install

Options:
  --name <slug>             Project name. Required with --yes.
  --scheme <scheme>         URL scheme. Defaults to slugified project name.
  --bundle-id <id>          iOS bundle id. Defaults to com.example.<slug>.
  --team-id <id>            Apple Team ID. Optional; can be set later.
  --home-widget             Include the home-screen widget surface (default).
  --no-home-widget          Exclude the home-screen widget.
  --control-widget          Include the iOS 18 control widget (default).
  --no-control-widget       Exclude the control widget.
  --install                 Run pnpm install + expo prebuild after scaffold.
  --no-install              Skip post-scaffold install.
  --new-arch                Force Expo's New Architecture on (default).
  --no-new-arch             Opt out of the New Architecture; use the legacy
                            React Native bridge instead.
  --yes, -y                 Non-interactive: accept defaults, skip the recap.
  --help, -h                Show this help.

Exit codes:
  0    success (including --help, EPIPE, and user-cancelled prompts)
  1    user-error (bad flags, target dir not empty, refuse paths, --yes
       missing required values)
  2    environment-error (preflight failed, pnpm/CocoaPods missing,
       install or prebuild failed)
  3    template-error (bundled template tarball or manifest is missing
       or unreadable)
  130  interrupted (Ctrl+C / SIGINT)
`;
