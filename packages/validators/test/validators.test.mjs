// Co-located tests for @mobile-surfaces/validators.
//
// This package is load-bearing for scaffold correctness: the CLI and the
// in-template rename script both depend on it. It was previously exercised
// only indirectly through a consumer's test file, which left two audit
// readers concluding the package had no tests at all. These tests own the
// package boundary and pin both function categories: the validate* functions
// (return undefined or an error string, never throw) and the to* derivers
// (return a derived identifier; toSwiftPrefix throws on un-deriveable input).
//
// Run with: node --test test/validators.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateProjectSlug,
  validateScheme,
  validateBundleId,
  validateTeamId,
  validateSwiftIdentifier,
  toDisplayName,
  toScheme,
  validateDisplayName,
  toBundleId,
  toSwiftPrefix,
} from "../src/index.mjs";

test("validateProjectSlug accepts kebab-case and leading-digit slugs", () => {
  assert.equal(validateProjectSlug("my-app"), undefined);
  assert.equal(validateProjectSlug("a"), undefined);
  assert.equal(validateProjectSlug("1password"), undefined);
});

test("validateProjectSlug rejects empties, casing, and stray characters", () => {
  assert.match(validateProjectSlug(""), /required/);
  assert.match(validateProjectSlug("My-App"), /Lowercase/);
  assert.match(validateProjectSlug("-leading"), /letter or digit/);
  assert.match(validateProjectSlug("has space"), /Lowercase/);
  assert.match(validateProjectSlug("has_underscore"), /Lowercase/);
});

test("validateProjectSlug rejects a slug past the 214-char npm limit", () => {
  assert.equal(validateProjectSlug("a".repeat(214)), undefined);
  assert.match(validateProjectSlug("a".repeat(215)), /214 characters or fewer/);
});

test("validateScheme accepts lowercase alphanumeric, rejects the rest", () => {
  assert.equal(validateScheme("myapp"), undefined);
  assert.equal(validateScheme("app2"), undefined);
  assert.match(validateScheme(""), /required/);
  assert.match(validateScheme("2app"), /start with a letter/);
  assert.match(validateScheme("My-App"), /Lowercase/);
});

test("validateBundleId accepts a real reverse-DNS id", () => {
  assert.equal(validateBundleId("com.acme.myapp"), undefined);
  assert.equal(validateBundleId("io.company.app-name"), undefined);
});

test("validateBundleId rejects empties, non-reverse-DNS, and the length cap", () => {
  assert.match(validateBundleId(""), /required/);
  assert.match(validateBundleId("singlesegment"), /reverse-DNS/);
  assert.match(
    validateBundleId("com." + "a".repeat(155)),
    /155 characters or fewer/,
  );
});

test("validateBundleId rejects the com.example placeholder prefix", () => {
  assert.match(validateBundleId("com.example.myapp"), /placeholder/);
  assert.match(validateBundleId("COM.EXAMPLE.myapp"), /placeholder/);
});

test("validateBundleId rejects reserved vendor prefixes", () => {
  for (const id of [
    "com.apple.myapp",
    "com.google.myapp",
    "com.microsoft.myapp",
    "org.reactjs.myapp",
  ]) {
    assert.match(validateBundleId(id), /reserved vendor prefix/, id);
  }
});

test("validateTeamId treats empty as valid (filled in later) and checks shape", () => {
  assert.equal(validateTeamId(""), undefined);
  assert.equal(validateTeamId("ABCDE12345"), undefined);
  assert.match(validateTeamId("abcde12345"), /10 uppercase/);
  assert.match(validateTeamId("ABCDE123"), /10 uppercase/);
});

test("validateSwiftIdentifier requires UpperCamelCase", () => {
  assert.equal(validateSwiftIdentifier("MobileSurfaces"), undefined);
  assert.equal(validateSwiftIdentifier("App2"), undefined);
  assert.match(validateSwiftIdentifier(""), /required/);
  assert.match(validateSwiftIdentifier("mobileSurfaces"), /UpperCamelCase/);
  assert.match(validateSwiftIdentifier("2App"), /UpperCamelCase/);
});

test("toScheme strips non-alphanumerics and lowercases", () => {
  assert.equal(toScheme("My App"), "myapp");
  assert.equal(toScheme("lock-screen-demo"), "lockscreendemo");
});

test("validateDisplayName accepts free-form text and rejects empty / >100 chars", () => {
  assert.equal(validateDisplayName("Pinecrest Diner"), undefined);
  assert.equal(validateDisplayName("App"), undefined);
  assert.equal(validateDisplayName("My App 2026"), undefined);
  // Unicode is fine; only length and emptiness are constrained.
  assert.equal(validateDisplayName("カフェ"), undefined);
  assert.match(validateDisplayName(""), /Required/);
  assert.match(validateDisplayName("   "), /Required/);
  assert.match(validateDisplayName("x".repeat(101)), /100 characters/);
});

test("toDisplayName titlecases each kebab segment with single-space joins", () => {
  // A4: the scaffolder's iOS Settings display name (app.json's expo.name)
  // previously took the kebab slug verbatim. toDisplayName is the derive
  // that fills the new --display-name flag's default.
  assert.equal(toDisplayName("pinecrest-diner"), "Pinecrest Diner");
  assert.equal(toDisplayName("mobile-surfaces"), "Mobile Surfaces");
  assert.equal(toDisplayName("my-app-2026"), "My App 2026");
  assert.equal(toDisplayName("lock screen demo"), "Lock Screen Demo");
  // Empty / no-alphanumeric input returns an empty string; callers should
  // fall back to a hardcoded default or prompt the user.
  assert.equal(toDisplayName(""), "");
  assert.equal(toDisplayName("---"), "");
});

test("toBundleId derives a com.example placeholder id", () => {
  assert.equal(toBundleId("My App"), "com.example.myapp");
  assert.equal(toBundleId("lock-screen"), "com.example.lock-screen");
});

test("toSwiftPrefix derives UpperCamelCase and strips leading digits", () => {
  assert.equal(toSwiftPrefix("my-app"), "MyApp");
  assert.equal(toSwiftPrefix("lock screen demo"), "LockScreenDemo");
  // Leading digits are stripped; the new first character is uppercased.
  assert.equal(toSwiftPrefix("1password"), "Password");
  assert.equal(toSwiftPrefix("123-app"), "App");
  assert.equal(toSwiftPrefix("5-and-dime"), "AndDime");
});

test("toSwiftPrefix throws when no Swift identifier can be derived", () => {
  // A name with no letters survives validateProjectSlug (leading digits are
  // legal npm names) but cannot yield a Swift type prefix. The deriver throws
  // rather than returning a string a caller might mistake for a valid prefix.
  assert.throws(() => toSwiftPrefix("123"), /at least one letter/);
  assert.throws(() => toSwiftPrefix("4-5-6"), /at least one letter/);
});
