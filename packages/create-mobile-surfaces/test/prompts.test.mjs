// Prompt-flow coverage that doesn't go through @inquirer/prompts. The
// orchestrators in src/prompts.mjs and src/ui.mjs each accept a `ui`
// parameter that defaults to the live module; tests inject a fake ui
// whose askText/askConfirm/askSelect run a scripted answer queue (with
// the validator) and whose log/rail/section are no-ops.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runPrompts } from "../src/prompts.mjs";
import {
  adaptValidate,
  askConfirm,
  askSelect,
  askText,
  guard,
  resetPrompts,
  setPrompts,
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
    setPrompts({
      input: async () => {
        const err = new Error("user canceled");
        err.name = "ExitPromptError";
        throw err;
      },
    });
    try {
      await assert.rejects(
        () => askText({ message: "x", defaultValue: "" }),
        /__exit__/,
      );
      assert.equal(getExited(), EXIT_CODES.SUCCESS);
    } finally {
      resetPrompts();
    }
  });
});

test("askConfirm: ExitPromptError thrown by confirm() bubbles into guard and exits 0", async () => {
  await withCapturedExit(async (getExited) => {
    setPrompts({
      confirm: async () => {
        const err = new Error("user canceled");
        err.name = "ExitPromptError";
        throw err;
      },
    });
    try {
      await assert.rejects(
        () => askConfirm({ message: "ok?" }),
        /__exit__/,
      );
      assert.equal(getExited(), EXIT_CODES.SUCCESS);
    } finally {
      resetPrompts();
    }
  });
});

test("askSelect: ExitPromptError thrown by select() bubbles into guard and exits 0", async () => {
  await withCapturedExit(async (getExited) => {
    setPrompts({
      select: async () => {
        const err = new Error("user canceled");
        err.name = "ExitPromptError";
        throw err;
      },
    });
    try {
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
    } finally {
      resetPrompts();
    }
  });
});

test("askText: ERR_USE_AFTER_CLOSE thrown by input() bubbles into guard and exits 0", async () => {
  await withCapturedExit(async (getExited) => {
    setPrompts({
      input: async () => {
        const err = new Error("stream closed mid-prompt");
        err.code = "ERR_USE_AFTER_CLOSE";
        throw err;
      },
    });
    try {
      await assert.rejects(
        () => askText({ message: "x", defaultValue: "" }),
        /__exit__/,
      );
      assert.equal(getExited(), EXIT_CODES.SUCCESS);
    } finally {
      resetPrompts();
    }
  });
});

test("askText: passes the adapted validator into input(); validator string surfaces as inquirer-shape error", async () => {
  let capturedArgs;
  setPrompts({
    input: async (args) => {
      capturedArgs = args;
      return "answer";
    },
  });
  try {
    const result = await askText({
      message: "name",
      defaultValue: "",
      validate: (value) => (value === "ok" ? undefined : "needs to be lowercase"),
    });
    assert.equal(result, "answer");
    assert.equal(capturedArgs.message, "name");
    assert.equal(capturedArgs.default, "");
    // The adapted validator returns true on accept and the error string on
    // reject, which is what @inquirer/prompts.input expects.
    assert.equal(typeof capturedArgs.validate, "function");
    assert.equal(capturedArgs.validate("ok"), true);
    assert.equal(capturedArgs.validate("WHATEVER"), "needs to be lowercase");
  } finally {
    resetPrompts();
  }
});

test("askText: omits validate when none is supplied so input() runs unvalidated", async () => {
  let capturedArgs;
  setPrompts({
    input: async (args) => {
      capturedArgs = args;
      return "answer";
    },
  });
  try {
    const result = await askText({ message: "name", defaultValue: "" });
    assert.equal(result, "answer");
    assert.equal(capturedArgs.validate, undefined);
  } finally {
    resetPrompts();
  }
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
