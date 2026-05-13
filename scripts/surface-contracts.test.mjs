import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSnapshot,
  IncompleteProjectionError,
  liveSurfaceActivityContentState,
  liveSurfaceControlValueProvider,
  liveSurfaceLockAccessoryEntry,
  liveSurfaceNotificationContentPayload,
  liveSurfaceSnapshot,
  liveSurfaceSnapshotV1,
  liveSurfaceStandbyEntry,
  liveSurfaceWidgetTimelineEntry,
  migrateV1ToV2,
  safeParseAnyVersion,
  safeParseSnapshot,
  surfaceFixtureSnapshots,
  toControlValueProvider,
  toLiveActivityContentState,
  toLockAccessoryEntry,
  toNotificationContentPayload,
  toStandbyEntry,
  toWidgetTimelineEntry,
} from "../packages/surface-contracts/src/index.ts";

const queued = surfaceFixtureSnapshots.queued;

// `queued` is a liveActivity-kind snapshot. Tests that build a different
// kind by spreading queued need to strip the liveActivity slice first; v2's
// strict per-kind objects reject unknown sibling slices.
function withoutLiveActivity(snapshot) {
  const { liveActivity: _drop, ...rest } = snapshot;
  return rest;
}

test("live activity fixtures project to ActivityKit content state", () => {
  assert.equal(queued.kind, "liveActivity");
  assert.deepEqual(toLiveActivityContentState(queued), {
    headline: queued.primaryText,
    subhead: queued.secondaryText,
    progress: queued.progress,
    stage: queued.liveActivity.stage,
  });
});

test("live activity projections reject non-live snapshots", () => {
  const widget = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-widget",
    kind: "widget",
    widget: { family: "systemSmall" },
  });

  assert.throws(() => toLiveActivityContentState(widget), /Cannot project widget/);
});

test("widget projection accepts widget snapshots and rejects mismatches", () => {
  const widget = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-widget",
    surfaceId: "surface-widget",
    kind: "widget",
    widget: { family: "systemMedium", reloadPolicy: "manual" },
  });

  assert.deepEqual(toWidgetTimelineEntry(widget), {
    kind: "widget",
    snapshotId: "fixture-widget",
    surfaceId: "surface-widget",
    state: "queued",
    family: "systemMedium",
    reloadPolicy: "manual",
    headline: queued.primaryText,
    subhead: queued.secondaryText,
    progress: queued.progress,
    deepLink: queued.deepLink,
  });
  assert.throws(() => toWidgetTimelineEntry(queued), /Cannot project liveActivity/);
});

test("control projection accepts control snapshots and rejects mismatches", () => {
  const control = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-control",
    surfaceId: "surface-control",
    kind: "control",
    control: { kind: "toggle", state: true, intent: "toggleSurface" },
  });

  assert.deepEqual(toControlValueProvider(control), {
    kind: "control",
    snapshotId: "fixture-control",
    surfaceId: "surface-control",
    controlKind: "toggle",
    value: true,
    intent: "toggleSurface",
    label: queued.actionLabel,
    deepLink: queued.deepLink,
  });
  assert.throws(() => toControlValueProvider(queued), /Cannot project liveActivity/);
});

test("notification projection accepts notification snapshots and rejects mismatches", () => {
  const notification = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-notification",
    surfaceId: "surface-notification",
    kind: "notification",
    notification: { category: "surface-update", threadId: "surface-thread" },
  });

  assert.deepEqual(toNotificationContentPayload(notification), {
    aps: {
      alert: {
        title: queued.primaryText,
        body: queued.secondaryText,
      },
      sound: "default",
      category: "surface-update",
      "thread-id": "surface-thread",
    },
    liveSurface: {
      kind: "surface_notification",
      snapshotId: "fixture-notification",
      surfaceId: "surface-notification",
      state: "queued",
      deepLink: queued.deepLink,
    },
  });
  assert.throws(() => toNotificationContentPayload(queued), /Cannot project liveActivity/);
});

// ---------------------------------------------------------------------------
// Discriminated-union enforcement (Round 1A)
// ---------------------------------------------------------------------------

test("kind/slice mismatch is rejected: control kind without control slice fails safeParse", () => {
  const result = liveSurfaceSnapshot.safeParse({
    ...withoutLiveActivity(queued),
    id: "fixture-control-missing-slice",
    kind: "control",
  });
  assert.equal(result.success, false);
});

test("kind/slice mismatch is rejected: widget kind without widget slice fails safeParse", () => {
  const result = liveSurfaceSnapshot.safeParse({
    ...withoutLiveActivity(queued),
    id: "fixture-widget-missing-slice",
    kind: "widget",
  });
  assert.equal(result.success, false);
});

test("kind/slice mismatch is rejected: notification kind without notification slice fails safeParse", () => {
  const result = liveSurfaceSnapshot.safeParse({
    ...withoutLiveActivity(queued),
    id: "fixture-notification-missing-slice",
    kind: "notification",
  });
  assert.equal(result.success, false);
});

test("kind/slice mismatch is rejected: liveActivity kind with widget slice attached fails safeParse", () => {
  const result = liveSurfaceSnapshot.safeParse({
    ...queued,
    id: "fixture-live-with-widget",
    kind: "liveActivity",
    widget: { family: "systemSmall" },
  });
  assert.equal(result.success, false);
});

test("kind/slice mismatch is rejected: liveActivity kind without liveActivity slice fails safeParse", () => {
  const result = liveSurfaceSnapshot.safeParse({
    ...withoutLiveActivity(queued),
    id: "fixture-live-missing-slice",
    kind: "liveActivity",
  });
  assert.equal(result.success, false);
});

test("v2 requires kind: payload without kind fails safeParse (no preprocess fallback)", () => {
  const { kind: _omit, ...withoutKind } = queued;
  const result = safeParseSnapshot(withoutKind);
  // v2 dropped the v1 missing-kind preprocess. Producers must set kind
  // explicitly; the v1->v2 codec sets it during migration. Bare snapshots
  // without kind are no longer valid.
  assert.equal(result.success, false);
});

test("kind/slice mismatch is rejected: lockAccessory kind without lockAccessory slice fails safeParse", () => {
  const result = liveSurfaceSnapshot.safeParse({
    ...withoutLiveActivity(queued),
    id: "fixture-lock-missing-slice",
    kind: "lockAccessory",
  });
  assert.equal(result.success, false);
});

test("kind/slice mismatch is rejected: standby kind without standby slice fails safeParse", () => {
  const result = liveSurfaceSnapshot.safeParse({
    ...withoutLiveActivity(queued),
    id: "fixture-standby-missing-slice",
    kind: "standby",
  });
  assert.equal(result.success, false);
});

test("lockAccessory projection accepts lockAccessory snapshots and rejects mismatches", () => {
  const accessory = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-lock-accessory",
    surfaceId: "surface-lock-accessory",
    kind: "lockAccessory",
    progress: 0.42,
    lockAccessory: {
      family: "accessoryCircular",
      gaugeValue: 0.8,
      shortText: "80%",
    },
  });

  assert.deepEqual(toLockAccessoryEntry(accessory), {
    kind: "lockAccessory",
    snapshotId: "fixture-lock-accessory",
    surfaceId: "surface-lock-accessory",
    state: "queued",
    family: "accessoryCircular",
    headline: queued.primaryText,
    shortText: "80%",
    gaugeValue: 0.8,
    deepLink: queued.deepLink,
  });
  assert.throws(() => toLockAccessoryEntry(queued), /Cannot project liveActivity/);
});

test("toLockAccessoryEntry falls back to progress when gaugeValue is absent", () => {
  const accessory = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-lock-fallback",
    kind: "lockAccessory",
    progress: 0.33,
    lockAccessory: { family: "accessoryRectangular" },
  });

  assert.equal(toLockAccessoryEntry(accessory).gaugeValue, 0.33);
});

test("toLockAccessoryEntry falls back to primaryText when shortText is empty or absent", () => {
  const empty = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-lock-empty",
    kind: "lockAccessory",
    lockAccessory: { family: "accessoryInline", shortText: "" },
  });
  const absent = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-lock-absent",
    kind: "lockAccessory",
    lockAccessory: { family: "accessoryInline" },
  });
  assert.equal(toLockAccessoryEntry(empty).shortText, queued.primaryText);
  assert.equal(toLockAccessoryEntry(absent).shortText, queued.primaryText);
});

test("standby projection accepts standby snapshots and rejects mismatches", () => {
  const standby = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-standby",
    surfaceId: "surface-standby",
    kind: "standby",
    standby: { presentation: "night", tint: "monochrome" },
  });

  assert.deepEqual(toStandbyEntry(standby), {
    kind: "standby",
    snapshotId: "fixture-standby",
    surfaceId: "surface-standby",
    state: "queued",
    presentation: "night",
    tint: "monochrome",
    headline: queued.primaryText,
    subhead: queued.secondaryText,
    progress: queued.progress,
    deepLink: queued.deepLink,
  });
  assert.throws(() => toStandbyEntry(queued), /Cannot project liveActivity/);
});

test("toStandbyEntry applies presentation default and null tint when absent", () => {
  const standby = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-standby-default",
    kind: "standby",
    standby: {},
  });
  const entry = toStandbyEntry(standby);
  assert.equal(entry.presentation, "card");
  assert.equal(entry.tint, null);
});

// ---------------------------------------------------------------------------
// v1 -> v2 migration codec
// ---------------------------------------------------------------------------

const v1LiveActivitySample = {
  schemaVersion: "1",
  kind: "liveActivity",
  id: "fixture-v1-live",
  surfaceId: "surface-v1-live",
  state: "active",
  modeLabel: "active",
  contextLabel: "progress",
  statusLine: "active",
  primaryText: "Surface",
  secondaryText: "v1 sample",
  actionLabel: "Open",
  estimatedSeconds: 120,
  morePartsCount: 1,
  progress: 0.4,
  stage: "inProgress",
  deepLink: "mobilesurfaces://surface/surface-v1-live",
  updatedAt: "2026-05-12T18:00:00.000Z",
};

const v1WidgetSample = {
  schemaVersion: "1",
  kind: "widget",
  id: "fixture-v1-widget",
  surfaceId: "surface-v1-widget",
  state: "active",
  modeLabel: "widget",
  contextLabel: "home",
  statusLine: "widget",
  primaryText: "Widget",
  secondaryText: "v1 sample",
  estimatedSeconds: 60,
  morePartsCount: 0,
  progress: 0.5,
  stage: "inProgress",
  deepLink: "mobilesurfaces://surface/surface-v1-widget",
  updatedAt: "2026-05-12T18:00:00.000Z",
  widget: { family: "systemMedium" },
};

test("migrateV1ToV2 packs liveActivity-only fields into the new slice", () => {
  const v1 = liveSurfaceSnapshotV1.parse(v1LiveActivitySample);
  const v2 = migrateV1ToV2(v1);
  assert.equal(v2.schemaVersion, "2");
  assert.equal(v2.kind, "liveActivity");
  assert.ok("liveActivity" in v2);
  if (v2.kind === "liveActivity") {
    assert.equal(v2.liveActivity.stage, "inProgress");
    assert.equal(v2.liveActivity.estimatedSeconds, 120);
    assert.equal(v2.liveActivity.morePartsCount, 1);
  }
  // The three liveActivity-only fields are not on the base anymore.
  assert.equal("stage" in v2, false);
  assert.equal("estimatedSeconds" in v2, false);
  assert.equal("morePartsCount" in v2, false);
  // Round-trip through v2 parse to prove the migration result is valid.
  const reparsed = liveSurfaceSnapshot.parse(v2);
  assert.equal(reparsed.schemaVersion, "2");
});

test("migrateV1ToV2 drops liveActivity-only fields for non-liveActivity kinds", () => {
  const v1 = liveSurfaceSnapshotV1.parse(v1WidgetSample);
  const v2 = migrateV1ToV2(v1);
  assert.equal(v2.schemaVersion, "2");
  assert.equal(v2.kind, "widget");
  assert.equal("stage" in v2, false);
  assert.equal("estimatedSeconds" in v2, false);
  assert.equal("morePartsCount" in v2, false);
  assert.equal("liveActivity" in v2, false);
  // widget slice survives the migration.
  if (v2.kind === "widget") {
    assert.equal(v2.widget.family, "systemMedium");
  }
});

test("migrateV1ToV2 leaves updatedAt undefined when v1 omitted it (default-fail behavior)", () => {
  const { updatedAt: _omit, ...withoutUpdatedAt } = v1LiveActivitySample;
  const v1 = liveSurfaceSnapshotV1.parse(withoutUpdatedAt);
  const v2Like = migrateV1ToV2(v1);
  // The migrate result is not yet a valid v2 snapshot — v2 requires
  // updatedAt. Default behavior leaves it undefined so v2 parse fails
  // loudly rather than synthesizing a "now" lie.
  assert.equal(v2Like.schemaVersion, "2");
  assert.equal(v2Like.updatedAt, undefined);
  const result = liveSurfaceSnapshot.safeParse(v2Like);
  assert.equal(result.success, false);
});

test("migrateV1ToV2 honors updatedAtFallback when v1 omitted updatedAt", () => {
  const { updatedAt: _omit, ...withoutUpdatedAt } = v1LiveActivitySample;
  const v1 = liveSurfaceSnapshotV1.parse(withoutUpdatedAt);
  const v2 = migrateV1ToV2(v1, {
    updatedAtFallback: "2026-05-12T18:30:00.000Z",
  });
  assert.equal(v2.updatedAt, "2026-05-12T18:30:00.000Z");
  // With the fallback in place, the result parses as a valid v2 snapshot.
  const reparsed = liveSurfaceSnapshot.parse(v2);
  assert.equal(reparsed.updatedAt, "2026-05-12T18:30:00.000Z");
});

// ---------------------------------------------------------------------------
// safeParseAnyVersion: v2 (strict) -> v1 (codec) -> v0 (legacy, removed in 4.0)
// ---------------------------------------------------------------------------

test("safeParseAnyVersion accepts a v2 payload with no deprecation warning", () => {
  const result = safeParseAnyVersion(queued);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.kind, "liveActivity");
    assert.equal(result.data.schemaVersion, "2");
    assert.equal(result.deprecationWarning, undefined);
  }
});

test("safeParseAnyVersion accepts a v1 payload and surfaces a v1 deprecation warning", () => {
  const result = safeParseAnyVersion(v1LiveActivitySample);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.schemaVersion, "2");
    assert.equal(result.data.kind, "liveActivity");
    assert.match(
      result.deprecationWarning ?? "",
      /v1 is deprecated/i,
    );
  }
});

test("safeParseAnyVersion fails with v2 error when no version parses", () => {
  const result = safeParseAnyVersion({ schemaVersion: "999", nonsense: true });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error);
  }
});

test("strict assertSnapshot does NOT auto-migrate v1 payloads", () => {
  assert.throws(() => assertSnapshot(v1LiveActivitySample));
});

// ---------------------------------------------------------------------------
// Deep-link regex edge cases
// ---------------------------------------------------------------------------

const deepLinkPositiveCases = [
  "mobilesurfaces://foo",
  "https://example.com/path",
  "custom-scheme://x",
  "h+t.p://opaque",
];

for (const link of deepLinkPositiveCases) {
  test(`deepLink accepts ${JSON.stringify(link)}`, () => {
    const result = safeParseSnapshot({ ...queued, deepLink: link });
    assert.equal(result.success, true);
  });
}

const deepLinkNegativeCases = [
  "not-a-uri",
  "://missing-scheme",
  "1starts-with-digit://x",
  "",
  "MOBILESURFACES://upper-scheme",
  " https://leading-space",
];

for (const link of deepLinkNegativeCases) {
  test(`deepLink rejects ${JSON.stringify(link)}`, () => {
    const result = safeParseSnapshot({ ...queued, deepLink: link });
    assert.equal(result.success, false);
  });
}

// ---------------------------------------------------------------------------
// liveActivity.morePartsCount boundaries (z.int().min(0) inside the slice)
// ---------------------------------------------------------------------------

function withLiveActivity(overrides) {
  return {
    ...queued,
    liveActivity: { ...queued.liveActivity, ...overrides },
  };
}

test("morePartsCount accepts 0", () => {
  const result = safeParseSnapshot(withLiveActivity({ morePartsCount: 0 }));
  assert.equal(result.success, true);
});

test("morePartsCount accepts 1", () => {
  const result = safeParseSnapshot(withLiveActivity({ morePartsCount: 1 }));
  assert.equal(result.success, true);
});

test("morePartsCount accepts large integers", () => {
  const result = safeParseSnapshot(
    withLiveActivity({ morePartsCount: 1_000_000 }),
  );
  assert.equal(result.success, true);
});

test("morePartsCount rejects negative integers", () => {
  const result = safeParseSnapshot(withLiveActivity({ morePartsCount: -1 }));
  assert.equal(result.success, false);
});

test("morePartsCount rejects non-integer numbers", () => {
  const result = safeParseSnapshot(withLiveActivity({ morePartsCount: 1.5 }));
  assert.equal(result.success, false);
});

test("morePartsCount rejects NaN", () => {
  const result = safeParseSnapshot(
    withLiveActivity({ morePartsCount: Number.NaN }),
  );
  assert.equal(result.success, false);
});

test("morePartsCount rejects string-encoded integers", () => {
  const result = safeParseSnapshot(withLiveActivity({ morePartsCount: "3" }));
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// updatedAt (required in v2)
// ---------------------------------------------------------------------------

test("updatedAt is required in v2: payloads without it fail safeParse", () => {
  const { updatedAt: _omit, ...withoutUpdatedAt } = queued;
  const result = safeParseSnapshot(withoutUpdatedAt);
  assert.equal(result.success, false);
});

test("updatedAt accepts an RFC 3339 / ISO 8601 datetime string", () => {
  const snapshot = assertSnapshot({
    ...queued,
    updatedAt: "2026-05-12T18:32:11.482Z",
  });
  assert.equal(snapshot.updatedAt, "2026-05-12T18:32:11.482Z");
});

test("updatedAt accepts an RFC 3339 datetime with a non-UTC offset", () => {
  const snapshot = assertSnapshot({
    ...queued,
    updatedAt: "2026-05-12T11:32:11.482-07:00",
  });
  assert.equal(snapshot.updatedAt, "2026-05-12T11:32:11.482-07:00");
});

test("updatedAt rejects a plain date string (no time component)", () => {
  const result = safeParseSnapshot({ ...queued, updatedAt: "2026-05-12" });
  assert.equal(result.success, false);
});

test("updatedAt rejects a unix-epoch number masquerading as a string", () => {
  const result = safeParseSnapshot({ ...queued, updatedAt: "1747076400" });
  assert.equal(result.success, false);
});

test("updatedAt rejects a non-string value", () => {
  const result = safeParseSnapshot({ ...queued, updatedAt: 1747076400 });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Projection validation (Part 1 contracts)
// ---------------------------------------------------------------------------

test("toControlValueProvider falls back to primaryText when actionLabel is absent", () => {
  const control = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-control-no-action-label",
    surfaceId: "surface-control",
    actionLabel: undefined,
    kind: "control",
    control: { kind: "toggle", state: true, intent: "toggleSurface" },
  });
  const projected = toControlValueProvider(control);
  assert.equal(projected.label, queued.primaryText);
});

test("toControlValueProvider falls back to primaryText when actionLabel is empty string", () => {
  const control = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-control-empty-action-label",
    surfaceId: "surface-control",
    actionLabel: "",
    kind: "control",
    control: { kind: "button", intent: "openSurface" },
  });
  const projected = toControlValueProvider(control);
  // Empty-string actionLabel must NOT be passed through. The fix-site coerces
  // empty-string to "absent" so primaryText (which is .min(1) in the schema)
  // wins. This pins the silent-empty-label bug closed.
  assert.equal(projected.label, queued.primaryText);
  assert.notEqual(projected.label, "");
});

test("IncompleteProjectionError class is exported and named correctly", () => {
  const err = new IncompleteProjectionError("toX", "fieldY", "detail");
  assert.equal(err.name, "IncompleteProjectionError");
  assert.equal(err.projection, "toX");
  assert.equal(err.field, "fieldY");
  assert.match(err.message, /toX/);
  assert.match(err.message, /fieldY/);
  assert.ok(err instanceof Error);
});

test("toControlValueProvider preserves null when control.state and control.intent are absent", () => {
  const control = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-control-bare",
    surfaceId: "surface-control",
    kind: "control",
    control: { kind: "deepLink" },
  });
  const projected = toControlValueProvider(control);
  assert.equal(projected.value, null);
  assert.equal(projected.intent, null);
});

// ---------------------------------------------------------------------------
// Optional-field pass-through pins (decided NOT to throw)
// ---------------------------------------------------------------------------

test("toWidgetTimelineEntry passes through undefined family and reloadPolicy", () => {
  const widget = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-widget-bare",
    surfaceId: "surface-widget",
    kind: "widget",
    widget: {},
  });
  const projected = toWidgetTimelineEntry(widget);
  assert.equal(projected.family, undefined);
  assert.equal(projected.reloadPolicy, undefined);
  assert.equal(projected.headline, queued.primaryText);
});

test("toNotificationContentPayload omits category and threadId when absent", () => {
  const note = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-notification-bare",
    surfaceId: "surface-notification",
    kind: "notification",
    notification: {},
  });
  const projected = toNotificationContentPayload(note);
  assert.equal("category" in projected.aps, false);
  assert.equal("thread-id" in projected.aps, false);
  assert.equal(projected.aps.alert.title, queued.primaryText);
  assert.equal(projected.aps.alert.body, queued.secondaryText);
});

test("toNotificationContentPayload drops empty-string category and threadId", () => {
  const note = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-notification-empty-meta",
    surfaceId: "surface-notification",
    kind: "notification",
    notification: { category: "", threadId: "" },
  });
  const projected = toNotificationContentPayload(note);
  assert.equal("category" in projected.aps, false);
  assert.equal("thread-id" in projected.aps, false);
});

test("toLiveActivityContentState accepts empty secondaryText (schema permits empty string)", () => {
  const live = assertSnapshot({
    ...queued,
    id: "fixture-live-empty-secondary",
    secondaryText: "",
  });
  const projected = toLiveActivityContentState(live);
  assert.equal(projected.subhead, "");
  assert.equal(projected.headline, queued.primaryText);
});

// --- Projection output-schema drift tests --------------------------------

// Each helper has both a runtime helper and a Zod output schema. If a helper
// edit silently widens the returned shape (or a fixture edit pushes the
// helper down an untyped branch), the schema parse fails here — closing the
// gap between "TypeScript says it works" and "the wire format actually
// validates."
const PROJECTION_BY_KIND = {
  liveActivity: {
    project: toLiveActivityContentState,
    schema: liveSurfaceActivityContentState,
  },
  widget: {
    project: toWidgetTimelineEntry,
    schema: liveSurfaceWidgetTimelineEntry,
  },
  control: {
    project: toControlValueProvider,
    schema: liveSurfaceControlValueProvider,
  },
  lockAccessory: {
    project: toLockAccessoryEntry,
    schema: liveSurfaceLockAccessoryEntry,
  },
  standby: {
    project: toStandbyEntry,
    schema: liveSurfaceStandbyEntry,
  },
  notification: {
    project: toNotificationContentPayload,
    schema: liveSurfaceNotificationContentPayload,
  },
};

test("every fixture projects to a payload that parses via its output schema", () => {
  for (const [name, snapshot] of Object.entries(surfaceFixtureSnapshots)) {
    const handler = PROJECTION_BY_KIND[snapshot.kind];
    assert.ok(handler, `fixture "${name}" has unknown kind ${snapshot.kind}`);
    const projected = handler.project(snapshot);
    const result = handler.schema.safeParse(projected);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      assert.fail(
        `Fixture "${name}" (kind=${snapshot.kind}) projected output fails its schema: ${issues}`,
      );
    }
    // Parsed result should be structurally identical to the helper output.
    // .strict() schemas mean any helper-introduced excess key would have
    // already failed safeParse; deepEqual here pins the value-level shape.
    assert.deepEqual(result.data, projected, `kind=${snapshot.kind} fixture=${name}`);
  }
});

test("output schemas reject helper drift: widget entry without snapshotId", () => {
  // Negative case to ensure the schemas would actually catch drift if a helper
  // started omitting a required field. Constructed by hand rather than
  // patching the helper — patching the helper would also break the positive
  // test above and leave us with two failing tests for one issue.
  const widget = surfaceFixtureSnapshots["widget-large-onsite"] ??
    surfaceFixtureSnapshots["widget-small"] ??
    Object.values(surfaceFixtureSnapshots).find((s) => s.kind === "widget");
  const projected = toWidgetTimelineEntry(widget);
  const { snapshotId: _drop, ...drifted } = projected;
  const result = liveSurfaceWidgetTimelineEntry.safeParse(drifted);
  assert.equal(result.success, false);
});

test("output schemas reject extra fields a helper might accidentally introduce", () => {
  const standby = Object.values(surfaceFixtureSnapshots).find((s) => s.kind === "standby");
  assert.ok(standby, "expected at least one standby fixture");
  const projected = toStandbyEntry(standby);
  const inflated = { ...projected, extraField: "drifted in" };
  const result = liveSurfaceStandbyEntry.safeParse(inflated);
  assert.equal(result.success, false, "strict schema must reject excess keys");
});

test("liveSurfaceSnapshot exposes a Standard Schema (~standard) interface", () => {
  const std = liveSurfaceSnapshot["~standard"];
  assert.ok(std, "Zod 4 should expose ~standard on every schema");
  assert.equal(std.vendor, "zod");
  assert.equal(std.version, 1);
  assert.equal(typeof std.validate, "function");

  // Validate a known-good fixture through the Standard Schema interface.
  const result = std.validate(queued);
  // Standard Schema returns { value } on success, { issues } on failure.
  assert.ok("value" in result, "expected success result with `value`");
  assert.equal(result.value.kind, "liveActivity");

  // And it rejects malformed payloads through the same interface.
  const bad = std.validate({ ...queued, kind: "control" });
  assert.ok(
    "issues" in bad && Array.isArray(bad.issues) && bad.issues.length > 0,
    "expected failure result with `issues`",
  );
});
