// Zod-version-pin regression test for the shared Zod -> Swift type resolver
// in scripts/lib/swift-content-state.mjs.
//
// resolveExpectedSwiftType reads a schema's definition through the public
// `schema.def` accessor (Zod 4) rather than the internal `_zod` core
// namespace. `def` still exposes implementation-shaped fields (`type`,
// `innerType`, `format`, `entries`, `values`), so a future Zod bump that
// reshapes any of them would silently break the surface-snapshot and
// ActivityKit codegen. Zod is exact-pinned (4.3.6); this test fails loudly if
// that pin moves to a version where the resolver's assumptions no longer hold.
//
// It also pins ZodEnum's `.options` array, the public surface the isStageEnum
// helpers in generate-surface-swift.mjs and check-activity-attributes.mjs
// depend on.

import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { resolveExpectedSwiftType } from "./lib/swift-content-state.mjs";

test("resolver maps each scalar Zod type to its Swift counterpart", () => {
  assert.deepEqual(resolveExpectedSwiftType(z.string()), {
    expected: "String",
    reason: null,
  });
  assert.deepEqual(resolveExpectedSwiftType(z.boolean()), {
    expected: "Bool",
    reason: null,
  });
  assert.deepEqual(resolveExpectedSwiftType(z.number()), {
    expected: "Double",
    reason: null,
  });
});

test("resolver maps integer-format numbers to Swift Int", () => {
  assert.equal(resolveExpectedSwiftType(z.int()).expected, "Int");
});

test("resolver maps string enums and string literals to Swift String", () => {
  assert.equal(resolveExpectedSwiftType(z.enum(["a", "b"])).expected, "String");
  assert.equal(resolveExpectedSwiftType(z.literal("5")).expected, "String");
});

test("resolver maps optional and nullable to a Swift Optional", () => {
  assert.equal(resolveExpectedSwiftType(z.string().optional()).expected, "String?");
  assert.equal(resolveExpectedSwiftType(z.string().nullable()).expected, "String?");
  assert.equal(
    resolveExpectedSwiftType(z.number().min(0).max(1).optional()).expected,
    "Double?",
  );
});

test("resolver returns a typed reason for a shape it does not handle", () => {
  // An object schema is not a field shape the resolver recognizes; it must
  // surface a reason rather than throw or guess.
  const result = resolveExpectedSwiftType(z.object({ a: z.string() }));
  assert.equal(result.expected, null);
  assert.ok(typeof result.reason === "string" && result.reason.length > 0);
});

test("public Zod surface the resolver depends on is intact", () => {
  // schema.def is the public definition accessor; these are the fields the
  // resolver reads off it. If a Zod bump renames any of them, this fails
  // with a pointer to the resolver rather than a silent codegen miss.
  assert.equal(z.string().def.type, "string");
  assert.equal(z.boolean().def.type, "boolean");
  assert.equal(z.number().def.type, "number");
  assert.equal(z.string().optional().def.type, "optional");
  assert.equal(z.string().nullable().def.type, "nullable");
  assert.ok(z.string().optional().def.innerType, "optional.def.innerType");
  assert.equal(z.enum(["a"]).def.type, "enum");
  assert.ok(z.enum(["a", "b"]).def.entries, "enum.def.entries");
  assert.equal(z.literal("x").def.type, "literal");
  assert.ok(Array.isArray(z.literal("x").def.values), "literal.def.values");
});

test("ZodEnum exposes .options as a string array (isStageEnum helpers)", () => {
  const opts = z.enum(["prompted", "inProgress"]).options;
  assert.ok(Array.isArray(opts), "ZodEnum.options must be an array");
  for (const o of opts) assert.equal(typeof o, "string");
});
