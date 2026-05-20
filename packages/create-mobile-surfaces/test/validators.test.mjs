import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  toBundleId,
  toScheme,
  toSwiftPrefix,
  validateBundleId,
  validateProjectSlug,
  validateScheme,
  validateSwiftIdentifier,
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

  it("rejects a slug longer than the npm package-name limit", () => {
    assert.match(validateProjectSlug("a".repeat(215)), /214 characters/);
    // 214 characters exactly is still accepted.
    assert.equal(validateProjectSlug("a".repeat(214)), undefined);
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

  it("rejects the com.example.* placeholder Apple bounces on upload", () => {
    assert.match(validateBundleId("com.example.foo"), /placeholder/);
    assert.match(validateBundleId("com.example.foo"), /com\.example/);
    // Casing variants — Apple is case-insensitive on the domain portion.
    assert.match(validateBundleId("COM.EXAMPLE.foo"), /placeholder/);
  });

  it("does not reject other reverse-DNS prefixes that look generic", () => {
    // "acme" is a real reverse-DNS prefix for several orgs; we don't gate.
    assert.equal(validateBundleId("com.acme.foo"), undefined);
  });

  it("rejects reserved vendor prefixes the developer does not own", () => {
    assert.match(validateBundleId("com.apple.myapp"), /reserved vendor prefix/);
    assert.match(validateBundleId("com.google.myapp"), /reserved vendor prefix/);
    assert.match(validateBundleId("com.amazon.myapp"), /reserved vendor prefix/);
    assert.match(
      validateBundleId("com.microsoft.myapp"),
      /reserved vendor prefix/,
    );
    assert.match(
      validateBundleId("com.facebook.myapp"),
      /reserved vendor prefix/,
    );
    assert.match(validateBundleId("com.meta.myapp"), /reserved vendor prefix/);
    // The default React Native template ships org.reactjs.native.example.*;
    // catching it nudges the developer to rename before they ship.
    assert.match(
      validateBundleId("org.reactjs.native.example.app"),
      /reserved vendor prefix/,
    );
    // Case-insensitive on the vendor portion.
    assert.match(validateBundleId("COM.APPLE.myapp"), /reserved vendor prefix/);
  });

  it("does not reject prefixes that merely contain a vendor name mid-segment", () => {
    // The guard is a prefix match; "com.apples.foo" is not com.apple.*.
    assert.equal(validateBundleId("com.apples.foo"), undefined);
    assert.equal(validateBundleId("com.mycompany.google"), undefined);
  });

  it("rejects a bundle id longer than Apple's 155 character limit", () => {
    assert.match(
      validateBundleId(`com.acme.${"a".repeat(160)}`),
      /155 characters/,
    );
    // A 155-char id at the boundary still passes the length gate.
    const atLimit = "com.acme." + "a".repeat(155 - "com.acme.".length);
    assert.equal(atLimit.length, 155);
    assert.equal(validateBundleId(atLimit), undefined);
  });

  it("falls through to the structural error when the trailing segment is empty", () => {
    // The structural regex catches the trailing dot before the placeholder
    // check can fire, so this still reports the reverse-DNS shape.
    assert.match(validateBundleId("com.example."), /reverse-DNS/);
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

  it("toBundleId produces the com.example.* placeholder the user must replace", () => {
    // The default is intentionally a placeholder so the prompt's validator
    // forces the user to think about their real reverse-DNS prefix before
    // submitting. validateBundleId rejects com.example.* with the explicit
    // "placeholder Apple rejects on upload" message.
    assert.equal(toBundleId("my-app"), "com.example.my-app");
    assert.match(validateBundleId(toBundleId("any-name")), /placeholder/);
  });

  it("toSwiftPrefix camelcases project name", () => {
    assert.equal(toSwiftPrefix("my-app"), "MyApp");
    assert.equal(toSwiftPrefix("lockscreen demo"), "LockscreenDemo");
    assert.equal(toSwiftPrefix("foo_bar.baz"), "FooBarBaz");
  });

  it("toSwiftPrefix strips leading digits so the result is a valid Swift identifier", () => {
    // Leading digits are legal in npm slugs but illegal in Swift type names.
    // The function strips them so the iOS bundle still gets a valid prefix.
    assert.equal(toSwiftPrefix("123-app"), "App");
    assert.equal(toSwiftPrefix("1password"), "Password");
    assert.equal(toSwiftPrefix("5-and-dime"), "AndDime");
    assert.equal(toSwiftPrefix("1password-pro"), "PasswordPro");
    // The output must always pass validateSwiftIdentifier.
    assert.equal(
      validateSwiftIdentifier(toSwiftPrefix("1password")),
      undefined,
    );
    assert.equal(
      validateSwiftIdentifier(toSwiftPrefix("123-my-app")),
      undefined,
    );
  });

  it("toSwiftPrefix throws when the project name has no letters at all", () => {
    // If the user picks an all-digits slug, we cannot derive any valid Swift
    // identifier. Surface a clear error rather than emitting an empty string
    // that would silently produce broken Xcode targets.
    assert.throws(
      () => toSwiftPrefix("123"),
      /must contain at least one letter/,
    );
    assert.throws(() => toSwiftPrefix("4-5-6"), /must contain at least one letter/);
  });
});
