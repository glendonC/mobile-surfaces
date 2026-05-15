import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_IDENTITY,
  IDENTITY_MANIFEST_FILE,
  loadCurrentIdentity,
  buildSubstitutions,
  isIdempotent,
  walkTextFiles,
  applyTextRewrites,
  resetAppsMobileChangelog,
  dropSchemaId,
  renameCliPackageDir,
  TEXT_EXTENSIONS,
  SKIP_DIRS,
  SKIP_PATH_PREFIXES,
} from "./rename-starter.mjs";

function makeTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rename-starter-test-"));
}

test("loadCurrentIdentity returns the default identity when no manifest is present", () => {
  const dir = makeTempRepo();
  try {
    const identity = loadCurrentIdentity(dir);
    assert.deepEqual(identity, DEFAULT_IDENTITY);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadCurrentIdentity returns the manifest content when the manifest is present", () => {
  const dir = makeTempRepo();
  try {
    const stamped = {
      version: 1,
      ranAt: "2026-04-29T22:00:00.000Z",
      name: "Foo App",
      scheme: "foo",
      bundleId: "com.acme.foo",
      widgetTarget: "FooWidget",
      swiftPrefix: "Foo",
      slug: "foo-app",
      appPackageName: "foo-app",
    };
    fs.writeFileSync(path.join(dir, IDENTITY_MANIFEST_FILE), JSON.stringify(stamped));
    const identity = loadCurrentIdentity(dir);
    assert.equal(identity.name, "Foo App");
    assert.equal(identity.scheme, "foo");
    assert.equal(identity.bundleId, "com.acme.foo");
    assert.equal(identity.widgetTarget, "FooWidget");
    assert.equal(identity.swiftPrefix, "Foo");
    assert.equal(identity.slug, "foo-app");
    assert.equal(identity.appPackageName, "foo-app");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildSubstitutions derives correct from→to pairs from two identities", () => {
  const current = { ...DEFAULT_IDENTITY };
  const next = {
    name: "Foo App",
    scheme: "foo",
    bundleId: "com.acme.foo",
    widgetTarget: "FooWidget",
    swiftPrefix: "Foo",
    slug: "foo-app",
    appPackageName: "foo-app",
  };
  const subs = buildSubstitutions(current, next);
  // Spot check that every key roundtrips and that bundle-id (longest, most-
  // specific) sorts before scheme (shortest), so substring rewrites don't
  // chew through "com.example.mobilesurfaces" before it matches whole.
  const map = Object.fromEntries(subs);
  assert.equal(map["com.example.mobilesurfaces"], "com.acme.foo");
  assert.equal(map["Mobile Surfaces"], "Foo App");
  assert.equal(map["MobileSurfacesWidget"], "FooWidget");
  assert.equal(map["MobileSurfaces"], "Foo");
  assert.equal(map["mobile-surfaces-app"], "foo-app");
  assert.equal(map["mobile-surfaces"], "foo-app");
  assert.equal(map["mobilesurfaces"], "foo");

  // Order: bundleId comes before scheme; widget-target before swift-prefix;
  // slug-app before slug. Verify the relative ordering.
  const keys = subs.map(([from]) => from);
  assert.ok(keys.indexOf("com.example.mobilesurfaces") < keys.indexOf("mobilesurfaces"));
  assert.ok(keys.indexOf("MobileSurfacesWidget") < keys.indexOf("MobileSurfaces"));
  assert.ok(keys.indexOf("mobile-surfaces-app") < keys.indexOf("mobile-surfaces"));
});

test("isIdempotent returns true when the identity hasn't changed", () => {
  const subs = buildSubstitutions({ ...DEFAULT_IDENTITY }, { ...DEFAULT_IDENTITY });
  assert.equal(isIdempotent(subs), true);
});

test("isIdempotent returns false when at least one field would change", () => {
  const next = { ...DEFAULT_IDENTITY, name: "Foo App" };
  const subs = buildSubstitutions({ ...DEFAULT_IDENTITY }, next);
  assert.equal(isIdempotent(subs), false);
});

// Files outside the original enumerated allowlist that real consumer projects
// were observed to contain on top of mobile-surfaces. Each must be discovered
// by the recursive walk and rewritten so `pnpm typecheck` doesn't fail with
// `Cannot find module '@mobile-surfaces/...'` after rename.
const RESIDUE_FIXTURES = {
  "apps/mobile/src/components/SetupStatusRow.tsx":
    `import { liveActivityAdapter } from "@mobile-surfaces/live-activity";\nexport const a = liveActivityAdapter;\n`,
  "apps/mobile/src/diagnostics/checkSetup.ts":
    `import { traps } from "@mobile-surfaces/surface-contracts";\nexport const t = traps;\n`,
  "packages/push/package.json":
    `{"name":"@mobile-surfaces/push","dependencies":{"@mobile-surfaces/surface-contracts":"workspace:*"}}\n`,
  "packages/push/src/client.ts":
    `import { liveSurfaceSnapshot } from "@mobile-surfaces/surface-contracts";\nexport const s = liveSurfaceSnapshot;\n`,
  "packages/surface-contracts/CHANGELOG.md":
    `# @mobile-surfaces/surface-contracts\n\n## 1.0.0 — initial\n`,
  "packages/live-activity/tsup.config.ts":
    `import { defineConfig } from "tsup";\n// part of @mobile-surfaces\nexport default defineConfig({});\n`,
  "apps/mobile/src/liveActivity/index.ts":
    `export * from "@mobile-surfaces/live-activity";\n`,
  ".env.example":
    `APNS_BUNDLE_ID="com.example.mobilesurfaces"\nAPNS_KEY_PATH="$HOME/.mobile-surfaces/AuthKey.p8"\n`,
  ".gitignore":
    `mobile-surfaces-diagnose-*.json\n.mobile-surfaces-identity.json\n`,
  "deeply/nested/some/path/extra.ts":
    `export const slug = "@mobile-surfaces/surface-contracts";\n`,
};

// Files that must NOT be rewritten — generated, regenerated, or internal
// scaffolding whose constants drive the rename itself.
const SKIPPED_FIXTURES = {
  "node_modules/something/index.js": `module.exports = "@mobile-surfaces/x";\n`,
  ".git/config": `[remote] url = mobile-surfaces\n`,
  "apps/mobile/ios/Podfile.lock": `mobile-surfaces\n`,
  "packages/push/dist/index.js": `// built artifact: @mobile-surfaces/push\n`,
  "pnpm-lock.yaml": `lockfileVersion: '9.0'\n# @mobile-surfaces/surface-contracts\n`,
};

function makeFixtureRepo(files) {
  const dir = makeTempRepo();
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

function readAllTextFiles(rootDir) {
  const out = {};
  walk(rootDir, "");
  return out;

  function walk(absDir, relDir) {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const childAbs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(childAbs, childRel);
      } else if (entry.isFile()) {
        try {
          out[childRel] = fs.readFileSync(childAbs, "utf8");
        } catch {
          // binary or unreadable; skip
        }
      }
    }
  }
}

test("walkTextFiles excludes node_modules, .git, dist, build, and apps/mobile/ios", () => {
  const dir = makeFixtureRepo({ ...RESIDUE_FIXTURES, ...SKIPPED_FIXTURES });
  try {
    const found = new Set(walkTextFiles(dir));
    // Every residue fixture should be discovered.
    for (const rel of Object.keys(RESIDUE_FIXTURES)) {
      assert.ok(found.has(rel), `expected walk to discover ${rel}`);
    }
    // No skipped path should be discovered.
    for (const rel of Object.keys(SKIPPED_FIXTURES)) {
      assert.ok(!found.has(rel), `expected walk to skip ${rel}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("applyTextRewrites leaves no @mobile-surfaces residue in walked files", () => {
  const dir = makeFixtureRepo({ ...RESIDUE_FIXTURES, ...SKIPPED_FIXTURES });
  try {
    const next = {
      name: "K Context",
      scheme: "kcontext",
      bundleId: "com.kcontext.app",
      widgetTarget: "KContextWidget",
      swiftPrefix: "KContext",
      slug: "k-context",
      appPackageName: "k-context-app",
    };
    const subs = buildSubstitutions({ ...DEFAULT_IDENTITY }, next);
    const touched = applyTextRewrites(dir, subs);
    assert.ok(touched >= Object.keys(RESIDUE_FIXTURES).length,
      `expected to rewrite at least ${Object.keys(RESIDUE_FIXTURES).length} files, got ${touched}`);

    const after = readAllTextFiles(dir);
    // Residue check: every walked file must be free of the old identity strings.
    for (const rel of Object.keys(RESIDUE_FIXTURES)) {
      const content = after[rel];
      assert.ok(!content.includes("@mobile-surfaces/"),
        `${rel} still contains @mobile-surfaces/ after rename`);
      assert.ok(!content.includes("mobilesurfaces"),
        `${rel} still contains mobilesurfaces after rename`);
      assert.ok(!content.includes("MobileSurfaces"),
        `${rel} still contains MobileSurfaces after rename`);
    }

    // Skipped paths must retain their original content untouched.
    for (const [rel, original] of Object.entries(SKIPPED_FIXTURES)) {
      assert.equal(after[rel], original, `${rel} should not have been rewritten`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("applyTextRewrites with dryRun does not modify any files", () => {
  const dir = makeFixtureRepo(RESIDUE_FIXTURES);
  try {
    const before = readAllTextFiles(dir);
    const next = { ...DEFAULT_IDENTITY, name: "Foo", slug: "foo" };
    const subs = buildSubstitutions({ ...DEFAULT_IDENTITY }, next);
    const touched = applyTextRewrites(dir, subs, { dryRun: true });
    assert.ok(touched > 0, "expected dry-run to report would-be rewrites");
    const after = readAllTextFiles(dir);
    assert.deepEqual(after, before, "dryRun must not mutate files");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("TEXT_EXTENSIONS covers the file types observed in real consumer projects", () => {
  for (const ext of [".ts", ".tsx", ".mjs", ".json", ".swift", ".md", ".sh"]) {
    assert.ok(TEXT_EXTENSIONS.has(ext), `TEXT_EXTENSIONS missing ${ext}`);
  }
});

test("SKIP_DIRS includes the standard generated/cache directories", () => {
  for (const name of ["node_modules", ".git", "dist", "build"]) {
    assert.ok(SKIP_DIRS.has(name), `SKIP_DIRS missing ${name}`);
  }
});

test("SKIP_PATH_PREFIXES excludes the App Group codegen output", () => {
  // The codegen script regenerates these from the substituted app.json
  // after the rename pass; the substitution pass must not touch them.
  assert.ok(
    SKIP_PATH_PREFIXES.includes("apps/mobile/src/generated"),
    "SKIP_PATH_PREFIXES must skip apps/mobile/src/generated",
  );
  assert.ok(
    SKIP_PATH_PREFIXES.includes(
      "apps/mobile/targets/widget/_shared/MobileSurfacesAppGroup.swift",
    ),
    "SKIP_PATH_PREFIXES must skip MobileSurfacesAppGroup.swift",
  );
});

test("walkTextFiles skips the App Group generated files", () => {
  const dir = makeFixtureRepo({
    "apps/mobile/src/generated/appGroup.ts":
      `export const APP_GROUP = "group.com.example.mobilesurfaces" as const;\n`,
    "apps/mobile/targets/widget/_shared/MobileSurfacesAppGroup.swift":
      `enum MobileSurfacesAppGroup { static let identifier = "group.com.example.mobilesurfaces" }\n`,
    "apps/mobile/src/index.ts":
      `export const x = "@mobile-surfaces/surface-contracts";\n`,
  });
  try {
    const found = new Set(walkTextFiles(dir));
    assert.ok(
      !found.has("apps/mobile/src/generated/appGroup.ts"),
      "appGroup.ts should be skipped",
    );
    assert.ok(
      !found.has(
        "apps/mobile/targets/widget/_shared/MobileSurfacesAppGroup.swift",
      ),
      "MobileSurfacesAppGroup.swift should be skipped",
    );
    // Sanity: the non-skipped sibling under apps/mobile/src/ IS walked.
    assert.ok(
      found.has("apps/mobile/src/index.ts"),
      "non-generated sibling should still be walked",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resetAppsMobileChangelog replaces upstream changelog with a fork stub', () => {
  const dir = makeTempRepo();
  try {
    const target = path.join(dir, 'apps', 'mobile', 'CHANGELOG.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "# mobile-surfaces-app\n\n## 1.0.3\n\n- old\n");
    const replaced = resetAppsMobileChangelog(dir, { appPackageName: 'foo-app' });
    assert.equal(replaced, true);
    const out = fs.readFileSync(target, 'utf8');
    assert.match(out, /# foo-app/);
    assert.match(out, /Unreleased/);
    assert.ok(!out.includes('1.0.3'), 'old version history should be gone');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resetAppsMobileChangelog returns false when the file is absent', () => {
  const dir = makeTempRepo();
  try {
    const replaced = resetAppsMobileChangelog(dir, { appPackageName: 'foo-app' });
    assert.equal(replaced, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dropSchemaId removes the $id key from packages/surface-contracts/schema.json', () => {
  const dir = makeTempRepo();
  try {
    const target = path.join(dir, 'packages', 'surface-contracts', 'schema.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ $id: 'https://x', title: 'Foo', oneOf: [] }, null, 2) + "\n");
    const dropped = dropSchemaId(dir);
    assert.equal(dropped, true);
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.ok(!('$id' in parsed), 'expected $id key to be removed');
    assert.equal(parsed.title, 'Foo', 'siblings preserved');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dropSchemaId is a no-op when $id is not present', () => {
  const dir = makeTempRepo();
  try {
    const target = path.join(dir, 'packages', 'surface-contracts', 'schema.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ title: 'Foo' }, null, 2) + "\n");
    const dropped = dropSchemaId(dir);
    assert.equal(dropped, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renameCliPackageDir moves the CLI dir to match the new slug', () => {
  const dir = makeTempRepo();
  try {
    const from = path.join(dir, 'packages', 'create-mobile-surfaces');
    fs.mkdirSync(from, { recursive: true });
    fs.writeFileSync(path.join(from, 'package.json'), '{}');
    const moved = renameCliPackageDir(dir, { fromSlug: 'mobile-surfaces', toSlug: 'foo-bar' });
    assert.equal(moved, true);
    assert.ok(!fs.existsSync(from), 'source dir should be gone');
    assert.ok(
      fs.existsSync(path.join(dir, 'packages', 'create-foo-bar', 'package.json')),
      'target dir should hold the moved file',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renameCliPackageDir is a no-op when slugs match', () => {
  const dir = makeTempRepo();
  try {
    const from = path.join(dir, 'packages', 'create-mobile-surfaces');
    fs.mkdirSync(from, { recursive: true });
    const moved = renameCliPackageDir(dir, { fromSlug: 'mobile-surfaces', toSlug: 'mobile-surfaces' });
    assert.equal(moved, false);
    assert.ok(fs.existsSync(from), 'source dir should remain');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renameCliPackageDir is a no-op when source dir is absent', () => {
  const dir = makeTempRepo();
  try {
    const moved = renameCliPackageDir(dir, { fromSlug: 'mobile-surfaces', toSlug: 'foo-bar' });
    assert.equal(moved, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renameCliPackageDir refuses to clobber an existing target', () => {
  const dir = makeTempRepo();
  try {
    fs.mkdirSync(path.join(dir, 'packages', 'create-mobile-surfaces'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'packages', 'create-foo-bar'), { recursive: true });
    assert.throws(
      () => renameCliPackageDir(dir, { fromSlug: 'mobile-surfaces', toSlug: 'foo-bar' }),
      /Refusing to rename/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

