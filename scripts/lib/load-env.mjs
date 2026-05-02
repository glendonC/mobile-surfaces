// Tiny .env loader for scripts. Reads KEY=VALUE pairs from a file and sets
// any unset entries on process.env. Existing process.env keys win — the
// shell still owns the environment, this is only filling in the blanks for
// users who ran `pnpm surface:setup-apns` and never re-sourced their shell.
//
// Deliberately thin:
// - Skips blank lines and lines starting with '#'.
// - Strips a single layer of surrounding double or single quotes.
// - Does NOT expand $VAR references — keeps behavior predictable, no
//   surprise injections from a checked-in .env.
// - Returns a summary of which keys were applied so callers can log what
//   loaded without leaking values.

import fs from "node:fs";
import path from "node:path";

const KEY_VALUE_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

/**
 * Load KEY=VALUE pairs from a file into process.env, without overwriting
 * keys already set in the environment.
 *
 * @param {string} [filePath] Path to the .env file. Defaults to ".env" in
 *   the current working directory.
 * @returns {{ loaded: string[], skipped: string[], filePath: string|null }}
 *   `loaded` is keys we set; `skipped` is keys already present in
 *   process.env. `filePath` is null when no file existed.
 */
export function loadEnvFile(filePath = ".env") {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    return { loaded: [], skipped: [], filePath: null };
  }
  const raw = fs.readFileSync(abs, "utf8");
  const loaded = [];
  const skipped = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const m = trimmed.match(KEY_VALUE_RE);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    // Strip a single matched pair of surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] !== undefined) {
      skipped.push(key);
      continue;
    }
    process.env[key] = value;
    loaded.push(key);
  }
  return { loaded, skipped, filePath: abs };
}
