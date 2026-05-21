// Tests for scripts/lib/strip-noncode.mjs. Run with:
//   node --experimental-strip-types --no-warnings=ExperimentalWarning \
//     --test scripts/strip-noncode.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { stripNonCode } from "./lib/strip-noncode.mjs";

// Every transformation must preserve byte length and newline positions so
// offsets and line numbers map back to the original source.
function assertShapePreserved(src) {
  const out = stripNonCode(src);
  assert.equal(out.length, src.length, "length must be preserved");
  const srcLines = src.split("\n").map((l) => l.length);
  const outLines = out.split("\n").map((l) => l.length);
  assert.deepEqual(outLines, srcLines, "every newline must stay at its offset");
  return out;
}

test("blanks a marker that appears only inside a line comment", () => {
  const out = assertShapePreserved("// liveSurfaceActivityContentState.safeParse(x)\nrun();");
  assert.ok(!out.includes("safeParse"), "commented-out call must not survive");
  assert.ok(out.includes("run()"), "live code must survive");
});

test("blanks a marker inside a block comment", () => {
  const out = assertShapePreserved("/* will be removed in 9.0.0 */\nconst x = 1;");
  assert.ok(!out.includes("removed"), "block-comment prose must not survive");
  assert.ok(out.includes("const x = 1"), "live code must survive");
});

test("blanks string-literal contents but keeps surrounding code", () => {
  const out = assertShapePreserved('const s = "throw new InvalidContentStateError(here)"; keep();');
  assert.ok(!out.includes("InvalidContentStateError"), "string content must not survive");
  assert.ok(out.includes("keep()"), "live code must survive");
});

test("keeps template-literal interpolation expressions live", () => {
  const out = assertShapePreserved("`prefix ${ safeParse(y) } suffix`;");
  assert.ok(out.includes("safeParse(y)"), "code inside ${} is live and must survive");
  assert.ok(!out.includes("prefix"), "template text must not survive");
  assert.ok(!out.includes("suffix"), "template text must not survive");
});

test("does not mistake a quote inside a regex literal for a string", () => {
  const out = assertShapePreserved("const re = /[\"']/; afterRegex();");
  assert.ok(out.includes("afterRegex()"), "code after a regex must survive intact");
  assert.ok(out.includes("const re ="), "code before a regex must survive intact");
});

test("does not mistake division for a regex", () => {
  const out = assertShapePreserved("const ratio = total / count / 2;");
  assert.equal(out, "const ratio = total / count / 2;", "division must pass through unchanged");
});

test("a slash inside a string is not a regex delimiter", () => {
  const out = assertShapePreserved('const path = "a/b/c"; next();');
  assert.ok(out.includes("next()"), "code after a slash-bearing string must survive");
});

test("handles nested ${} interpolation without desync", () => {
  const src = "`a ${ inner(`b ${ deep() } c`) } d`; tail();";
  const out = assertShapePreserved(src);
  assert.ok(out.includes("inner("), "outer interpolation code is live");
  assert.ok(out.includes("deep()"), "nested interpolation code is live");
  assert.ok(out.includes("tail()"), "code after the template is live");
});

test("a regex after a keyword is not mistaken for division", () => {
  // `return /.../ ` is a regex, not `return` divided by something. If the
  // scanner read it as division it would scan the regex body as code; a
  // quote or backtick in that body would then desync string tracking and
  // blank live code further down. The marker after it must survive.
  const out = assertShapePreserved("function f(s) { return /[\"'`]/.test(s); }\nconst real = safeParse(x);");
  assert.ok(out.includes("safeParse(x)"), "code after a keyword-preceded regex must survive");
  assert.ok(out.includes("return"), "the keyword itself is live code");
});

test("division after a non-keyword identifier still parses as division", () => {
  const out = assertShapePreserved("const r = total / count; tail();");
  assert.equal(out, "const r = total / count; tail();", "division must pass through unchanged");
});

test("keepStrings mode keeps string contents but still blanks comments", () => {
  const out = assertShapePreserved(
    'const e = "onPushToken"; // addListener("onPushToken")\nrun();',
  );
  // default mode would blank the string; keepStrings keeps it.
  const kept = stripNonCode(
    'const e = "onPushToken"; // addListener("onPushToken")\nrun();',
    { keepStrings: true },
  );
  assert.ok(kept.includes('"onPushToken"'), "keepStrings preserves the string literal");
  assert.ok(!kept.includes("addListener"), "keepStrings still blanks the comment");
  assert.ok(kept.includes("run()"), "live code survives");
  // sanity: default mode blanks the string content
  assert.ok(!out.includes("onPushToken"), "default mode blanks string contents");
});

test("an unterminated string literal does not run away to end of file", () => {
  const out = assertShapePreserved('const s = "oops never closed\nlive();');
  assert.ok(out.includes("live()"), "code on the next line survives an unterminated string");
});

test("an unterminated regex literal does not run away to end of file", () => {
  const out = assertShapePreserved("const re = /never closed\nlive();");
  assert.ok(out.includes("live()"), "code on the next line survives an unterminated regex");
});

test("empty input returns empty", () => {
  assert.equal(stripNonCode(""), "");
});
