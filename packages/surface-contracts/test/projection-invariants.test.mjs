// Tests for the internal round-trip validation in the projection helpers
// (Phase 2e). Each helper parses its constructed output through the paired
// Zod schema and throws ProjectionInvariantError on failure, so a helper bug
// fires at the call site instead of letting an invalid payload reach
// ActivityKit, WidgetKit, or APNs where the failure mode is silent
// placeholder rendering.
//
// This file proves:
//   1. ProjectionInvariantError is exported and shaped correctly.
//   2. Every one of the six helpers throws ProjectionInvariantError when its
//      constructed output would not parse (C6: previously only
//      toLiveActivityContentState was exercised on the negative path).
//   3. toControlValueProvider omits absent optionals rather than emitting null
//      (C1).
//   4. The projected notification sidecar category is deliberately z.string(),
//      not the registry enum (C5).

import test from "node:test";
import assert from "node:assert/strict";
import {
  ProjectionInvariantError,
  surfaceFixtureSnapshots,
  assertSnapshot,
  liveSurfaceNotificationContentEntry,
  toLiveActivityContentState,
  toWidgetTimelineEntry,
  toControlValueProvider,
  toLockAccessoryEntry,
  toStandbyEntry,
  toNotificationContentPayload,
} from "../src/index.ts";

// First committed fixture of a given kind.
function fixtureOfKind(kind) {
  const found = Object.values(surfaceFixtureSnapshots).find(
    (s) => s.kind === kind,
  );
  assert.ok(found, `no committed fixture of kind "${kind}"`);
  return found;
}

test("ProjectionInvariantError is exported and carries helper name and issues", () => {
  const err = new ProjectionInvariantError("toX", [
    { code: "custom", path: ["foo"], message: "expected something" },
  ]);
  assert.equal(err.name, "ProjectionInvariantError");
  assert.equal(err.helper, "toX");
  assert.equal(err.issues.length, 1);
  assert.ok(err instanceof Error);
  assert.match(err.message, /toX/);
  assert.match(err.message, /foo: expected something/);
});

test("happy path: a real fixture projects without throwing", () => {
  assert.doesNotThrow(() =>
    toLiveActivityContentState(fixtureOfKind("liveActivity")),
  );
});

// C6: every helper's ensureProjection gate must fire, not just one. Each case
// corrupts a slice field in a way the *input* type tolerates (bypassed with an
// `any` cast) but the paired *output* schema rejects, so the helper builds bad
// output and ensureProjection throws. Before this, only toLiveActivityContentState
// was exercised on the negative path; a drift bug in any other helper's output
// construction would have gone uncaught.
const negativeCases = [
  {
    helper: "toLiveActivityContentState",
    fn: toLiveActivityContentState,
    kind: "liveActivity",
    corrupt: (s) => ({
      ...s,
      liveActivity: { ...s.liveActivity, progress: 99 },
    }),
    field: /progress/,
  },
  {
    helper: "toWidgetTimelineEntry",
    fn: toWidgetTimelineEntry,
    kind: "widget",
    corrupt: (s) => ({ ...s, widget: { ...s.widget, progress: 99 } }),
    field: /progress/,
  },
  {
    helper: "toControlValueProvider",
    fn: toControlValueProvider,
    kind: "control",
    corrupt: (s) => ({ ...s, control: { ...s.control, label: "" } }),
    field: /label/,
  },
  {
    helper: "toLockAccessoryEntry",
    fn: toLockAccessoryEntry,
    kind: "lockAccessory",
    corrupt: (s) => ({
      ...s,
      lockAccessory: { ...s.lockAccessory, gaugeValue: 99 },
    }),
    field: /gaugeValue/,
  },
  {
    helper: "toStandbyEntry",
    fn: toStandbyEntry,
    kind: "standby",
    corrupt: (s) => ({ ...s, standby: { ...s.standby, progress: 99 } }),
    field: /progress/,
  },
  {
    helper: "toNotificationContentPayload",
    fn: toNotificationContentPayload,
    kind: "notification",
    corrupt: (s) => ({
      ...s,
      notification: { ...s.notification, relevanceScore: 99 },
    }),
    field: /relevance-score/,
  },
];

for (const { helper, fn, kind, corrupt, field } of negativeCases) {
  test(`${helper} throws ProjectionInvariantError on invalid constructed output`, () => {
    const broken = corrupt(fixtureOfKind(kind));
    assert.throws(
      () => fn(/** @type {any} */ (broken)),
      (err) => {
        assert.ok(
          err instanceof ProjectionInvariantError,
          `expected ProjectionInvariantError, got ${err?.constructor?.name}`,
        );
        assert.equal(err.helper, helper);
        assert.match(err.message, field);
        return true;
      },
    );
  });
}

// C1: a button-kind control has no toggle state. The projection must omit the
// `value` (and `intent`) key entirely rather than emit null, so a consumer can
// tell "toggle is off" (value: false) from "not a toggle" (no value).
test("toControlValueProvider omits value and intent for a button-kind control", () => {
  const control = fixtureOfKind("control");
  const button = assertSnapshot({
    ...control,
    id: "fixture-control-button",
    surfaceId: "surface-control-button",
    control: {
      label: control.control.label,
      deepLink: control.control.deepLink,
      controlKind: "button",
    },
  });
  const entry = toControlValueProvider(button);
  assert.equal(entry.controlKind, "button");
  assert.equal("value" in entry, false);
  assert.equal("intent" in entry, false);
});

test("toControlValueProvider keeps value and intent for a toggle-kind control", () => {
  const control = fixtureOfKind("control");
  const toggle = assertSnapshot({
    ...control,
    id: "fixture-control-toggle",
    surfaceId: "surface-control-toggle",
    control: {
      label: control.control.label,
      deepLink: control.control.deepLink,
      controlKind: "toggle",
      state: false,
      intent: "toggleSurface",
    },
  });
  const entry = toControlValueProvider(toggle);
  assert.equal(entry.value, false);
  assert.equal(entry.intent, "toggleSurface");
});

// C5: the input notification slice constrains `category` to the
// NOTIFICATION_CATEGORY_IDS registry; the projection *output* sidecar schema
// deliberately does not. The output schema's job is to catch helper bugs, not
// to re-validate an input that already passed the registry gate. If this test
// starts failing, the output schema was tightened to the enum: a deliberate
// change that should update the schema comment on
// liveSurfaceNotificationContentEntry and this test together.
test("the projected notification sidecar category is z.string(), not the registry enum", () => {
  const sidecar = toNotificationContentPayload(
    fixtureOfKind("notification"),
  ).liveSurface;
  const result = liveSurfaceNotificationContentEntry.safeParse({
    ...sidecar,
    category: "not-a-registered-category",
  });
  assert.equal(result.success, true);
});
