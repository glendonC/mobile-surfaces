// File-level backup session for the add-to-existing apply phase.
//
// The greenfield path stages into a sibling dir and atomically swaps it
// into place (scaffold.mjs::makeStagingPath/promoteStaging/rollbackStaging).
// Add-to-existing cannot do the same - it edits a project that already has
// the user's work in it - so we instead snapshot every file we are about
// to modify or create, run the apply, and either delete the snapshot
// (commit) or restore from it (rollback).
//
// Coverage:
//   - recordFile(absPath): copies the original bytes into the backup dir
//     if the file exists. On rollback, the file is restored to those bytes
//     (or removed if it didn't exist beforehand). Idempotent: a second call
//     for the same path is a no-op so a single file can be edited by
//     multiple apply steps without ballooning the backup.
//   - recordDir(absPath): records that the apply is about to populate a
//     directory. On rollback, the directory is removed (if it didn't
//     exist beforehand) or emptied (if it existed but was empty). Refuses
//     to track a non-empty pre-existing dir, since the caller is then
//     about to mutate user content the recordFile path should have
//     captured instead.
//
// Out of scope:
//   - Restoring node_modules. A failed `pnpm add` leaves node_modules in
//     an unknown state; the package.json/lockfile backup restores the
//     declared deps, and the user reruns `pnpm install` to rebuild.
//   - Parent-directory cleanup. If the apply's mkdir of parents
//     incidentally creates a `targets/` dir, rollback leaves that empty
//     dir behind. Cosmetic, not a correctness issue.
//   - SIGINT-driven rollback. Ctrl+C handling lives at the CLI top level;
//     this module fires rollback only on a thrown error from the apply.

import fs from "node:fs";
import path from "node:path";

/**
 * A BackupSession owns the backup directory and the manifest of recorded
 * mutations. One session per apply phase.
 */
export class BackupSession {
  #root;
  #backupDir;
  #manifest = [];
  #state = "open"; // "open" | "committed" | "rolledBack"
  #counter = 0;

  /**
   * @param {{ root: string, timestamp?: Date }} opts
   */
  constructor({ root, timestamp }) {
    if (!root) throw new Error("BackupSession requires a root directory");
    this.#root = path.resolve(root);
    const stamp = isoStamp(timestamp ?? new Date());
    this.#backupDir = path.join(this.#root, `.create-mobile-surfaces-backup-${stamp}`);
    fs.mkdirSync(this.#backupDir, { recursive: true });
  }

  /** Path of the backup directory. Useful for diagnostics and tests. */
  get backupDir() {
    return this.#backupDir;
  }

  /** Shallow copy of the recorded manifest. Read-only for callers. */
  get manifest() {
    return this.#manifest.map((e) => ({ ...e }));
  }

  /** State machine: "open" until commit() or rollback() flips it. */
  get state() {
    return this.#state;
  }

  /**
   * Record a file that the apply is about to modify or create. Call BEFORE
   * the mutation. Idempotent on repeat calls for the same path.
   */
  recordFile(absPath) {
    this.#assertOpen();
    const resolved = path.resolve(absPath);
    if (this.#manifest.some((e) => e.kind === "file" && e.path === resolved)) return;
    const existed = fs.existsSync(resolved);
    let backupPath = null;
    if (existed) {
      this.#counter += 1;
      backupPath = path.join(
        this.#backupDir,
        `f${this.#counter}-${path.basename(resolved)}`,
      );
      fs.copyFileSync(resolved, backupPath);
    }
    this.#manifest.push({ kind: "file", path: resolved, existed, backupPath });
  }

  /**
   * Record a directory the apply is about to populate. Call BEFORE the
   * first write inside it. The dir may be absent or pre-existing-empty;
   * a non-empty pre-existing dir is rejected because recordDir cannot
   * surgically undo writes into it.
   */
  recordDir(absPath) {
    this.#assertOpen();
    const resolved = path.resolve(absPath);
    if (this.#manifest.some((e) => e.kind === "dir" && e.path === resolved)) return;
    let existedNonEmpty = false;
    let existed = false;
    if (fs.existsSync(resolved)) {
      existed = true;
      const entries = fs.readdirSync(resolved);
      existedNonEmpty = entries.length > 0;
    }
    if (existedNonEmpty) {
      throw new Error(
        `recordDir called on a non-empty existing directory ${resolved}. ` +
          "Use recordFile for surgical edits inside an existing dir, or refuse the apply.",
      );
    }
    this.#manifest.push({ kind: "dir", path: resolved, existed });
  }

  /**
   * Restore the pre-apply state. Walks the manifest in reverse so later
   * mutations are unwound first. Best-effort: per-entry errors are
   * collected, the backup directory is removed unconditionally at the end,
   * and an aggregate error is thrown when any restore step failed so the
   * caller can surface "rollback completed with errors".
   */
  async rollback() {
    if (this.#state === "committed") {
      throw new Error("BackupSession already committed");
    }
    if (this.#state === "rolledBack") return;
    this.#state = "rolledBack";

    const errors = [];
    for (let i = this.#manifest.length - 1; i >= 0; i--) {
      const entry = this.#manifest[i];
      try {
        if (entry.kind === "file") {
          this.#restoreFile(entry);
        } else if (entry.kind === "dir") {
          this.#restoreDir(entry);
        }
      } catch (err) {
        errors.push({ entry, error: err });
      }
    }
    try {
      fs.rmSync(this.#backupDir, { recursive: true, force: true });
    } catch (err) {
      errors.push({ entry: { kind: "backupDir", path: this.#backupDir }, error: err });
    }
    if (errors.length > 0) {
      const message = errors
        .map((e) => `  - ${e.entry.kind} ${e.entry.path}: ${e.error.message}`)
        .join("\n");
      const aggregate = new Error(
        `Rollback completed with ${errors.length} error(s):\n${message}`,
      );
      aggregate.causes = errors;
      throw aggregate;
    }
  }

  /** Mark the apply committed and delete the backup directory. */
  async commit() {
    if (this.#state === "rolledBack") {
      throw new Error("BackupSession was rolled back; cannot commit");
    }
    if (this.#state === "committed") return;
    this.#state = "committed";
    fs.rmSync(this.#backupDir, { recursive: true, force: true });
  }

  // ---------- private ----------

  #assertOpen() {
    if (this.#state !== "open") {
      throw new Error(`BackupSession is ${this.#state}; cannot record more entries`);
    }
  }

  #restoreFile(entry) {
    if (entry.existed) {
      // copyFileSync overwrites; ensures the file is back to its
      // original bytes whether the apply replaced or merely edited it.
      fs.copyFileSync(entry.backupPath, entry.path);
    } else if (fs.existsSync(entry.path)) {
      fs.rmSync(entry.path, { force: true });
    }
  }

  #restoreDir(entry) {
    if (!fs.existsSync(entry.path)) return;
    if (entry.existed) {
      // Pre-existing empty dir: remove the contents the apply added, leave
      // the (now-empty) dir in place.
      for (const name of fs.readdirSync(entry.path)) {
        fs.rmSync(path.join(entry.path, name), { recursive: true, force: true });
      }
    } else {
      fs.rmSync(entry.path, { recursive: true, force: true });
    }
  }
}

function isoStamp(date) {
  // 2026-05-13T15-22-04-123Z - filesystem-safe and lexicographically sortable.
  return date.toISOString().replace(/[:.]/g, "-");
}
