import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { BackupSession } from "../src/backup.mjs";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-backup-"));
});

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("BackupSession", () => {
  it("creates a timestamped backup directory under the root on construction", () => {
    const session = new BackupSession({ root: tmp });
    assert.ok(fs.existsSync(session.backupDir));
    assert.equal(path.dirname(session.backupDir), path.resolve(tmp));
    assert.match(path.basename(session.backupDir), /^\.create-mobile-surfaces-backup-/);
  });

  it("recordFile snapshots an existing file's bytes", () => {
    const f = path.join(tmp, "config.json");
    fs.writeFileSync(f, "original");
    const session = new BackupSession({ root: tmp });
    session.recordFile(f);
    const entry = session.manifest[0];
    assert.equal(entry.kind, "file");
    assert.equal(entry.existed, true);
    assert.ok(entry.backupPath && fs.existsSync(entry.backupPath));
    assert.equal(fs.readFileSync(entry.backupPath, "utf8"), "original");
  });

  it("recordFile records absence when the file does not exist yet", () => {
    const f = path.join(tmp, "new.json");
    const session = new BackupSession({ root: tmp });
    session.recordFile(f);
    const entry = session.manifest[0];
    assert.equal(entry.existed, false);
    assert.equal(entry.backupPath, null);
  });

  it("recordFile is idempotent for the same path", () => {
    const f = path.join(tmp, "config.json");
    fs.writeFileSync(f, "v1");
    const session = new BackupSession({ root: tmp });
    session.recordFile(f);
    // Mutate so a second backup, if taken, would capture different bytes.
    fs.writeFileSync(f, "v2");
    session.recordFile(f);
    assert.equal(session.manifest.length, 1);
    assert.equal(fs.readFileSync(session.manifest[0].backupPath, "utf8"), "v1");
  });

  it("rollback restores an edited file to its original bytes", async () => {
    const f = path.join(tmp, "config.json");
    fs.writeFileSync(f, "original");
    const session = new BackupSession({ root: tmp });
    session.recordFile(f);
    fs.writeFileSync(f, "mutated");

    await session.rollback();
    assert.equal(fs.readFileSync(f, "utf8"), "original");
    assert.equal(fs.existsSync(session.backupDir), false);
  });

  it("rollback removes a file that was created by the apply", async () => {
    const f = path.join(tmp, "new.json");
    const session = new BackupSession({ root: tmp });
    session.recordFile(f);
    fs.writeFileSync(f, "added by apply");

    await session.rollback();
    assert.equal(fs.existsSync(f), false);
  });

  it("recordDir tracks a directory the apply is about to create", async () => {
    const d = path.join(tmp, "widget");
    const session = new BackupSession({ root: tmp });
    session.recordDir(d);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "a.swift"), "x");

    await session.rollback();
    assert.equal(fs.existsSync(d), false);
  });

  it("recordDir on a pre-existing empty dir empties the dir on rollback (preserves the dir)", async () => {
    const d = path.join(tmp, "widget");
    fs.mkdirSync(d);
    const session = new BackupSession({ root: tmp });
    session.recordDir(d);
    fs.writeFileSync(path.join(d, "a.swift"), "x");

    await session.rollback();
    assert.equal(fs.existsSync(d), true);
    assert.deepEqual(fs.readdirSync(d), []);
  });

  it("recordDir refuses to track a non-empty pre-existing directory", () => {
    const d = path.join(tmp, "widget");
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "user.swift"), "user content");
    const session = new BackupSession({ root: tmp });
    assert.throws(
      () => session.recordDir(d),
      /non-empty existing directory/,
    );
  });

  it("commit deletes the backup directory and locks the session", async () => {
    const session = new BackupSession({ root: tmp });
    await session.commit();
    assert.equal(fs.existsSync(session.backupDir), false);
    assert.equal(session.state, "committed");
    assert.throws(() => session.recordFile(path.join(tmp, "x")), /committed/);
  });

  it("rollback after commit throws (you can't undo a commit)", async () => {
    const session = new BackupSession({ root: tmp });
    await session.commit();
    await assert.rejects(session.rollback(), /already committed/);
  });

  it("commit after rollback throws (you can't commit a rolled-back session)", async () => {
    const session = new BackupSession({ root: tmp });
    await session.rollback();
    await assert.rejects(session.commit(), /rolled back/);
  });

  it("rollback in reverse manifest order: later entries are unwound first", async () => {
    // Stage two file edits in sequence and assert that rollback restores
    // both. Order matters when entries overlap (e.g., editing file A
    // after creating file A); reverse order undoes the create after the
    // edit is reverted to "no-op" rather than the other way around.
    const a = path.join(tmp, "a.json");
    const b = path.join(tmp, "b.json");
    fs.writeFileSync(a, "a-original");
    const session = new BackupSession({ root: tmp });
    session.recordFile(a);
    fs.writeFileSync(a, "a-mutated");
    session.recordFile(b);
    fs.writeFileSync(b, "b-added");

    await session.rollback();
    assert.equal(fs.readFileSync(a, "utf8"), "a-original");
    assert.equal(fs.existsSync(b), false);
  });

  it("rollback aggregates per-entry errors but still removes the backup dir", async () => {
    const f = path.join(tmp, "config.json");
    fs.writeFileSync(f, "original");
    const session = new BackupSession({ root: tmp });
    session.recordFile(f);
    fs.writeFileSync(f, "mutated");
    // Delete the backup copy to force restore failure on this entry.
    fs.rmSync(session.manifest[0].backupPath);

    await assert.rejects(session.rollback(), /Rollback completed with/);
    assert.equal(fs.existsSync(session.backupDir), false);
  });

  it("two concurrent sessions produce distinct backup directories", () => {
    const a = new BackupSession({ root: tmp });
    const b = new BackupSession({ root: tmp, timestamp: new Date(Date.now() + 1) });
    assert.notEqual(a.backupDir, b.backupDir);
    assert.ok(fs.existsSync(a.backupDir));
    assert.ok(fs.existsSync(b.backupDir));
  });
});
