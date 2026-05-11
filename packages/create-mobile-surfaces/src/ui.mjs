// UI primitives. We wrap @inquirer/prompts (rock-solid TTY handling) and
// ora (gold-standard spinners) in a tiny façade so the rest of the CLI
// stays declarative. Rendering for grouped content (banner, recap, success
// screen, refuse messages) goes through plain `process.stdout.write` —
// nothing redraws, nothing miscounts lines.
//
// The left rail (`│  `) is the one consistent visual element threading the
// flow together. We apply it to every line of content we control. Inquirer
// prompts keep their own visual treatment; the brief rail-break around an
// active prompt actually reads as "your turn" rather than as inconsistency.

import { cursorHide } from "@inquirer/ansi";
import { EXIT_CODES } from "./exit-codes.mjs";
import {
  createPrompt,
  isEnterKey,
  makeTheme,
  useKeypress,
  usePrefix,
  useState,
} from "@inquirer/core";
import { input, select as inqSelect } from "@inquirer/prompts";
import ora from "ora";
import pc from "picocolors";

// @inquirer primitives wired in here so the rest of the file can call them
// through one indirection. Live mode (the default) uses the real inquirer
// implementations; tests call setPrompts() to inject stubs for
// ExitPromptError / ERR_USE_AFTER_CLOSE / validator paths without driving
// an actual TTY. Reset to live with resetPrompts(). The `confirm` slot is
// stitched in below once horizontalConfirm is declared.
const LIVE_PROMPTS = {
  input,
  select: inqSelect,
  confirm: null,
};

let activePrompts = { ...LIVE_PROMPTS };

/**
 * Override one or more of the @inquirer primitives ({ input, select,
 * confirm }) for tests. Only the keys you pass are replaced; everything
 * else falls back to the live implementation. Call resetPrompts() after
 * the test to restore the originals.
 */
export function setPrompts(overrides) {
  activePrompts = { ...activePrompts, ...overrides };
}

/** Restore the live @inquirer primitives. */
export function resetPrompts() {
  activePrompts = { ...LIVE_PROMPTS };
}

// Rail glyphs — gray so the content carries weight, the chrome doesn't.
const RAIL_BAR = pc.gray("│");
const RAIL_PREFIX = pc.gray("│  ");
const RAIL_OPEN = pc.gray("┌  ");
const RAIL_CLOSE = pc.gray("└  ");
const STEP_GLYPH = pc.cyan("◆");

// ANSI-aware word wrapping. The terminal will soft-wrap any content that
// exceeds `process.stdout.columns`, but its wrap starts at column 0 — the
// rail prefix doesn't get applied to the continuation, which leaves a
// visible gap in the rail. Wrap ourselves and prefix every wrapped row.
const ANSI_RE = /\x1B\[[0-9;]*m/g;
const visibleLen = (s) => s.replace(ANSI_RE, "").length;

function wrapToWidth(line, width) {
  if (visibleLen(line) <= width) return [line];
  // Preserve leading whitespace as the continuation indent so wrapped rows
  // line up under the original content (e.g. dim "fix" text under a warning).
  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[0] : "";
  const body = line.slice(indent.length);
  const innerWidth = Math.max(1, width - indent.length);
  const words = body.split(" ");
  const rows = [];
  let row = "";
  let rowLen = 0;
  for (const word of words) {
    const w = visibleLen(word);
    if (rowLen === 0) {
      row = word;
      rowLen = w;
    } else if (rowLen + 1 + w <= innerWidth) {
      row += " " + word;
      rowLen += 1 + w;
    } else {
      rows.push(indent + row);
      row = word;
      rowLen = w;
    }
  }
  if (row) rows.push(indent + row);
  return rows;
}

// 3 columns are spent on the rail prefix (`│  `). Leave at least 20 for
// content so a tiny terminal still produces something — the wrap will be
// aggressive but the rail will hold.
function railContentWidth() {
  const cols = process.stdout.columns || 80;
  return Math.max(20, cols - 3);
}

// Apply the rail prefix to a multi-line string, wrapping each content line
// to fit the terminal so wraps stay inside the rail. Empty lines get just
// the bar (no trailing whitespace) so blank rows look natural.
export function railed(text) {
  const width = railContentWidth();
  const out = [];
  for (const original of text.split("\n")) {
    if (original.length === 0) {
      out.push("");
      continue;
    }
    for (const wrapped of wrapToWidth(original, width)) {
      out.push(wrapped);
    }
  }
  return out
    .map((line) => (line.length === 0 ? RAIL_BAR : RAIL_PREFIX + line))
    .join("\n");
}

export const rail = {
  // Open the flow with `┌  text`. Use once at the very start.
  open: (text) => process.stdout.write(RAIL_OPEN + text + "\n"),
  // Close the flow with `└  text`. Use once at the very end (success).
  close: (text) => process.stdout.write(RAIL_CLOSE + text + "\n"),
  // A rail-prefixed line of content. Wraps to the terminal width so the
  // continuation rows still carry the rail.
  line: (text = "") => {
    if (text.length === 0) {
      process.stdout.write(RAIL_BAR + "\n");
      return;
    }
    process.stdout.write(railed(text) + "\n");
  },
  // A rail-prefixed multi-line block. One stdout.write so it lands as a unit.
  block: (text) => process.stdout.write(railed(text) + "\n"),
  // A blank rail row — useful as a separator between sections.
  blank: () => process.stdout.write(RAIL_BAR + "\n"),
  // A numbered step heading. Replaces the rail bar on its own row with a
  // diamond glyph and writes a trailing blank so the heading reads as a
  // visual section break before its content.
  step: (n, total, title) => {
    const heading =
      STEP_GLYPH + "  " + pc.dim(`${n}/${total}`) + "  " + pc.bold(title);
    process.stdout.write(heading + "\n");
    process.stdout.write(RAIL_BAR + "\n");
  },
};

// Inquirer throws an ExitPromptError when the user hits Ctrl+C. We funnel
// that through a single catch so each prompt site doesn't repeat the
// "say cancelled, exit 0" pattern. Exported so the cancellation contract
// can be unit-tested directly without going through the prompt-orchestrator
// layer.
export async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    if (
      err?.name === "ExitPromptError" ||
      err?.code === "ERR_USE_AFTER_CLOSE"
    ) {
      process.stdout.write("\n" + pc.dim("Cancelled. No files written.") + "\n");
      process.exit(EXIT_CODES.SUCCESS);
    }
    throw err;
  }
}

// Validators in our codebase return a string (the error) or undefined
// (valid). Inquirer expects `true` on valid and a string on error.
// Exported for direct unit testing.
export function adaptValidate(validate) {
  if (!validate) return undefined;
  return (value) => {
    const err = validate(value);
    return err ? err : true;
  };
}

// Hints are embedded in `message` directly by the caller (so each prompt
// gets to format its own — some use parens, some use a colon, etc).
// Inquirer renders `(default)` automatically next to the prompt when
// `default` is set, which serves as a free hint for "press enter to accept".
export async function askText({ message, defaultValue, validate }) {
  return guard(() =>
    activePrompts.input({
      message,
      default: defaultValue,
      validate: adaptValidate(validate),
    }),
  );
}

export async function askSelect({ message, options, defaultValue }) {
  return guard(() =>
    activePrompts.select({
      message,
      default: defaultValue,
      choices: options.map((o) => ({
        name: o.label,
        value: o.value,
        description: o.hint,
      })),
    }),
  );
}

// Horizontal pill-style confirm. Built on @inquirer/core so we get the same
// TTY guarantees as the rest of the prompts (Ctrl+C handling, redraw, theme)
// but render two side-by-side buttons instead of typing y/N. Left/right
// arrow toggles, enter submits, Y/N still work as shortcuts so muscle
// memory carries over.
const horizontalConfirm = createPrompt((config, done) => {
  const [status, setStatus] = useState("idle");
  const [value, setValue] = useState(config.default !== false);
  const theme = makeTheme(config.theme);
  const prefix = usePrefix({ status, theme });

  useKeypress((key) => {
    if (status !== "idle") return;
    if (isEnterKey(key)) {
      setStatus("done");
      done(value);
      return;
    }
    if (key.name === "left" || key.name === "h") {
      setValue(true);
    } else if (key.name === "right" || key.name === "l") {
      setValue(false);
    } else if (key.name === "tab") {
      setValue(!value);
    } else if (key.name === "y") {
      setValue(true);
      setStatus("done");
      done(true);
    } else if (key.name === "n") {
      setValue(false);
      setStatus("done");
      done(false);
    }
  });

  const message = theme.style.message(config.message, status);

  if (status === "done") {
    return `${prefix} ${message} ${theme.style.answer(value ? "Yes" : "No")}`;
  }

  const yes = value
    ? pc.bgCyan(pc.black(pc.bold(" Yes ")))
    : pc.dim(" Yes ");
  const no = !value
    ? pc.bgCyan(pc.black(pc.bold(" No ")))
    : pc.dim(" No ");
  const help = pc.dim("← →  toggle  ·  enter  confirm");

  // Append cursorHide to suppress the readline caret that Inquirer leaves
  // visible at end-of-line by default. This is a typeable-prompt behavior
  // that doesn't apply to a button toggle. Inquirer restores the cursor
  // automatically when the prompt resolves.
  return [`${prefix} ${message}  ${yes}  ${no}${cursorHide}`, help];
});

// Stitch the live confirm binding now that horizontalConfirm is in scope.
// activePrompts inherits from this on every resetPrompts() call.
LIVE_PROMPTS.confirm = horizontalConfirm;
activePrompts.confirm = horizontalConfirm;

export async function askConfirm({ message, defaultValue = true }) {
  return guard(() =>
    activePrompts.confirm({ message, default: defaultValue }),
  );
}

// Async task with a spinner + elapsed-time stamp. ora's `prefixText` puts
// the rail in front of every spinner frame so the task feels stitched into
// the same vertical flow as our other content.
//
// We force `stream: process.stdout` because ora defaults to stderr — our
// rail content goes to stdout, and mixing streams lets the cursor drift
// (the rail bar appears to vanish on the spinner row even though it was
// written, because the two streams flush independently).
//
// Magenta echoes the clack aesthetic users remember from elsewhere; on
// completion we hand off to stopAndPersist with the same green ✓ used by
// preflight and the success screen, so the whole CLI speaks one glyph
// vocabulary instead of mixing ora's defaults with ours.
export async function task(label, fn) {
  const spinner = ora({
    text: label,
    spinner: "dots",
    color: "magenta",
    stream: process.stdout,
    prefixText: RAIL_PREFIX,
  }).start();
  const start = Date.now();
  try {
    const result = await fn();
    const elapsed = Math.round((Date.now() - start) / 1000);
    spinner.stopAndPersist({
      symbol: pc.green("✓"),
      text: `${label} ${pc.dim(`(${elapsed}s)`)}`,
    });
    return result;
  } catch (err) {
    spinner.stopAndPersist({
      symbol: pc.red("✗"),
      text: label,
    });
    throw err;
  }
}

// Status-line writers. Each emits a single rail-prefixed line so the flow
// reads as one column of content.
export const log = {
  message: (text) => rail.line(text),
  info: (text) => rail.line(pc.blue("ℹ") + " " + text),
  success: (text) => rail.line(pc.green("✓") + " " + text),
  warn: (text) => rail.line(pc.yellow("⚠") + " " + text),
  error: (text) => rail.line(pc.red("✗") + " " + text),
};

// A titled section. Title in bold, content indented by two, all under the
// rail. One stdout.write so nothing later can erase part of it.
export function section(title, body) {
  const lines = ["", pc.bold(title), ""];
  for (const line of body.split("\n")) {
    lines.push("  " + line);
  }
  lines.push("");
  rail.block(lines.join("\n"));
}
