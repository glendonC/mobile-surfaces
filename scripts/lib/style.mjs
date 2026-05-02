// Minimal ANSI styling for interactive scripts. No external deps — pulls
// from process.stdout.isTTY to gracefully degrade when output is piped or
// captured. Keeps the diagnose-bundle discipline (zero dependencies for
// repo-level scripts) while still letting the setup wizard look like
// something a human read carefully, not a config dump.
//
// Hyperlinks use the OSC 8 escape sequence supported by Terminal.app,
// iTerm2, VS Code Terminal, Warp, and Hyper. Terminals that don't grok
// OSC 8 will see the label and ignore the wrapper bytes (no trailing
// garbage).

const SUPPORTS_COLOR =
  process.stdout.isTTY &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb";

function wrap(open, close) {
  return (s) => (SUPPORTS_COLOR ? `\x1b[${open}m${s}\x1b[${close}m` : `${s}`);
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const italic = wrap(3, 23);
export const underline = wrap(4, 24);

export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);

/**
 * OSC 8 hyperlink. Renders as a clickable link in modern terminals; falls
 * back to "label (url)" when colors are disabled so the URL is still
 * visible when piped.
 */
export function hyperlink(label, url) {
  if (!SUPPORTS_COLOR) return `${label} (${url})`;
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
}

/**
 * Horizontal rule sized to the terminal width (capped at 64). Uses ─ on
 * supported terminals, ASCII fallback otherwise.
 */
export function rule(char = "─") {
  const width = Math.min(64, process.stdout.columns ?? 64);
  return char.repeat(width);
}

/** Small banner — title flanked by separator lines. */
export function banner(title) {
  return [dim(rule()), bold(title), dim(rule())].join("\n");
}
