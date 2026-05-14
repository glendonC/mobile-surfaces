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

// Pin the CLI to live (monorepo-source) mode for the whole test. Without
// this pin, template-manifest.mjs's resolveCliMode() probes for the
// gitignored template/manifest.json + template.tgz build outputs and runs
// in "bundled" mode if they happen to exist on disk. Whether they exist is
// pure local history: a fresh CI checkout has none (so it ran live), but a
// developer who ever ran `build:template` has stale ones (so they ran
// bundled, against a frozen snapshot). That made this exact test pass in
// CI and fail locally (or vice versa) for reasons unrelated to the
// template. Forcing "live" makes the mode deterministic everywhere.
//
// Live mode is also the correct mode for this test: its job is to catch
// drift between the committed monorepo source and the committed snapshot
// hashes. The bundled tarball is a publish artifact with its own coverage
// (the `Pack-and-install smoke` CI step / scripts/smoke-pack-and-install.sh).
// resolveCliMode() is lazy: it runs on the first copyTemplate() call, not
// at import, so setting the env var in the module body here lands before
// any runTasks() call below. Set unconditionally so SNAPSHOT_UPDATE and
// verification runs share the same mode.
process.env.MOBILE_SURFACES_CLI_MODE = "live";

// When regenerating, capture the working tree (committed + uncommitted +
// untracked-but-not-gitignored) rather than the default `git archive HEAD`.
// Without this, editing a template file and running SNAPSHOT_UPDATE=1
// produces snapshots pinned to the pre-edit state — the regen drifts again
// the moment the edit is committed. See copyTemplate in scaffold.mjs.
//
// Verification mode (no SNAPSHOT_UPDATE) still uses HEAD so CI catches
// "committed source drifted from snapshot" as it always has.
if (SHOULD_UPDATE) {
  process.env.MOBILE_SURFACES_SCAFFOLD_FROM_WORKING_TREE = "1";
}

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

// Two sources of expected-but-noisy drift in the materialized scaffold:
//   1. rename-starter.mjs writes a `ranAt: <ISO timestamp>` into
//      .mobile-surfaces-identity.json on every run.
//   2. Linked package versions (apps/mobile/package.json and friends) bump
//      on every release, which would otherwise force a manual snapshot
//      update on every linked-bump PR even when the scaffold output is
//      semantically unchanged.
// Normalize both before hashing so the rest of the file still gets diff
// coverage.
const IDENTITY_MANIFEST = ".mobile-surfaces-identity.json";

function normalizeForHash(rel, raw) {
  if (rel === IDENTITY_MANIFEST) {
    try {
      const parsed = JSON.parse(raw.toString("utf8"));
      if (typeof parsed.ranAt === "string") parsed.ranAt = "<NORMALIZED>";
      return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
    } catch {
      return raw;
    }
  }
  if (rel === "package.json" || rel.endsWith("/package.json")) {
    try {
      const parsed = JSON.parse(raw.toString("utf8"));
      if (typeof parsed.version === "string") parsed.version = "<NORMALIZED>";
      return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
    } catch {
      return raw;
    }
  }
  return raw;
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
//   - **/CHANGELOG.md: rewritten on every release by `changeset version`,
//     so without this exclusion every Version-packages PR drifts the
//     snapshot. The snapshot's job is to catch template drift; CHANGELOG
//     churn is a release artifact that says nothing about scaffold output
//   - packages/surface-contracts/schema.json: the $id URL embeds the
//     package's minor version, so every minor bump invalidates the file.
//     Drift between Zod source and generated schema is already gated by
//     MS006 (build-schema --check); the scaffold snapshot doesn't need to
//     duplicate that signal
const SCAFFOLD_PATH_EXCLUDES = [
  "packages/create-mobile-surfaces/test/",
  ".changeset/",
  "packages/surface-contracts/schema.json",
];

function isExcluded(rel) {
  if (rel.endsWith(".DS_Store")) return true;
  if (rel === "CHANGELOG.md" || rel.endsWith("/CHANGELOG.md")) return true;
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
