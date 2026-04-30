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
