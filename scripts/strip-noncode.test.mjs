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

test("empty input returns empty", () => {
  assert.equal(stripNonCode(""), "");
});
