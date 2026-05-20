// Tests for the internal round-trip validation in the projection helpers
// (Phase 2e). The helpers parse their constructed output through the paired
// Zod schema and throw ProjectionInvariantError on failure. The error fires
// at the call site rather than letting an invalid payload reach ActivityKit,
// WidgetKit, or APNs where the failure mode is silent placeholder rendering.
//
// The "happy path" round-trip (every fixture projects to a valid output)
// is already exercised by surface-contracts.test.mjs's 52-test suite. This
// file's job is to prove:
//   1. ProjectionInvariantError is exported and shaped correctly.
//   2. A helper whose constructed output would not parse throws the error
//      instead of returning the bad payload. Demonstrated by stubbing the
//      input slice with an extra field via a thin proxy; the helper's
//      .strict() output schema rejects unknown keys.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ProjectionInvariantError,
  surfaceFixtureSnapshots,
  toLiveActivityContentState,
} from "../src/index.ts";

test("ProjectionInvariantError is exported and carries helper name and issues", () => {
  const err = new ProjectionInvariantError("toX", [
    {
      code: "custom",
      path: ["foo"],
      message: "expected something",
    },
  ]);
  assert.equal(err.name, "ProjectionInvariantError");
  assert.equal(err.helper, "toX");
  assert.equal(err.issues.length, 1);
  assert.ok(err instanceof Error);
  assert.match(err.message, /toX/);
  assert.match(err.message, /foo: expected something/);
});

test("happy path: a real fixture projects without throwing", () => {
  const fixture = surfaceFixtureSnapshots.queued;
  assert.doesNotThrow(() => toLiveActivityContentState(fixture));
});

// Demonstrates that the round-trip validation actually fires when the
// constructed output is invalid. We can't easily force the helper to
// construct bad output (the input is validated; the helper is a pure
// mapping), so we exercise the gate by mutating the input snapshot in a
// way that the input type tolerates but the output schema would reject.
//
// The progress field on liveSurfaceLiveActivitySlice is z.number().min(0).max(1).
// Bypassing the Zod input gate with `as unknown as` and a value outside
// [0, 1] reaches the helper, which constructs an output with the same bad
// progress, which fails the output's .min(0).max(1) constraint, which
// throws ProjectionInvariantError.
test("invalid construction throws ProjectionInvariantError, not a silent payload", () => {
  const fixture = surfaceFixtureSnapshots.queued;
  const broken = {
    ...fixture,
    liveActivity: {
      ...fixture.liveActivity,
      progress: 99, // outside [0, 1]
    },
  };
  assert.throws(
    () => toLiveActivityContentState(/** @type {any} */ (broken)),
    (err) => {
      assert.ok(
        err instanceof ProjectionInvariantError,
        `expected ProjectionInvariantError, got ${err?.constructor?.name}`,
      );
      assert.equal(err.helper, "toLiveActivityContentState");
      assert.match(err.message, /progress/);
      return true;
    },
  );
});
