// Toolchain detection. Runs before any prompt so we never make the user type
// a project name only to find out Xcode is missing. Version requirements
// (Node, iOS deployment target, minimum Xcode major) come from the template
// manifest — single source of truth, never out of sync with what the
// generated project will actually need.

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

async function checkXcode({ minimumMajor }) {
  try {
    const { stdout } = await exec("xcodebuild", ["-version"], { timeout: 5000 });
    const firstLine = stdout.split("\n")[0].trim();
    const match = firstLine.match(/Xcode\s+(\d+)(?:\.(\d+))?/);
    if (match) {
      const major = Number(match[1]);
      if (minimumMajor && major < minimumMajor) {
        return {
          ok: false,
          kind: "fail",
          title: `Xcode ${minimumMajor} or newer required (you have ${firstLine}).`,
          fix: "Update via the Mac App Store, then run this again.",
        };
      }
      return { ok: true, detail: firstLine };
    }
    // Couldn't parse the version line — accept presence as good enough.
    return { ok: true, detail: firstLine };
  } catch {
    return {
      ok: false,
      kind: "fail",
      title: minimumMajor
        ? `Xcode ${minimumMajor} or newer required.`
        : "Xcode required.",
      fix: "Install from the Mac App Store, then run this again.",
    };
  }
}

async function checkSimulatorRuntime({ minimumIos }) {
  try {
    const { stdout } = await exec("xcrun", ["simctl", "list", "runtimes", "--json"], {
      timeout: 5000,
    });
    const runtimes = JSON.parse(stdout).runtimes ?? [];
    const [minMajorStr, minMinorStr = "0"] = (minimumIos ?? "0.0").split(".");
    const minVal = Number(minMajorStr) + Number(minMinorStr) / 100;
    const ok = runtimes.some((r) => {
      if (!r.isAvailable) return false;
      const platform = r.platform ?? r.identifier ?? "";
      if (!platform.includes("iOS")) return false;
      const [major, minor = "0"] = (r.version ?? "0.0").split(".");
      const v = Number(major) + Number(minor) / 100;
      return v >= minVal;
    });
    if (ok) return { ok: true, detail: `iOS ${minimumIos}+ simulator` };
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
function parseProjectNodeMajor(spec) {
  if (!spec) return null;
  const m = spec.match(/>=\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

export async function runPreflight({ manifest }) {
  const projectMajor = parseProjectNodeMajor(manifest?.cliRequiredNode);
  const minimumIos = manifest?.deploymentTarget ?? "17.2";
  const minimumXcode = manifest?.minimumXcodeMajor ?? null;

  const results = await Promise.all([
    checkPlatform(),
    checkNode({ projectMajor }),
    checkXcode({ minimumMajor: minimumXcode }),
    checkSimulatorRuntime({ minimumIos }),
    checkPnpm(),
    checkCocoapods(),
  ]);

  const failures = results.filter((r) => !r.ok);
  const warnings = results.filter((r) => r.ok && r.kind === "warn");
  const passed = results.filter((r) => r.ok && !r.kind);

  return { failures, warnings, passed };
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
