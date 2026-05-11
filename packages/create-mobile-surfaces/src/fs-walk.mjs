// Shared filesystem walker. apply-existing, apply-monorepo, and strip used to
// each have their own copy of the same recursive readdirSync loop with
// slightly different skip-dir and text-extension sets. They now share this
// helper so a change to skip rules or extension policy only needs to be made
// once.
//
// The walker stays synchronous because the call sites already serialize on
// the result (sort the files, then do bounded-concurrency I/O). Moving the
// walk itself off the event loop wouldn't speed anything up; clarity wins.

import fs from "node:fs";
import path from "node:path";

/**
 * Recursively walk `rootDir`, returning absolute paths of every regular file
 * the optional `filter` accepts.
 *
 *   - `skipDirs`: Set of directory basenames to prune (e.g. node_modules, .git).
 *     Match is exact on the entry name, not the full path.
 *   - `filter(entry, fullPath)`: optional per-file predicate. When omitted,
 *     every regular file is returned.
 */
export function walkFiles({ rootDir, skipDirs, filter } = {}) {
  if (!rootDir) throw new TypeError("walkFiles: rootDir is required");
  const out = [];
  visit(rootDir);
  return out;

  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs && skipDirs.has(entry.name)) continue;
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!filter || filter(entry, full)) out.push(full);
    }
  }
}

/**
 * Standard text-file predicate. A direntry is text when its lowercase
 * extension is in `textExts`, or its full basename is in `textBasenames`.
 * Returns a function suitable for passing to walkFiles({ filter }).
 */
export function makeTextFileFilter({ textExts, textBasenames } = {}) {
  return (entry) => {
    if (textBasenames && textBasenames.has(entry.name)) return true;
    if (!textExts) return false;
    return textExts.has(path.extname(entry.name).toLowerCase());
  };
}
