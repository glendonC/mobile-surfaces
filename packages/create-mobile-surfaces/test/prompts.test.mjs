// Prompt-flow coverage that doesn't go through @inquirer/prompts. The
// orchestrators in src/prompts.mjs and src/ui.mjs each accept a `ui`
// parameter that defaults to the live module; tests inject a fake ui
// whose askText/askConfirm/askSelect run a scripted answer queue (with
// the validator) and whose log/rail/section are no-ops.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runPrompts } from "../src/prompts.mjs";
import { runExistingExpoPrompts } from "../src/existing-expo.mjs";
import { runMonorepoPrompts } from "../src/existing-monorepo.mjs";
import {
  adaptValidate,
  askConfirm,
  askSelect,
  askText,
  guard,
  withStubbedPrompts,
} from "../src/ui.mjs";
import { EXIT_CODES } from "../src/exit-codes.mjs";

// Helper for the askText/askSelect/askConfirm tests: swap process.exit for
// a thrower so the test can assert the exit code without actually exiting,
// then restore. The thrown sentinel unwinds the async stack out of guard().
function withCapturedExit(fn) {
  const original = process.exit;
  let exited;
  process.exit = (code) => {
    exited = code;
    throw new Error("__exit__");
  };
  return fn(() => exited).finally(() => {
    process.exit = original;
  });
}

// Build a fake ui. `script` is an array of { kind: "text"|"confirm"|"select",
// answer } entries consumed in order each time the matching prompt runs. For
// text prompts, if a `validate` function is supplied to the prompt, the fake
// runs it against the scripted answer; if validation fails the test asserts
// — fakes don't simulate retry, since the orchestrator under test treats
// each prompt as one resolved value.
function makeFakeUi(script) {
  const calls = [];
  const recordingPrompt = (kind) => async (args) => {
    const next = script.shift();
    if (!next) {
      throw new Error(`fake ui: ${kind} prompt fired but script is empty (message=${args?.message ?? "?"})`);
    }
    if (next.kind !== kind) {
      throw new Error(`fake ui: expected ${next.kind} but got ${kind} (message=${args?.message ?? "?"})`);
    }
    calls.push({ kind, args, answer: next.answer });
    if (kind === "text" && typeof args.validate === "function") {
      const result = args.validate(next.answer);
      if (result !== undefined) {
        throw new Error(`fake ui: validator rejected scripted answer (${result})`);
      }
    }
    return next.answer;
  };
  return {
    calls,
    askText: recordingPrompt("text"),
    askConfirm: recordingPrompt("confirm"),
    askSelect: recordingPrompt("select"),
    log: { info: () => {}, message: () => {}, success: () => {}, warn: () => {}, error: () => {} },
    rail: { step: () => {}, line: () => {}, block: () => {}, blank: () => {}, open: () => {}, close: () => {} },
    section: () => {},
  };
}

// --- ui.mjs: adaptValidate -----------------------------------------------

test("adaptValidate: returns undefined when no validator is supplied", () => {
  assert.equal(adaptValidate(undefined), undefined);
  assert.equal(adaptValidate(null), undefined);
});

test("adaptValidate: returns true when the validator passes", () => {
  const adapted = adaptValidate((value) => (value === "ok" ? undefined : "nope"));
  assert.equal(adapted("ok"), true);
});

test("adaptValidate: surfaces the validator's error string when validation fails", () => {
  const adapted = adaptValidate(() => "needs to be lowercase");
  assert.equal(adapted("WHATEVER"), "needs to be lowercase");
});

// --- ui.mjs: guard --------------------------------------------------------

test("guard: catches ExitPromptError and exits 0", async () => {
  const original = process.exit;
  let exited;
  process.exit = (code) => {
    exited = code;
    throw new Error("__exit__"); // unwind so the test continues
  };
  try {
    const err = new Error("user canceled");
    err.name = "ExitPromptError";
    await assert.rejects(
      () =>
        guard(() => {
          throw err;
        }),
      /__exit__/,
    );
    assert.equal(exited, EXIT_CODES.SUCCESS);
  } finally {
    process.exit = original;
  }
});

test("guard: catches ERR_USE_AFTER_CLOSE and exits 0", async () => {
  const original = process.exit;
  let exited;
  process.exit = (code) => {
    exited = code;
    throw new Error("__exit__");
  };
  try {
    const err = new Error("stream closed mid-prompt");
    err.code = "ERR_USE_AFTER_CLOSE";
    await assert.rejects(
      () =>
        guard(() => {
          throw err;
        }),
      /__exit__/,
    );
    assert.equal(exited, EXIT_CODES.SUCCESS);
  } finally {
    process.exit = original;
  }
});

test("guard: rethrows unrelated errors instead of exiting", async () => {
  const original = process.exit;
  let exited;
  process.exit = (code) => {
    exited = code;
  };
  try {
    await assert.rejects(
      () =>
        guard(() => {
          throw new Error("network down");
        }),
      /network down/,
    );
    assert.equal(exited, undefined);
  } finally {
    process.exit = original;
  }
});

// --- ui.mjs: askText / askSelect / askConfirm via setPrompts() ------------
//
// These tests pin the wiring between guard(), adaptValidate(), and the
// @inquirer primitives that askText/askSelect/askConfirm wrap. The
// orchestrator-level tests above use a fake ui that bypasses these
// wrappers; the cases below exercise the wrappers themselves by injecting
// stubs through setPrompts() and confirming the cancellation + validator
// paths behave as documented.

test("askText: ExitPromptError thrown by input() bubbles into guard and exits 0", async () => {
  await withCapturedExit(async (getExited) => {
    await withStubbedPrompts(
      {
        input: async () => {
          const err = new Error("user canceled");
          err.name = "ExitPromptError";
          throw err;
        },
      },
      async () => {
        await assert.rejects(
          () => askText({ message: "x", defaultValue: "" }),
          /__exit__/,
        );
        assert.equal(getExited(), EXIT_CODES.SUCCESS);
      },
    );
  });
});

test("askConfirm: ExitPromptError thrown by confirm() bubbles into guard and exits 0", async () => {
  await withCapturedExit(async (getExited) => {
    await withStubbedPrompts(
      {
        confirm: async () => {
          const err = new Error("user canceled");
          err.name = "ExitPromptError";
          throw err;
        },
      },
      async () => {
        await assert.rejects(() => askConfirm({ message: "ok?" }), /__exit__/);
        assert.equal(getExited(), EXIT_CODES.SUCCESS);
      },
    );
  });
});

test("askSelect: ExitPromptError thrown by select() bubbles into guard and exits 0", async () => {
  await withCapturedExit(async (getExited) => {
    await withStubbedPrompts(
      {
        select: async () => {
          const err = new Error("user canceled");
          err.name = "ExitPromptError";
          throw err;
        },
      },
      async () => {
        await assert.rejects(
          () =>
            askSelect({
              message: "pick",
              options: [
                { value: 1, label: "one" },
                { value: 2, label: "two" },
              ],
            }),
          /__exit__/,
        );
        assert.equal(getExited(), EXIT_CODES.SUCCESS);
      },
    );
  });
});

test("askText: ERR_USE_AFTER_CLOSE thrown by input() bubbles into guard and exits 0", async () => {
  await withCapturedExit(async (getExited) => {
    await withStubbedPrompts(
      {
        input: async () => {
          const err = new Error("stream closed mid-prompt");
          err.code = "ERR_USE_AFTER_CLOSE";
          throw err;
        },
      },
      async () => {
        await assert.rejects(
          () => askText({ message: "x", defaultValue: "" }),
          /__exit__/,
        );
        assert.equal(getExited(), EXIT_CODES.SUCCESS);
      },
    );
  });
});

test("askText: passes the adapted validator into input(); validator string surfaces as inquirer-shape error", async () => {
  let capturedArgs;
  await withStubbedPrompts(
    {
      input: async (args) => {
        capturedArgs = args;
        return "answer";
      },
    },
    async () => {
      const result = await askText({
        message: "name",
        defaultValue: "",
        validate: (value) =>
          value === "ok" ? undefined : "needs to be lowercase",
      });
      assert.equal(result, "answer");
      assert.equal(capturedArgs.message, "name");
      assert.equal(capturedArgs.default, "");
      // The adapted validator returns true on accept and the error string on
      // reject, which is what @inquirer/prompts.input expects.
      assert.equal(typeof capturedArgs.validate, "function");
      assert.equal(capturedArgs.validate("ok"), true);
      assert.equal(capturedArgs.validate("WHATEVER"), "needs to be lowercase");
    },
  );
});

test("askText: omits validate when none is supplied so input() runs unvalidated", async () => {
  let capturedArgs;
  await withStubbedPrompts(
    {
      input: async (args) => {
        capturedArgs = args;
        return "answer";
      },
    },
    async () => {
      const result = await askText({ message: "name", defaultValue: "" });
      assert.equal(result, "answer");
      assert.equal(capturedArgs.validate, undefined);
    },
  );
});

// --- prompts.mjs: runPrompts ---------------------------------------------

test("runPrompts: each text prompt receives the validator that matches its identity", async () => {
  const ui = makeFakeUi([
    { kind: "text", answer: "myproj" },          // projectName -> validateProjectSlug
    { kind: "text", answer: "myproj" },          // scheme      -> validateScheme
    { kind: "text", answer: "com.acme.myproj" }, // bundleId    -> validateBundleId
    { kind: "text", answer: "" },                // teamId      -> validateTeamId
    { kind: "confirm", answer: true },           // homeWidget
    { kind: "confirm", answer: true },           // controlWidget
    { kind: "select", answer: true },            // installNow
    { kind: "confirm", answer: true },           // recap confirm
  ]);
  const result = await runPrompts({ overrides: {}, yes: false, ui });
  assert.equal(result.projectName, "myproj");
  assert.equal(result.bundleId, "com.acme.myproj");

  // Validators are independent: the bundle-id prompt's validator must reject
  // a project-slug-shaped value, and the project-slug prompt's validator
  // must reject a bundle-id-shaped value. If the orchestrator wired the
  // wrong validator into the wrong prompt, one of these would reverse.
  const textCalls = ui.calls.filter((c) => c.kind === "text");
  assert.equal(textCalls.length, 4);
  const [slugCall, , bundleCall] = textCalls;
  assert.equal(slugCall.args.validate("myproj"), undefined);
  assert.match(slugCall.args.validate("com.acme.myproj") ?? "", /Lowercase letters/);
  assert.equal(bundleCall.args.validate("com.acme.myproj"), undefined);
  assert.match(bundleCall.args.validate("myproj") ?? "", /reverse-DNS/);
});

test("runPrompts: --yes mode skips every interactive prompt", async () => {
  const ui = makeFakeUi([]);
  const result = await runPrompts({
    overrides: {
      projectName: "skip",
      scheme: "skip",
      bundleId: "com.skip.app",
      teamId: "",
      homeWidget: true,
      controlWidget: true,
      installNow: true,
    },
    yes: true,
    ui,
  });
  assert.equal(ui.calls.length, 0);
  assert.equal(result.projectName, "skip");
});

test("runPrompts: rejected recap confirm restarts the flow; second confirm returns the answer", async () => {
  const ui = makeFakeUi([
    // First pass — user answers, then declines the recap.
    { kind: "text", answer: "first" },
    { kind: "text", answer: "first" },
    { kind: "text", answer: "com.first.app" },
    { kind: "text", answer: "" },
    { kind: "confirm", answer: true },
    { kind: "confirm", answer: true },
    { kind: "select", answer: true },
    { kind: "confirm", answer: false }, // recap rejected -> restart
    // Second pass — user answers again, accepts the recap.
    { kind: "text", answer: "second" },
    { kind: "text", answer: "second" },
    { kind: "text", answer: "com.second.app" },
    { kind: "text", answer: "" },
    { kind: "confirm", answer: true },
    { kind: "confirm", answer: true },
    { kind: "select", answer: true },
    { kind: "confirm", answer: true },
  ]);
  const result = await runPrompts({ overrides: {}, yes: false, ui });
  assert.equal(result.projectName, "second");
  assert.equal(result.bundleId, "com.second.app");
  assert.equal(ui.calls.length, 16);
});

// --- live inquirer retry loop --------------------------------------------

// The DI-seam tests above stub the inquirer primitives, so they pin the
// wiring shape (adaptValidate returns a string on reject) but don't exercise
// the actual retry loop inside @inquirer/prompts.input. The test below uses
// @inquirer/testing's virtual-stream renderer to drive the real input prompt
// end-to-end: type a rejected value, observe the prompt re-ask, type an
// accepted value, observe the answer resolve. If a future inquirer release
// changes its validator contract (return string -> retry), this test fails
// where the stubs would still pass.
import { input as inquirerInput } from "@inquirer/prompts";
import { render } from "@inquirer/testing";

test("live inquirer retry loop: rejected value re-asks; accepted value resolves", async () => {
  // Same validator + adapter the CLI uses, exercised through the real prompt.
  // Counted so the test pins the retry contract (validator called once per
  // submission attempt) in addition to the screen-render evidence below.
  const seen = [];
  const validate = (value) => {
    seen.push(value);
    return value === "ok" ? undefined : "needs to be exactly 'ok'";
  };
  const inquirerValidator = adaptValidate(validate);

  const { answer, events, getScreen } = await render(inquirerInput, {
    message: "type ok",
    validate: inquirerValidator,
  });

  // First pass: a rejected value. inquirer should NOT resolve `answer`; it
  // should re-render with the validator's error string visible.
  events.type("bad");
  events.keypress("enter");

  // Give inquirer's event loop time to run the validator and re-render.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(
    getScreen(),
    /needs to be exactly 'ok'/,
    "inquirer should render the validator's rejection message",
  );

  // Second pass: clear the rejected value, type the accepted one. inquirer
  // resolves `answer` once the validator returns true (which adaptValidate
  // produces when the underlying validate returns undefined).
  for (let i = 0; i < "bad".length; i += 1) {
    events.keypress("backspace");
  }
  events.type("ok");
  events.keypress("enter");

  const result = await answer;
  assert.equal(result, "ok");
  // Exactly two submissions: the rejected "bad" and the accepted "ok". A
  // regression where the adapter returned `true` for everything (or the
  // retry loop dropped the validator entirely) would show as one call.
  assert.deepEqual(seen, ["bad", "ok"]);
});

// Fixtures for the existing-expo and monorepo orchestrator tests. Both
// flows expect an evidence object from mode detection and a template
// manifest with the same shape buildManifestFromLive produces. Keep these
// minimal: only the keys the orchestrators actually read.
const EXPO_EVIDENCE = Object.freeze({
  cwd: "/fake/cwd",
  packageName: "host-app",
  expoVersion: "~54.0.0",
  config: {
    kind: "json",
    path: "/fake/cwd/app.json",
    parsed: {
      name: "Host App",
      ios: { bundleIdentifier: "com.acme.host", deploymentTarget: "17.2" },
      plugins: [],
    },
    appName: "Host App",
    bundleId: "com.acme.host",
    deploymentTarget: "17.2",
  },
  packageManager: "pnpm",
  hasIosDir: false,
  pluginsPresent: [],
});

const MONOREPO_EVIDENCE = Object.freeze({
  cwd: "/fake/monorepo",
  packageName: "host-monorepo",
  packageManager: "pnpm",
  workspaceKind: "pnpm-workspace",
  workspacePath: "/fake/monorepo/pnpm-workspace.yaml",
  workspaceGlobs: ["apps/*", "packages/*"],
});

const FAKE_MANIFEST = Object.freeze({
  cliRequiredNode: ">=24",
  deploymentTarget: "17.2",
  minimumXcodeMajor: 26,
  addPackages: [{ name: "@mobile-surfaces/live-activity", version: "2.0.0" }],
  addPlugins: [{ name: "expo-build-properties", config: {} }],
  addInfoPlist: {},
  addEntitlements: {},
  widgetTargetDir: "apps/mobile/targets/widget",
  widgetFiles: [
    "apps/mobile/targets/widget/MobileSurfacesHomeWidget.swift",
    "apps/mobile/targets/widget/MobileSurfacesControlWidget.swift",
    "apps/mobile/targets/widget/MobileSurfacesLiveActivity.swift",
  ],
});

test("runPrompts: recap rejected twice restarts twice, then resolves on the third pass", async () => {
  // Extends the single-rejection coverage above. Pinning multi-pass restart
  // protects against a regression where the recursion only triggers once
  // (e.g. accidentally consuming the rejection state on the first restart).
  const ui = makeFakeUi([
    // Pass 1 — declined.
    { kind: "text", answer: "one" },
    { kind: "text", answer: "one" },
    { kind: "text", answer: "com.one.app" },
    { kind: "text", answer: "" },
    { kind: "confirm", answer: true },
    { kind: "confirm", answer: true },
    { kind: "select", answer: true },
    { kind: "confirm", answer: false },
    // Pass 2 — declined again.
    { kind: "text", answer: "two" },
    { kind: "text", answer: "two" },
    { kind: "text", answer: "com.two.app" },
    { kind: "text", answer: "" },
    { kind: "confirm", answer: true },
    { kind: "confirm", answer: true },
    { kind: "select", answer: true },
    { kind: "confirm", answer: false },
    // Pass 3 — accepted.
    { kind: "text", answer: "three" },
    { kind: "text", answer: "three" },
    { kind: "text", answer: "com.three.app" },
    { kind: "text", answer: "" },
    { kind: "confirm", answer: true },
    { kind: "confirm", answer: true },
    { kind: "select", answer: true },
    { kind: "confirm", answer: true },
  ]);
  const result = await runPrompts({ overrides: {}, yes: false, ui });
  assert.equal(result.projectName, "three");
  assert.equal(result.bundleId, "com.three.app");
  assert.equal(ui.calls.length, 24);
});

// --- orchestrator-level cancellation through the live ui --------------------

// The fake-ui tests above pin the orchestrator's wiring, but cancellation
// only fires through the live askText/askConfirm/askSelect wrappers (guard()
// catches ExitPromptError and calls process.exit). The tests below run the
// orchestrator against the live ui module with a single inquirer primitive
// stubbed via setPrompts, so guard() runs for real and we can assert on the
// exit code.

test("runPrompts: ExitPromptError thrown mid-flow exits SUCCESS through guard", async () => {
  await withCapturedExit(async (getExited) => {
    let inputCalls = 0;
    await withStubbedPrompts(
      {
        input: async () => {
          inputCalls += 1;
          if (inputCalls === 1) return "myproj";
          const err = new Error("user canceled");
          err.name = "ExitPromptError";
          throw err;
        },
      },
      async () => {
        await assert.rejects(
          () => runPrompts({ overrides: {}, yes: false }),
          /__exit__/,
        );
        assert.equal(getExited(), EXIT_CODES.SUCCESS);
      },
    );
  });
});

// --- runExistingExpoPrompts ------------------------------------------------

test("runExistingExpoPrompts: happy path returns mode + teamId + plan", async () => {
  const ui = makeFakeUi([
    { kind: "confirm", answer: true },  // homeWidget
    { kind: "confirm", answer: true },  // controlWidget
    { kind: "text", answer: "ABCDE12345" }, // teamId (app.json has no real one in this fixture)
    { kind: "select", answer: true },   // installNow
    { kind: "confirm", answer: true },  // recap confirm
  ]);
  const result = await runExistingExpoPrompts({
    evidence: EXPO_EVIDENCE,
    manifest: FAKE_MANIFEST,
    overrides: {},
    yes: false,
    ui,
  });
  assert.equal(result.mode, "existing-expo");
  assert.equal(result.teamId, "ABCDE12345");
  assert.equal(result.installNow, true);
  assert.equal(result.plan.surfaces.homeWidget, true);
  assert.equal(result.plan.surfaces.controlWidget, true);
});

test("runExistingExpoPrompts: declining the recap exits SUCCESS without restarting", async () => {
  // Asymmetry with greenfield: existing-expo treats recap-decline as
  // cancellation, not a restart, because the user already has a project and
  // the prompt sequence does not produce a fresh identity worth re-collecting.
  // If a future change makes this path restart instead, the exit assertion
  // below fails and surfaces the divergence.
  await withCapturedExit(async (getExited) => {
    const ui = makeFakeUi([
      { kind: "confirm", answer: true },
      { kind: "confirm", answer: true },
      { kind: "text", answer: "" },
      { kind: "select", answer: true },
      { kind: "confirm", answer: false }, // recap declined
    ]);
    await assert.rejects(
      () =>
        runExistingExpoPrompts({
          evidence: EXPO_EVIDENCE,
          manifest: FAKE_MANIFEST,
          overrides: {},
          yes: false,
          ui,
        }),
      /__exit__/,
    );
    assert.equal(getExited(), EXIT_CODES.SUCCESS);
  });
});

test("runExistingExpoPrompts: ExitPromptError mid-flow exits SUCCESS through guard", async () => {
  await withCapturedExit(async (getExited) => {
    await withStubbedPrompts(
      {
        confirm: async () => {
          const err = new Error("user canceled");
          err.name = "ExitPromptError";
          throw err;
        },
      },
      async () => {
        await assert.rejects(
          () =>
            runExistingExpoPrompts({
              evidence: EXPO_EVIDENCE,
              manifest: FAKE_MANIFEST,
              overrides: {},
              yes: false,
            }),
          /__exit__/,
        );
        assert.equal(getExited(), EXIT_CODES.SUCCESS);
      },
    );
  });
});

// --- runMonorepoPrompts ----------------------------------------------------

test("runMonorepoPrompts: happy path returns mode + config + plan", async () => {
  const ui = makeFakeUi([
    { kind: "text", answer: "lockscreen-demo" }, // projectName
    { kind: "text", answer: "lockscreendemo" },  // scheme
    { kind: "text", answer: "com.acme.lockscreendemo" }, // bundleId
    { kind: "text", answer: "" },                // teamId
    { kind: "confirm", answer: true },           // homeWidget
    { kind: "confirm", answer: true },           // controlWidget
    { kind: "select", answer: true },            // installNow
    { kind: "confirm", answer: true },           // recap confirm
  ]);
  const result = await runMonorepoPrompts({
    evidence: MONOREPO_EVIDENCE,
    manifest: FAKE_MANIFEST,
    overrides: {},
    yes: false,
    ui,
  });
  assert.equal(result.mode, "existing-monorepo-no-expo");
  assert.equal(result.config.projectName, "lockscreen-demo");
  assert.equal(result.config.teamId, null);
  assert.equal(result.plan.appsMobileDest.endsWith("apps/mobile"), true);
  // Workspace already declares apps/*, so the plan should not propose to add it.
  assert.deepEqual(result.plan.workspaceGlobsToAdd, []);
});

test("runMonorepoPrompts: declining the recap exits SUCCESS without restarting", async () => {
  await withCapturedExit(async (getExited) => {
    const ui = makeFakeUi([
      { kind: "text", answer: "lockscreen-demo" },
      { kind: "text", answer: "lockscreendemo" },
      { kind: "text", answer: "com.acme.lockscreendemo" },
      { kind: "text", answer: "" },
      { kind: "confirm", answer: true },
      { kind: "confirm", answer: true },
      { kind: "select", answer: true },
      { kind: "confirm", answer: false }, // recap declined
    ]);
    await assert.rejects(
      () =>
        runMonorepoPrompts({
          evidence: MONOREPO_EVIDENCE,
          manifest: FAKE_MANIFEST,
          overrides: {},
          yes: false,
          ui,
        }),
      /__exit__/,
    );
    assert.equal(getExited(), EXIT_CODES.SUCCESS);
  });
});
