// Package manager detection. Two-step lookup:
//   1. The user-agent set by `<pm> create ...` is the strongest signal
//      because it reflects what the user actually typed.
//   2. Walk up looking for a lockfile, so monorepo subdirs find the
//      workspace's package manager.
// Returns "pnpm" | "bun" | "yarn" | "npm" | null.

import fs from "node:fs";
import path from "node:path";

const LOCKFILES = Object.freeze([
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
]);

export function detectPackageManager(cwd) {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm/")) return "pnpm";
  if (ua.startsWith("bun/")) return "bun";
  if (ua.startsWith("yarn/")) return "yarn";
  if (ua.startsWith("npm/")) return "npm";

  // One readdir per level + Set membership instead of N existsSync stat
  // syscalls per level. For a deep nested project this drops the cost of
  // the upward walk from O(levels * lockfiles) stats to O(levels) reads.
  let dir = cwd;
  for (let i = 0; i < 6; i++) {
    let entries;
    try {
      entries = new Set(fs.readdirSync(dir));
    } catch {
      entries = null;
    }
    if (entries) {
      for (const [lockfile, name] of LOCKFILES) {
        if (entries.has(lockfile)) return name;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
