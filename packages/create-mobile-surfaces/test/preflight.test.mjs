// Preflight unit coverage. The check functions themselves shell out to real
// system tools (xcodebuild, xcrun, pnpm, pod). What's unit-testable — and worth
// pinning — is the willInstall scope split (downgradeBuildFailureToWarning)
// plus the pure parsers that turn each tool's output string into structured
// results: parseXcodeVersion, parseSimulatorRuntimes, parseIosVersion,
// parseProjectNodeMajor. The parsers exist so a future Xcode release that
// reshapes its version line, or a simctl JSON tweak, is caught here rather
// than at install time on a user's machine.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  downgradeBuildFailureToWarning,
  parseIosVersion,
  parseProjectNodeMajor,
  parseSimulatorRuntimes,
  parseXcodeVersion,
} from "../src/preflight.mjs";

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

describe("parseXcodeVersion", () => {
  it("parses the current Xcode 26.x first-line shape", () => {
    const out = "Xcode 26.0\nBuild version 26A100\n";
    const parsed = parseXcodeVersion(out);
    assert.deepEqual(parsed, {
      firstLine: "Xcode 26.0",
      version: { major: 26, minor: 0 },
    });
  });

  it("parses an older Xcode with a non-zero minor", () => {
    const out = "Xcode 25.3\nBuild version 25C100\n";
    const parsed = parseXcodeVersion(out);
    assert.deepEqual(parsed.version, { major: 25, minor: 3 });
  });

  it("defaults minor to 0 when the first line omits it", () => {
    const out = "Xcode 26\nBuild version 26A100\n";
    const parsed = parseXcodeVersion(out);
    assert.deepEqual(parsed.version, { major: 26, minor: 0 });
  });

  it("preserves first-line text but returns version=null on garbage", () => {
    const parsed = parseXcodeVersion("Garbage line\nignored");
    assert.equal(parsed.firstLine, "Garbage line");
    assert.equal(parsed.version, null);
  });

  it("returns null for empty input", () => {
    assert.equal(parseXcodeVersion(""), null);
    assert.equal(parseXcodeVersion("\n\n"), null);
  });

  it("returns null for null/undefined input", () => {
    assert.equal(parseXcodeVersion(null), null);
    assert.equal(parseXcodeVersion(undefined), null);
  });
});

describe("parseIosVersion", () => {
  it("encodes major.minor as major + minor/100 so 17.2 < 17.10", () => {
    assert.equal(parseIosVersion("17.2"), 17.02);
    assert.equal(parseIosVersion("17.10"), 17.1);
    assert.ok(parseIosVersion("17.10") > parseIosVersion("17.2"));
  });

  it("treats a missing minor segment as 0", () => {
    assert.equal(parseIosVersion("18"), 18);
  });

  it("returns null on null/undefined/garbage", () => {
    assert.equal(parseIosVersion(null), null);
    assert.equal(parseIosVersion(undefined), null);
    assert.equal(parseIosVersion("not-a-version"), null);
  });
});

describe("parseSimulatorRuntimes", () => {
  // Realistic shape from `xcrun simctl list runtimes --json` on Xcode 26.
  const sample = {
    runtimes: [
      {
        identifier: "com.apple.CoreSimulator.SimRuntime.iOS-17-2",
        version: "17.2",
        isAvailable: true,
        platform: "iOS",
      },
      {
        identifier: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
        version: "18.0",
        isAvailable: true,
        platform: "iOS",
      },
      {
        identifier: "com.apple.CoreSimulator.SimRuntime.watchOS-10-0",
        version: "10.0",
        isAvailable: true,
        platform: "watchOS",
      },
      {
        identifier: "com.apple.CoreSimulator.SimRuntime.iOS-16-0",
        version: "16.0",
        isAvailable: false, // installed but unavailable (e.g. needs download)
        platform: "iOS",
      },
    ],
  };

  it("accepts an iOS runtime that meets the minimum", () => {
    const r = parseSimulatorRuntimes(sample, "17.2");
    assert.equal(r.ok, true);
    assert.equal(r.runtimes.length, 3); // three iOS runtimes (watchOS filtered)
  });

  it("rejects when only older iOS runtimes are installed", () => {
    const r = parseSimulatorRuntimes(sample, "18.5");
    assert.equal(r.ok, false);
  });

  it("ignores non-iOS platforms even if their version would satisfy", () => {
    const watchOnly = {
      runtimes: [{ platform: "watchOS", version: "20.0", isAvailable: true }],
    };
    assert.equal(parseSimulatorRuntimes(watchOnly, "17.2").ok, false);
  });

  it("ignores iOS runtimes that aren't marked available", () => {
    const unavailable = {
      runtimes: [
        { platform: "iOS", version: "18.0", isAvailable: false },
      ],
    };
    assert.equal(parseSimulatorRuntimes(unavailable, "17.2").ok, false);
  });

  it("accepts the raw JSON string directly (mirrors the exec call site)", () => {
    const r = parseSimulatorRuntimes(JSON.stringify(sample), "17.2");
    assert.equal(r.ok, true);
  });

  it("returns reason=unparseable on non-JSON input rather than throwing", () => {
    const r = parseSimulatorRuntimes("not json", "17.2");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unparseable");
  });

  it("treats an absent runtimes array as empty (not as an error)", () => {
    const r = parseSimulatorRuntimes({}, "17.2");
    assert.equal(r.ok, false);
    assert.deepEqual(r.runtimes, []);
  });

  it("falls back to identifier when platform is missing", () => {
    const identifierOnly = {
      runtimes: [
        {
          identifier: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
          version: "18.0",
          isAvailable: true,
        },
      ],
    };
    assert.equal(parseSimulatorRuntimes(identifierOnly, "17.2").ok, true);
  });
});

describe("parseProjectNodeMajor", () => {
  it("extracts the floor from a >= constraint", () => {
    assert.equal(parseProjectNodeMajor(">=24.0.0 <25"), 24);
    assert.equal(parseProjectNodeMajor(">= 22"), 22);
  });

  it("returns null when the spec has no >= floor", () => {
    assert.equal(parseProjectNodeMajor("^24.0.0"), null);
    assert.equal(parseProjectNodeMajor("~22"), null);
  });

  it("returns null for empty/null input", () => {
    assert.equal(parseProjectNodeMajor(""), null);
    assert.equal(parseProjectNodeMajor(null), null);
    assert.equal(parseProjectNodeMajor(undefined), null);
  });
});
