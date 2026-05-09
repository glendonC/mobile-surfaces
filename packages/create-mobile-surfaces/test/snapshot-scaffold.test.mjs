// Snapshot the materialized scaffold tree for each surface combo. The four
// trees come from runTasks (extract template tarball -> applyStripGreenfield
// -> renameIdentity), which is what the CLI runs end-to-end before install.
// installNow doesn't affect the file tree (it just decides whether pnpm
// install fires), so we pin it false and only iterate homeWidget × controlWidget.
//
// Snapshots are committed in test/snapshots/<combo>.txt as `<path>\t<sha256>`
// lines, sorted by path. Run with SNAPSHOT_UPDATE=1 to regenerate after an
// intentional template change.

import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runTasks } from "../src/run-tasks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(__dirname, "snapshots");
const SHOULD_UPDATE = process.env.SNAPSHOT_UPDATE === "1";

const SCAFFOLD_CONFIG = Object.freeze({
  projectName: "snapshot-app",
  scheme: "snapshotapp",
  bundleId: "com.snapshot.app",
  teamId: null,
  installNow: false,
});

const COMBOS = [
  { homeWidget: true, controlWidget: true },
  { homeWidget: true, controlWidget: false },
  { homeWidget: false, controlWidget: true },
  { homeWidget: false, controlWidget: false },
];

function comboName(s) {
  return `hw-${s.homeWidget}-cw-${s.controlWidget}`;
}

// rename-starter.mjs writes a `ranAt: <ISO timestamp>` into
// .mobile-surfaces-identity.json on every run. Replace it with a fixed
// placeholder so the rest of the manifest's contents still get diff coverage.
const IDENTITY_MANIFEST = ".mobile-surfaces-identity.json";

function normalizeForHash(rel, raw) {
  if (rel !== IDENTITY_MANIFEST) return raw;
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    if (typeof parsed.ranAt === "string") parsed.ranAt = "<NORMALIZED>";
    return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
  } catch {
    return raw;
  }
}

// Paths excluded from the snapshot. All of these are repo infrastructure
// that's tangential to the snapshot's intent (catching drift in user-facing
// scaffold output) AND would otherwise create false positives whenever
// release/test infra files come and go:
//   - packages/create-mobile-surfaces/test/: bootstrap loop — adding a test
//     file here changes the snapshot the test asserts against
//   - .changeset/: changeset files are added per-PR and consumed by
//     `pnpm changeset version` on release. Without this exclusion, every
//     release PR breaks CI on its own changeset file, and the bot's
//     "Version packages" PR breaks again when it deletes the file
const SCAFFOLD_PATH_EXCLUDES = [
  "packages/create-mobile-surfaces/test/",
  ".changeset/",
];

function isExcluded(rel) {
  if (rel.endsWith(".DS_Store")) return true;
  for (const prefix of SCAFFOLD_PATH_EXCLUDES) {
    if (rel === prefix.replace(/\/$/, "")) return true;
    if (rel.startsWith(prefix)) return true;
  }
  return false;
}

function walkTree(rootDir) {
  const entries = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      const rel = path.relative(rootDir, full);
      if (isExcluded(rel)) continue;
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (stat.isFile()) {
        entries.push(rel);
      }
    }
  }
  entries.sort();
  return entries;
}

function buildSnapshot(rootDir) {
  const lines = walkTree(rootDir).map((rel) => {
    const raw = fs.readFileSync(path.join(rootDir, rel));
    const normalized = normalizeForHash(rel, raw);
    const hash = crypto.createHash("sha256").update(normalized).digest("hex");
    return `${rel}\t${hash}`;
  });
  return lines.join("\n") + "\n";
}

function diffFirstLine(actual, expected) {
  const a = actual.split("\n");
  const e = expected.split("\n");
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if (a[i] !== e[i]) {
      return `line ${i + 1}:\n  expected: ${JSON.stringify(e[i] ?? "<EOF>")}\n  actual:   ${JSON.stringify(a[i] ?? "<EOF>")}`;
    }
  }
  return "(no diff?)";
}

describe("scaffold-tree snapshots", () => {
  for (const surfaces of COMBOS) {
    it(`materializes a stable tree for ${comboName(surfaces)}`, async () => {
      const target = fs.mkdtempSync(
        path.join(os.tmpdir(), `cms-snap-${comboName(surfaces)}-`),
      );
      try {
        await runTasks({
          config: { ...SCAFFOLD_CONFIG, surfaces },
          target,
        });
        const actual = buildSnapshot(target);
        const snapshotPath = path.join(SNAPSHOT_DIR, `${comboName(surfaces)}.txt`);

        if (SHOULD_UPDATE) {
          fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
          fs.writeFileSync(snapshotPath, actual);
          return;
        }

        if (!fs.existsSync(snapshotPath)) {
          assert.fail(
            `Missing snapshot ${snapshotPath}. Run \`SNAPSHOT_UPDATE=1 pnpm cli:test\` to generate it.`,
          );
        }
        const expected = fs.readFileSync(snapshotPath, "utf8");
        assert.equal(
          actual,
          expected,
          `Scaffold tree drifted for ${comboName(surfaces)}.\n${diffFirstLine(actual, expected)}\n\nIf this is intentional, run \`SNAPSHOT_UPDATE=1 pnpm cli:test\` to regenerate.`,
        );
      } finally {
        fs.rmSync(target, { recursive: true, force: true });
      }
    });
  }
});
