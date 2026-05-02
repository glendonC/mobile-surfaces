// Tiny readline-backed prompt helpers for interactive scripts. Plain Node,
// no external deps — same discipline as scripts/diagnose.mjs. The
// create-mobile-surfaces CLI uses @inquirer/prompts for richer UX; these
// helpers are the lightweight alternative for one-off scripts.
//
// All asks return a Promise. Ctrl-C / EOF resolves to the CANCELLED sentinel
// so callers can detect cancellation and exit cleanly without surfacing a
// readline error.

import readline from "node:readline";

export const CANCELLED = Symbol("prompt-cancelled");

function makeRl() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdout.isTTY,
  });
}

function rlQuestion(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
    rl.once("close", () => resolve(CANCELLED));
  });
}

/**
 * Ask for free-form text. Re-prompts on validation failure.
 *
 * @param {object} opts
 * @param {string} opts.message
 * @param {string} [opts.defaultValue]
 * @param {(value: string) => string|null|undefined} [opts.validate]
 *   Returns an error message, or null/undefined when the value is OK.
 */
export async function askText({ message, defaultValue, validate } = {}) {
  const rl = makeRl();
  try {
    while (true) {
      const hint = defaultValue ? ` (${defaultValue})` : "";
      const raw = await rlQuestion(rl, `${message}${hint}: `);
      if (raw === CANCELLED) return CANCELLED;
      const value = raw.trim() === "" ? (defaultValue ?? "") : raw.trim();
      const err = validate ? validate(value) : null;
      if (err) {
        process.stdout.write(`  ${err}\n`);
        continue;
      }
      return value;
    }
  } finally {
    rl.close();
  }
}

/**
 * Yes/no toggle. Accepts y/yes/n/no (case-insensitive). Empty input takes
 * the default. Re-prompts on garbage.
 */
export async function askYesNo({ message, defaultValue = true } = {}) {
  const rl = makeRl();
  try {
    while (true) {
      const hint = defaultValue ? "Y/n" : "y/N";
      const raw = await rlQuestion(rl, `${message} (${hint}): `);
      if (raw === CANCELLED) return CANCELLED;
      const trimmed = raw.trim().toLowerCase();
      if (trimmed === "") return defaultValue;
      if (trimmed === "y" || trimmed === "yes") return true;
      if (trimmed === "n" || trimmed === "no") return false;
      process.stdout.write("  Please answer y or n.\n");
    }
  } finally {
    rl.close();
  }
}

/**
 * Pick one option from a list. `options` is an array of `{value, label}`.
 * Empty input picks defaultValue (must be one of the option values).
 */
export async function askChoice({ message, options, defaultValue } = {}) {
  if (!options?.length) {
    throw new Error("askChoice requires at least one option.");
  }
  const rl = makeRl();
  try {
    process.stdout.write(`${message}\n`);
    options.forEach((opt, i) => {
      const star = opt.value === defaultValue ? "*" : " ";
      process.stdout.write(`  ${i + 1}.${star} ${opt.label}\n`);
    });
    while (true) {
      const hint = defaultValue
        ? ` (${options.findIndex((o) => o.value === defaultValue) + 1})`
        : "";
      const raw = await rlQuestion(rl, `Pick one${hint}: `);
      if (raw === CANCELLED) return CANCELLED;
      const trimmed = raw.trim();
      if (trimmed === "" && defaultValue !== undefined) return defaultValue;
      const idx = Number.parseInt(trimmed, 10) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < options.length) {
        return options[idx].value;
      }
      process.stdout.write(`  Pick a number 1–${options.length}.\n`);
    }
  } finally {
    rl.close();
  }
}

/** Convenience: did this resolve to CANCELLED? */
export function isCancelled(value) {
  return value === CANCELLED;
}
