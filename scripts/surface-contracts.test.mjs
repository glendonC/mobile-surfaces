import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSnapshot,
  IncompleteProjectionError,
  liveSurfaceAlertPayload,
  liveSurfaceSnapshot,
  liveSurfaceSnapshotV0,
  migrateV0ToV1,
  safeParseAnyVersion,
  safeParseSnapshot,
  surfaceFixtureSnapshots,
  toAlertPayload,
  toControlValueProvider,
  toLiveActivityContentState,
  toLockAccessoryEntry,
  toNotificationContentPayload,
  toStandbyEntry,
  toWidgetTimelineEntry,
} from "../packages/surface-contracts/src/index.ts";

const queued = surfaceFixtureSnapshots.queued;

test("live activity fixtures project to ActivityKit content state", () => {
  assert.equal(queued.kind, "liveActivity");
  assert.deepEqual(toLiveActivityContentState(queued), {
    headline: queued.primaryText,
    subhead: queued.secondaryText,
    progress: queued.progress,
    stage: queued.stage,
  });
});

test("live activity projections reject non-live snapshots", () => {
  const widget = assertSnapshot({
    ...queued,
    id: "fixture-widget",
    kind: "widget",
    widget: { family: "systemSmall" },
  });

  assert.throws(() => toLiveActivityContentState(widget), /Cannot project widget/);
  assert.throws(() => toAlertPayload(widget), /Cannot project widget/);
});

// toAlertPayload constructs its return shape by hand. Round-trip through the
// liveSurfaceAlertPayload Zod schema so the two cannot drift: any field rename
// or type change in the schema breaks this assertion before it ships.
test("toAlertPayload output parses as liveSurfaceAlertPayload", () => {
  const payload = toAlertPayload(queued);
  const parsed = liveSurfaceAlertPayload.parse(payload);
  assert.deepEqual(parsed, payload);
});

test("widget projection accepts widget snapshots and rejects mismatches", () => {
  const widget = assertSnapshot({
    ...queued,
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
    ...queued,
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
    ...queued,
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
    ...queued,
    id: "fixture-control-missing-slice",
    kind: "control",
  });
  assert.equal(result.success, false);
});

test("kind/slice mismatch is rejected: widget kind without widget slice fails safeParse", () => {
  const result = liveSurfaceSnapshot.safeParse({
    ...queued,
    id: "fixture-widget-missing-slice",
    kind: "widget",
  });
  assert.equal(result.success, false);
});

test("kind/slice mismatch is rejected: notification kind without notification slice fails safeParse", () => {
  const result = liveSurfaceSnapshot.safeParse({
    ...queued,
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

test("missing kind defaults to liveActivity (preprocess preserves v1 forward-compat)", () => {
  const { kind: _omit, ...withoutKind } = queued;
  const result = safeParseSnapshot(withoutKind);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.kind, "liveActivity");
  }
});

test("kind/slice mismatch is rejected: lockAccessory kind without lockAccessory slice fails safeParse", () => {
  const result = liveSurfaceSnapshot.safeParse({
    ...queued,
    id: "fixture-lock-missing-slice",
    kind: "lockAccessory",
  });
  assert.equal(result.success, false);
});

test("kind/slice mismatch is rejected: standby kind without standby slice fails safeParse", () => {
  const result = liveSurfaceSnapshot.safeParse({
    ...queued,
    id: "fixture-standby-missing-slice",
    kind: "standby",
  });
  assert.equal(result.success, false);
});

test("lockAccessory projection accepts lockAccessory snapshots and rejects mismatches", () => {
  const accessory = assertSnapshot({
    ...queued,
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
    ...queued,
    id: "fixture-lock-fallback",
    kind: "lockAccessory",
    progress: 0.33,
    lockAccessory: { family: "accessoryRectangular" },
  });

  assert.equal(toLockAccessoryEntry(accessory).gaugeValue, 0.33);
});

test("toLockAccessoryEntry falls back to primaryText when shortText is empty or absent", () => {
  const empty = assertSnapshot({
    ...queued,
    id: "fixture-lock-empty",
    kind: "lockAccessory",
    lockAccessory: { family: "accessoryInline", shortText: "" },
  });
  const absent = assertSnapshot({
    ...queued,
    id: "fixture-lock-absent",
    kind: "lockAccessory",
    lockAccessory: { family: "accessoryInline" },
  });
  assert.equal(toLockAccessoryEntry(empty).shortText, queued.primaryText);
  assert.equal(toLockAccessoryEntry(absent).shortText, queued.primaryText);
});

test("standby projection accepts standby snapshots and rejects mismatches", () => {
  const standby = assertSnapshot({
    ...queued,
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
    ...queued,
    id: "fixture-standby-default",
    kind: "standby",
    standby: {},
  });
  const entry = toStandbyEntry(standby);
  assert.equal(entry.presentation, "card");
  assert.equal(entry.tint, null);
});

// ---------------------------------------------------------------------------
// v0 → v1 migration codec (Round 1A)
// ---------------------------------------------------------------------------

const v0Sample = {
  schemaVersion: "0",
  id: "fixture-v0",
  surfaceId: "surface-v0",
  state: "queued",
  modeLabel: "queued",
  contextLabel: "starter",
  statusLine: "queued · ready",
  primaryText: "Surface queued",
  secondaryText: "v0 sample payload",
  actionLabel: "Open",
  estimatedSeconds: 60,
  morePartsCount: 0,
  progress: 0,
  stage: "prompted",
  deepLink: "mobilesurfaces://surface/surface-v0",
};

test("liveSurfaceSnapshotV0 parses a v0 sample payload", () => {
  const parsed = liveSurfaceSnapshotV0.parse(v0Sample);
  assert.equal(parsed.schemaVersion, "0");
});

test("migrateV0ToV1 promotes a v0 payload to a v1 liveActivity snapshot", () => {
  const v0 = liveSurfaceSnapshotV0.parse(v0Sample);
  const v1 = migrateV0ToV1(v0);
  assert.equal(v1.schemaVersion, "1");
  assert.equal(v1.kind, "liveActivity");
  assert.equal(v1.id, v0Sample.id);
  assert.equal(v1.surfaceId, v0Sample.surfaceId);
  assert.equal(v1.state, v0Sample.state);
  assert.equal(v1.deepLink, v0Sample.deepLink);

  // Round-trip through the strict v1 parser to prove the migrated value is
  // a valid v1 snapshot.
  const reparsed = liveSurfaceSnapshot.parse(v1);
  assert.deepEqual(reparsed, v1);
});

test("safeParseAnyVersion accepts a v1 payload with no deprecation warning", () => {
  const result = safeParseAnyVersion(queued);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.kind, "liveActivity");
    assert.equal(result.deprecationWarning, undefined);
  }
});

test("safeParseAnyVersion accepts a v0 payload and surfaces a deprecation warning", () => {
  const result = safeParseAnyVersion(v0Sample);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.schemaVersion, "1");
    assert.equal(result.data.kind, "liveActivity");
    assert.match(
      result.deprecationWarning ?? "",
      /v0 is deprecated/i,
    );
  }
});

test("safeParseAnyVersion fails with v1 error when neither version parses", () => {
  const result = safeParseAnyVersion({ schemaVersion: "999", nonsense: true });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error);
  }
});

test("strict assertSnapshot does NOT auto-migrate v0 payloads", () => {
  assert.throws(() => assertSnapshot(v0Sample));
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
// morePartsCount boundaries (schema declares z.int().min(0))
// ---------------------------------------------------------------------------

test("morePartsCount accepts 0", () => {
  const result = safeParseSnapshot({ ...queued, morePartsCount: 0 });
  assert.equal(result.success, true);
});

test("morePartsCount accepts 1", () => {
  const result = safeParseSnapshot({ ...queued, morePartsCount: 1 });
  assert.equal(result.success, true);
});

test("morePartsCount accepts large integers", () => {
  const result = safeParseSnapshot({ ...queued, morePartsCount: 1_000_000 });
  assert.equal(result.success, true);
});

test("morePartsCount rejects negative integers", () => {
  const result = safeParseSnapshot({ ...queued, morePartsCount: -1 });
  assert.equal(result.success, false);
});

test("morePartsCount rejects non-integer numbers", () => {
  const result = safeParseSnapshot({ ...queued, morePartsCount: 1.5 });
  assert.equal(result.success, false);
});

test("morePartsCount rejects NaN", () => {
  const result = safeParseSnapshot({ ...queued, morePartsCount: Number.NaN });
  assert.equal(result.success, false);
});

test("morePartsCount rejects string-encoded integers", () => {
  const result = safeParseSnapshot({ ...queued, morePartsCount: "3" });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// updatedAt (optional v1, required in v2)
// ---------------------------------------------------------------------------

test("updatedAt is optional in v1 — snapshots without it still parse", () => {
  const { updatedAt: _omit, ...withoutUpdatedAt } = queued;
  const result = safeParseSnapshot(withoutUpdatedAt);
  assert.equal(result.success, true);
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
    ...queued,
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
    ...queued,
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
    ...queued,
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
    ...queued,
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
    ...queued,
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
    ...queued,
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
