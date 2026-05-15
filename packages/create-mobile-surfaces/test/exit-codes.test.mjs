import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import { EXIT_CODES } from "../src/exit-codes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(__dirname, "..", "bin", "index.mjs");

describe("EXIT_CODES constants are stable (CI contract)", () => {
  // CI scripts treat these numbers as a public surface. If a value changes,
  // the breaking change must go through release notes — this test is a
  // maintainer's circuit-breaker against silent edits.
  it("declares the canonical 0/1/2/3/130 mapping", () => {
    assert.equal(EXIT_CODES.SUCCESS, 0);
    assert.equal(EXIT_CODES.USER_ERROR, 1);
    assert.equal(EXIT_CODES.ENV_ERROR, 2);
    assert.equal(EXIT_CODES.TEMPLATE_ERROR, 3);
    assert.equal(EXIT_CODES.INTERRUPTED, 130);
  });

  it("freezes the constants object so a typo can't reassign in place", () => {
    assert.ok(Object.isFrozen(EXIT_CODES));
  });
});

// Each subprocess test below invokes the real bin/index.mjs and checks the
// exit code only. We deliberately don't snapshot stdout — the goal is the
// numeric contract CI consumers branch on, not the specific copy.
//
// FORCE_COLOR=0 keeps the output ANSI-free in case anyone greps it later.
function runCli(args, { cwd } = {}) {
  return spawnSync("node", [cliBin, ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

describe("CLI exit codes (subprocess)", () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-exit-"));
  });

  afterEach(() => {
    if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("--help → 0 (SUCCESS)", () => {
    const result = runCli(["--help"]);
    assert.equal(result.status, EXIT_CODES.SUCCESS);
  });

  it("unknown flag → 1 (USER_ERROR)", () => {
    const result = runCli(["--definitely-not-a-flag"]);
    assert.equal(result.status, EXIT_CODES.USER_ERROR);
  });

  it("invalid --bundle-id → 1 (USER_ERROR)", () => {
    const result = runCli(["--yes", "--name=foo", "--bundle-id=not-a-bundle-id"]);
    assert.equal(result.status, EXIT_CODES.USER_ERROR);
  });

  it("--yes without --name → 1 (USER_ERROR)", () => {
    // cwd is empty so detection lands on greenfield → resolveYesConfig fires.
    const result = runCli(["--yes"], { cwd: tmp });
    assert.equal(result.status, EXIT_CODES.USER_ERROR);
  });

  it("non-Expo cwd with files → 1 (USER_ERROR, was 2 in v1.3)", () => {
    // A non-Expo directory with content is the EXISTING_NON_EXPO refuse path.
    // We deliberately seed a stray file rather than a package.json so detection
    // lands on "no-package-json" — that's still a refuse, still USER_ERROR.
    fs.writeFileSync(path.join(tmp, "random.txt"), "hello");
    const result = runCli([], { cwd: tmp });
    assert.equal(result.status, EXIT_CODES.USER_ERROR);
  });

  // The remaining EXISTING_NON_EXPO refuse reasons (mode.mjs:71 and 87). The
  // 2.0 break moved every refuse to USER_ERROR; without these tests, a future
  // change that flips one reason back to ENV_ERROR would pass CI.
  it("invalid package.json (parse error) -> 1 (USER_ERROR)", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), "{ not valid json");
    const result = runCli([], { cwd: tmp });
    assert.equal(result.status, EXIT_CODES.USER_ERROR);
  });

  it("package.json with no expo dep -> 1 (USER_ERROR)", () => {
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "rn-app", dependencies: { "react-native": "0.81.0" } }),
    );
    const result = runCli([], { cwd: tmp });
    assert.equal(result.status, EXIT_CODES.USER_ERROR);
  });

  it("workspace with apps/mobile/ already present -> 1 (USER_ERROR)", () => {
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "host" }),
    );
    fs.writeFileSync(
      path.join(tmp, "pnpm-workspace.yaml"),
      "packages:\n  - 'apps/*'\n",
    );
    fs.mkdirSync(path.join(tmp, "apps", "mobile"), { recursive: true });
    const result = runCli([], { cwd: tmp });
    assert.equal(result.status, EXIT_CODES.USER_ERROR);
  });
});

// SIGINT propagation. The CLI's apply phase catches a task throw and exits 130
// when `interrupted` is true (the SIGINT handler in bin/index.mjs flips the
// flag). Verifying this end-to-end requires a real subprocess: spawn the CLI
// in --yes greenfield mode with the test-only CMS_TEST_SCAFFOLD_DELAY_MS hook
// inserted before the "Copying template" task, wait for the spinner to start,
// send SIGINT, and assert the exit status. Skipped on non-macOS because
// preflight will hard-fail at "macOS required" before any task runs.
describe("CLI propagates SIGINT as exit 130 during a task", () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-sigint-"));
  });

  afterEach(() => {
    if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  // Mirrors the runCli helper above, but stays detached so we can signal it.
  // Returns a Promise that resolves with { code, signal, stdout, stderr } when
  // the child exits, plus a `ready` Promise that resolves as soon as the first
  // task spinner output lands on stdout — i.e. we're past preflight and into
  // the scaffold pipeline.
  function spawnCli(args, { cwd, env }) {
    const child = spawn("node", [cliBin, ...args], {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let resolveReady;
    const ready = new Promise((r) => {
      resolveReady = r;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      // The "Copying template" label is emitted by ui.task() the moment the
      // first scaffold task starts. CMS_TEST_SCAFFOLD_DELAY_MS holds the task
      // open for the duration we configure, so SIGINT lands mid-task.
      if (stdout.includes("Copying template")) resolveReady();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const exited = new Promise((resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
    });

    return { child, ready, exited };
  }

  it(
    "exits 130 when SIGINT lands during the scaffold task pipeline",
    { skip: process.platform !== "darwin" ? "SIGINT propagation test is macOS-only (preflight rejects other platforms)" : false },
    async () => {
      // 5s ceiling on overall test duration; the delay we inject is 3s which
      // leaves 2s for spawn + SIGINT delivery + child exit.
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("SIGINT test timed out")),
          5000,
        );
        const { child, ready, exited } = spawnCli(
          [
            "--yes",
            "--name=sigint-fixture",
            "--bundle-id=com.acme.sigintfixture",
            "--no-install",
          ],
          {
            cwd: tmp,
            env: { CMS_TEST_SCAFFOLD_DELAY_MS: "3000" },
          },
        );
        ready
          .then(() => {
            child.kill("SIGINT");
            return exited;
          })
          .then((res) => {
            clearTimeout(timer);
            resolve(res);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });

      // POSIX 128 + signal: SIGINT (2) → 130. Node sometimes reports the exit
      // as `code=null, signal='SIGINT'` when the process was killed before any
      // explicit process.exit() ran. Accept either path: both shapes mean
      // "the CLI was interrupted by SIGINT", and the public contract is that a
      // user piping the CLI's status into a shell sees 130.
      const status =
        result.code !== null ? result.code : result.signal === "SIGINT" ? 130 : null;
      assert.equal(
        status,
        EXIT_CODES.INTERRUPTED,
        `expected exit 130, got code=${result.code} signal=${result.signal}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    },
  );
});
