// Toolchain detection. Runs before any prompt so we never make the user type
// a project name only to find out Xcode is missing. Version requirements
// (Node, iOS deployment target, minimum Xcode major) come from the template
// manifest — single source of truth, never out of sync with what the
// generated project will actually need.
//
// Scaffold-time vs repo-time: the manifest is the SCAFFOLD-time source (what
// the generated project will need to build). It is itself built from the
// repo's root package.json `mobileSurfaces` block via template-manifest.mjs,
// so the numbers ultimately live in one file — but the two lifecycles stay
// separate. scripts/doctor.mjs reads the same root package.json directly to
// enforce REPO-time minimums (what's needed to build this monorepo).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pc from "picocolors";
import { errors } from "./copy.mjs";

const exec = promisify(execFile);

// The CLI itself can run on any modern LTS; the project requires Node major
// derived from manifest.cliRequiredNode. Below this absolute floor the CLI
// itself won't function (no top-level await, etc.).
const MIN_CLI_NODE_MAJOR = 20;

// Each check returns { ok, kind: "fail" | "warn", title?, fix?, detail? }.
async function checkPlatform() {
  if (process.platform === "darwin") {
    return { ok: true, detail: "macOS" };
  }
  return {
    ok: false,
    kind: "fail",
    title: "macOS required.",
    fix: "Mobile Surfaces builds an iOS app, which only works on macOS with Xcode.",
  };
}

async function checkNode({ projectMajor }) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < MIN_CLI_NODE_MAJOR) {
    return {
      ok: false,
      kind: "fail",
      title: `Node ${MIN_CLI_NODE_MAJOR} or newer required (you have ${process.versions.node}).`,
      fix: `Install via nvm: nvm install ${projectMajor ?? MIN_CLI_NODE_MAJOR}`,
    };
  }
  if (projectMajor && major < projectMajor) {
    return {
      ok: true,
      kind: "warn",
      title: `Node ${projectMajor} recommended (you have ${process.versions.node}).`,
      fix: `The CLI will run, but the generated project requires Node ${projectMajor}. Upgrade with: nvm install ${projectMajor}`,
      detail: `Node ${process.versions.node}`,
    };
  }
  return { ok: true, detail: `Node ${process.versions.node}` };
}

// Parse `xcodebuild -version` output. Returns the first non-empty line, the
// parsed major/minor, or null when the version line couldn't be recognized.
// Exported pure helper so the parse logic is unit-testable without spawning
// xcodebuild on a host that may or may not have it installed.
//
// Real-world shape (Xcode 26.0):
//   Xcode 26.0
//   Build version 26A100
// Older Xcode majors share the same first-line shape ("Xcode <N>.<M>").
// A malformed input returns { firstLine, version: null } — the caller treats
// that as "tool present, can't pin version" and accepts presence as good
// enough.
export function parseXcodeVersion(output) {
  if (output == null) return null;
  const firstLine = String(output).split("\n")[0]?.trim() ?? "";
  if (firstLine.length === 0) return null;
  const match = firstLine.match(/Xcode\s+(\d+)(?:\.(\d+))?/);
  if (!match) return { firstLine, version: null };
  return {
    firstLine,
    version: { major: Number(match[1]), minor: Number(match[2] ?? 0) },
  };
}

async function checkXcode({ minimumMajor }) {
  try {
    const { stdout } = await exec("xcodebuild", ["-version"], { timeout: 5000 });
    const parsed = parseXcodeVersion(stdout);
    if (!parsed) {
      // exec resolved (so xcodebuild exists) but stdout was empty — treat as
      // "present, version unknown" rather than failing the user out.
      return { ok: true, detail: "Xcode (version unknown)" };
    }
    if (parsed.version && minimumMajor && parsed.version.major < minimumMajor) {
      return {
        ok: false,
        kind: "fail",
        title: `Xcode ${minimumMajor} or newer required (you have ${parsed.firstLine}).`,
        fix: "Update via the Mac App Store before building iOS.",
      };
    }
    return { ok: true, detail: parsed.firstLine };
  } catch {
    return {
      ok: false,
      kind: "fail",
      title: minimumMajor
        ? `Xcode ${minimumMajor} or newer required.`
        : "Xcode required.",
      fix: "Install from the Mac App Store before building iOS.",
    };
  }
}

// Parse a minimum-iOS spec string like "17.2" into a comparable number. Used
// for both the minimum and each runtime's version field so the comparison is
// monotonic and tolerant of missing minor segments. Returns null on garbage
// input so the caller can decide whether to short-circuit.
export function parseIosVersion(version) {
  if (version == null) return null;
  const [majorStr, minorStr = "0"] = String(version).split(".");
  const major = Number(majorStr);
  const minor = Number(minorStr);
  if (!Number.isFinite(major)) return null;
  return major + (Number.isFinite(minor) ? minor : 0) / 100;
}

// Parse the `xcrun simctl list runtimes --json` payload and decide whether any
// installed iOS runtime meets the minimum. Pure: takes the parsed JSON object
// (or raw string) plus a minimum-iOS string. Returns an object with the
// boolean decision plus the runtimes considered, so the caller can produce a
// detail message that names which version was found. Exported for tests.
export function parseSimulatorRuntimes(payload, minimumIos) {
  const minVal = parseIosVersion(minimumIos) ?? 0;
  let parsed = payload;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return { ok: false, runtimes: [], reason: "unparseable" };
    }
  }
  const runtimes = Array.isArray(parsed?.runtimes) ? parsed.runtimes : [];
  const iosRuntimes = runtimes.filter((r) => {
    const platform = r?.platform ?? r?.identifier ?? "";
    return typeof platform === "string" && platform.includes("iOS");
  });
  const ok = iosRuntimes.some((r) => {
    if (!r.isAvailable) return false;
    const v = parseIosVersion(r.version);
    return v != null && v >= minVal;
  });
  return { ok, runtimes: iosRuntimes };
}

async function checkSimulatorRuntime({ minimumIos }) {
  try {
    const { stdout } = await exec("xcrun", ["simctl", "list", "runtimes", "--json"], {
      timeout: 5000,
    });
    const result = parseSimulatorRuntimes(stdout, minimumIos);
    if (result.reason === "unparseable") {
      return {
        ok: false,
        kind: "fail",
        title: "Couldn't parse simulator runtime list (xcrun simctl --json returned non-JSON).",
        fix: "Make sure Xcode command line tools are installed: xcode-select --install",
      };
    }
    if (result.ok) return { ok: true, detail: `iOS ${minimumIos}+ simulator` };
    return {
      ok: false,
      kind: "fail",
      title: `No iOS ${minimumIos} or newer simulator runtime installed.`,
      fix: `In Xcode: Settings → Platforms → iOS → install iOS ${minimumIos} or newer.`,
    };
  } catch {
    return {
      ok: false,
      kind: "fail",
      title: "Couldn't list simulator runtimes (xcrun simctl failed).",
      fix: "Make sure Xcode command line tools are installed: xcode-select --install",
    };
  }
}

async function checkPnpm() {
  try {
    const { stdout } = await exec("pnpm", ["-v"], { timeout: 5000 });
    return { ok: true, detail: `pnpm ${stdout.trim()}` };
  } catch {
    return {
      ok: true,
      kind: "warn",
      title: "pnpm not found on PATH.",
      fix: "Enable it with corepack (ships with Node): corepack enable pnpm",
      detail: "pnpm missing",
    };
  }
}

// CocoaPods is invoked transitively by `expo prebuild`. Without it the
// prebuild fails 60–90s in with a generic error that doesn't say "install
// pods". Surfacing it here turns that into a 200ms warning the user can
// act on before the spinner even starts. Warn-only because the user might
// pick installNow=false and never need it; runTasks re-checks and hard-fails
// before invoking prebuild when installNow is true.
async function checkCocoapods() {
  try {
    const { stdout } = await exec("pod", ["--version"], { timeout: 5000 });
    return { ok: true, detail: `CocoaPods ${stdout.trim()}` };
  } catch {
    return {
      ok: true,
      kind: "warn",
      title: "CocoaPods not found on PATH.",
      fix: "Install before iOS prebuild: brew install cocoapods (or sudo gem install cocoapods)",
      detail: "CocoaPods missing",
    };
  }
}

// The required Node major comes from a string like ">=24.0.0 <25". Pull the
// first major-version-floor we can recognize; anything else means we don't
// pin the project major and only enforce the absolute CLI floor.
// Exported for tests so a future template-manifest tweak that ships a
// different spec syntax (e.g. caret) is caught at unit-test time.
export function parseProjectNodeMajor(spec) {
  if (!spec) return null;
  const m = String(spec).match(/>=\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

// Scaffold-required checks gate the act of writing files: without macOS,
// a supported Node, and a package manager, the scaffold itself can't run.
// Build-required checks gate the post-scaffold iOS build (install + prebuild
// + xcodebuild). When the caller passed --no-install, the user has opted out
// of that step, so a missing Xcode / simulator / CocoaPods is a deferred
// problem (they'll hit it at `pnpm ios` time) rather than a blocking one.
//
// runPreflight reflects this: build-check failures get downgraded to warnings
// in --no-install mode, so the scaffold still completes and the user sees the
// same diagnostic copy as an advisory.
export async function runPreflight({ manifest, willInstall = true }) {
  const projectMajor = parseProjectNodeMajor(manifest?.cliRequiredNode);
  const minimumIos = manifest?.deploymentTarget ?? "17.2";
  const minimumXcode = manifest?.minimumXcodeMajor ?? null;

  // allSettled rather than all so a check function that forgets its try/catch
  // (or hits an unforeseen throw — e.g. a future spawn that bubbles ENOENT)
  // doesn't abort every other check. Each check today already wraps its own
  // exec; this is defense-in-depth so the next addition can't accidentally
  // kill the whole preflight.
  const scaffoldSettled = await Promise.allSettled([
    checkPlatform(),
    checkNode({ projectMajor }),
    checkPnpm(),
  ]);
  const buildSettled = await Promise.allSettled([
    checkXcode({ minimumMajor: minimumXcode }),
    checkSimulatorRuntime({ minimumIos }),
    checkCocoapods(),
  ]);

  const scaffoldResults = scaffoldSettled.map((s, i) =>
    settledToResult(s, `scaffold check #${i + 1}`),
  );
  const buildResults = buildSettled
    .map((s, i) => settledToResult(s, `build check #${i + 1}`))
    .map((r) => (willInstall ? r : downgradeBuildFailureToWarning(r)));

  const results = [...scaffoldResults, ...buildResults];
  const failures = results.filter((r) => !r.ok);
  const warnings = results.filter((r) => r.ok && r.kind === "warn");
  const passed = results.filter((r) => r.ok && !r.kind);

  return { failures, warnings, passed };
}

function settledToResult(settled, label) {
  if (settled.status === "fulfilled") return settled.value;
  return {
    ok: false,
    title: `${label} threw unexpectedly`,
    fix: `Report this with the log: ${settled.reason?.message ?? String(settled.reason)}`,
  };
}

// Exported for tests. Pure: takes a check result, returns the warn-mode
// equivalent if it was a fail, otherwise passes through.
export function downgradeBuildFailureToWarning(result) {
  if (result.ok) return result;
  return {
    ok: true,
    kind: "warn",
    title: result.title,
    fix: result.fix,
    detail: result.detail,
  };
}

// Rendered through the shared rail so the toolchain status threads into the
// same vertical column as the banner, prompts, and recap. Each row is its own
// rail.line so the prefix starts at column 0 even if a long detail wraps.
import { rail } from "./ui.mjs";

export function renderFailures(failures) {
  rail.blank();
  rail.line(pc.red("✗") + "  " + errors.toolchainHeader(failures.length));
  rail.blank();
  for (const f of failures) {
    rail.line(pc.red("✗") + "  " + f.title);
    rail.line("   " + pc.dim(f.fix));
    rail.blank();
  }
}

export function renderPassed(passed) {
  const summary = passed.map((p) => p.detail).filter(Boolean).join(" · ");
  rail.line(pc.green("✓") + "  Toolchain ready  " + pc.dim(summary));
}

export function renderWarnings(warnings) {
  for (const w of warnings) {
    rail.line(pc.yellow("⚠") + "  " + w.title);
    rail.line("   " + pc.dim(w.fix));
  }
}
