import test from "node:test";
import assert from "node:assert/strict";
import {
  flagsToOverrides,
  parseCliFlags,
  resolveYesConfig,
  validateOverrides,
} from "../src/flags.mjs";

test("parseCliFlags: bare invocation yields no overrides and yes=false", () => {
  const r = parseCliFlags([]);
  assert.deepEqual(r.overrides, {});
  assert.equal(r.yes, false);
  assert.equal(r.help, false);
  assert.equal(r.initialName, undefined);
});

test("parseCliFlags: positional becomes initialName, slugified", () => {
  const r = parseCliFlags(["My App"]);
  assert.equal(r.initialName, "my-app");
});

test("parseCliFlags: --name and --bundle-id thread through to overrides", () => {
  const r = parseCliFlags(["--name", "my-app", "--bundle-id", "com.acme.myapp"]);
  assert.deepEqual(r.overrides, { projectName: "my-app", bundleId: "com.acme.myapp" });
});

test("parseCliFlags: --yes sets yes=true", () => {
  const r = parseCliFlags(["--yes", "--name", "my-app"]);
  assert.equal(r.yes, true);
  assert.equal(r.overrides.projectName, "my-app");
});

test("parseCliFlags: short -y is recognised as --yes", () => {
  const r = parseCliFlags(["-y", "--name", "x"]);
  assert.equal(r.yes, true);
});

test("parseCliFlags: --help / -h short form", () => {
  assert.equal(parseCliFlags(["--help"]).help, true);
  assert.equal(parseCliFlags(["-h"]).help, true);
});

test("parseCliFlags: unknown flag throws (strict parsing)", () => {
  assert.throws(() => parseCliFlags(["--bogus"]));
});

test("flagsToOverrides: --no-home-widget wins over --home-widget when both set", () => {
  const overrides = flagsToOverrides({
    "home-widget": true,
    "no-home-widget": true,
  });
  assert.equal(overrides.homeWidget, false);
});

test("flagsToOverrides: --install becomes installNow=true; --no-install wins if both", () => {
  assert.equal(flagsToOverrides({ install: true }).installNow, true);
  assert.equal(flagsToOverrides({ "no-install": true }).installNow, false);
  assert.equal(
    flagsToOverrides({ install: true, "no-install": true }).installNow,
    false,
  );
});

test("flagsToOverrides: unspecified booleans are absent (let the prompt default win)", () => {
  const overrides = flagsToOverrides({});
  assert.ok(!("homeWidget" in overrides));
  assert.ok(!("controlWidget" in overrides));
  assert.ok(!("installNow" in overrides));
});

test("validateOverrides: catches com.example.* placeholders", () => {
  const errors = validateOverrides({ bundleId: "com.example.foo" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^--bundle-id:/);
  assert.match(errors[0], /com\.example/);
});

test("validateOverrides: catches malformed scheme", () => {
  const errors = validateOverrides({ scheme: "Bad-Scheme" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^--scheme:/);
});

test("validateOverrides: catches non-slug project names", () => {
  const errors = validateOverrides({ projectName: "My App!" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^--name:/);
});

test("validateOverrides: empty teamId is treated as 'skip', not an error", () => {
  const errors = validateOverrides({ teamId: "" });
  assert.equal(errors.length, 0);
});

test("validateOverrides: bad teamId is rejected", () => {
  const errors = validateOverrides({ teamId: "abc" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^--team-id:/);
});

test("validateOverrides: clean overrides return no errors", () => {
  const errors = validateOverrides({
    projectName: "my-app",
    scheme: "myapp",
    bundleId: "com.acme.myapp",
    teamId: "ABCDE12345",
  });
  assert.deepEqual(errors, []);
});

test("resolveYesConfig: errors when --name is missing", () => {
  const { config, errors } = resolveYesConfig({});
  assert.equal(config, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /--name/);
});

test("resolveYesConfig: rejects derived bundle-id when it would land on com.example.*", () => {
  // Default toBundleId yields com.example.<slug>, which validateBundleId
  // rejects as a placeholder Apple won't accept on upload. The CLI surfaces
  // this so the user can pass --bundle-id explicitly rather than discover
  // the failure at App Store submission time.
  const { config, errors } = resolveYesConfig({ projectName: "my-app" });
  assert.equal(config, null);
  assert.ok(errors.some((e) => e.includes("derived --bundle-id")));
  assert.ok(errors.some((e) => e.includes("Pass --scheme and --bundle-id explicitly")));
});

test("resolveYesConfig: accepts when --bundle-id is supplied explicitly", () => {
  const { config, errors } = resolveYesConfig({
    projectName: "my-app",
    bundleId: "com.acme.myapp",
  });
  assert.deepEqual(errors, []);
  assert.equal(config.bundleId, "com.acme.myapp");
  assert.equal(config.scheme, "myapp"); // toScheme of "my-app"
});

test("resolveYesConfig: surface defaults are both true; --no-control-widget honoured", () => {
  const { config } = resolveYesConfig({
    projectName: "my-app",
    bundleId: "com.acme.myapp",
    controlWidget: false,
  });
  assert.equal(config.surfaces.homeWidget, true);
  assert.equal(config.surfaces.controlWidget, false);
});

test("resolveYesConfig: installNow defaults to true; --no-install honoured", () => {
  const a = resolveYesConfig({
    projectName: "my-app",
    bundleId: "com.acme.myapp",
  });
  assert.equal(a.config.installNow, true);

  const b = resolveYesConfig({
    projectName: "my-app",
    bundleId: "com.acme.myapp",
    installNow: false,
  });
  assert.equal(b.config.installNow, false);
});

test("resolveYesConfig: empty teamId becomes null; valid teamId is preserved", () => {
  const a = resolveYesConfig({
    projectName: "my-app",
    bundleId: "com.acme.myapp",
    teamId: "",
  });
  assert.equal(a.config.teamId, null);

  const b = resolveYesConfig({
    projectName: "my-app",
    bundleId: "com.acme.myapp",
    teamId: "ABCDE12345",
  });
  assert.equal(b.config.teamId, "ABCDE12345");
});
