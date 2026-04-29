import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  toBundleId,
  toScheme,
  toSwiftPrefix,
  validateBundleId,
  validateProjectSlug,
  validateScheme,
  validateTeamId,
} from "../src/validators.mjs";

describe("validateProjectSlug", () => {
  it("accepts kebab-case slugs", () => {
    assert.equal(validateProjectSlug("my-app"), undefined);
    assert.equal(validateProjectSlug("lockscreen-demo"), undefined);
    assert.equal(validateProjectSlug("a"), undefined);
    assert.equal(validateProjectSlug("9-thing"), undefined);
  });

  it("rejects empty, uppercase, leading dash, and special chars", () => {
    assert.match(validateProjectSlug(""), /required/);
    assert.match(validateProjectSlug("My-App"), /Lowercase/);
    assert.match(validateProjectSlug("-leading"), /letter or digit/);
    assert.match(validateProjectSlug("has space"), /Lowercase/);
    assert.match(validateProjectSlug("has_underscore"), /Lowercase/);
  });
});

describe("validateScheme", () => {
  it("accepts lowercase letter-led schemes", () => {
    assert.equal(validateScheme("myapp"), undefined);
    assert.equal(validateScheme("a1"), undefined);
  });

  it("rejects digits-first, dashes, and uppercase", () => {
    assert.match(validateScheme(""), /required/);
    assert.match(validateScheme("9app"), /letter/);
    assert.match(validateScheme("my-app"), /Lowercase/);
    assert.match(validateScheme("MyApp"), /Lowercase/);
  });
});

describe("validateBundleId", () => {
  it("accepts reverse-DNS with at least two segments", () => {
    assert.equal(validateBundleId("com.acme.myapp"), undefined);
    assert.equal(validateBundleId("io.github.user.app"), undefined);
    assert.equal(validateBundleId("a.b"), undefined);
  });

  it("rejects single-segment, leading digit, and bad separators", () => {
    assert.match(validateBundleId(""), /required/);
    assert.match(validateBundleId("just-one-segment"), /reverse-DNS/);
    assert.match(validateBundleId("9.starts-with-digit"), /reverse-DNS/);
    assert.match(validateBundleId("with spaces.bad"), /reverse-DNS/);
  });
});

describe("validateTeamId", () => {
  it("accepts exactly 10 uppercase alphanumerics", () => {
    assert.equal(validateTeamId("ABCDEFGHIJ"), undefined);
    assert.equal(validateTeamId("A1B2C3D4E5"), undefined);
  });

  it("treats empty as skip (allowed)", () => {
    assert.equal(validateTeamId(""), undefined);
    assert.equal(validateTeamId(undefined), undefined);
  });

  it("rejects wrong length and lowercase", () => {
    assert.match(validateTeamId("ABCDEFGHI"), /10 uppercase/);
    assert.match(validateTeamId("ABCDEFGHIJK"), /10 uppercase/);
    assert.match(validateTeamId("abcdefghij"), /10 uppercase/);
  });
});

describe("default-derivation helpers", () => {
  it("toScheme strips non-alphanumerics", () => {
    assert.equal(toScheme("My App"), "myapp");
    assert.equal(toScheme("lockscreen-demo"), "lockscreendemo");
    assert.equal(toScheme("a-b-c"), "abc");
  });

  it("toBundleId produces a valid placeholder", () => {
    assert.equal(toBundleId("my-app"), "com.example.my-app");
    assert.equal(validateBundleId(toBundleId("any-name")), undefined);
  });

  it("toSwiftPrefix camelcases project name", () => {
    assert.equal(toSwiftPrefix("my-app"), "MyApp");
    assert.equal(toSwiftPrefix("lockscreen demo"), "LockscreenDemo");
    assert.equal(toSwiftPrefix("foo_bar.baz"), "FooBarBaz");
  });
});
