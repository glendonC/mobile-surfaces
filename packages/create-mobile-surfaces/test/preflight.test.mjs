// Preflight unit coverage. The check functions themselves shell out to real
// system tools (xcodebuild, xcrun, pnpm, pod), which are not unit-testable
// without elaborate mocks; what is unit-testable — and worth pinning — is
// the willInstall scope split: a build-toolchain failure must become a
// warning when the caller has opted out of the post-scaffold install.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { downgradeBuildFailureToWarning } from "../src/preflight.mjs";

describe("downgradeBuildFailureToWarning", () => {
  it("turns a fail into a warn while preserving title/fix/detail", () => {
    const failed = {
      ok: false,
      kind: "fail",
      title: "Xcode 26 or newer required (you have Xcode 16.4).",
      fix: "Update via the Mac App Store before building iOS.",
      detail: undefined,
    };
    const downgraded = downgradeBuildFailureToWarning(failed);
    assert.equal(downgraded.ok, true);
    assert.equal(downgraded.kind, "warn");
    assert.equal(downgraded.title, failed.title);
    assert.equal(downgraded.fix, failed.fix);
  });

  it("passes through results that are already ok (no kind churn)", () => {
    const passed = { ok: true, detail: "Xcode 26.0" };
    assert.deepEqual(downgradeBuildFailureToWarning(passed), passed);
  });

  it("passes through existing warnings unchanged", () => {
    const existingWarn = {
      ok: true,
      kind: "warn",
      title: "CocoaPods not found on PATH.",
      fix: "Install before iOS prebuild.",
      detail: "CocoaPods missing",
    };
    assert.deepEqual(
      downgradeBuildFailureToWarning(existingWarn),
      existingWarn,
    );
  });
});
