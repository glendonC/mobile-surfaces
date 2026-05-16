import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  assertSnapshot,
  assertSnapshotKind,
  liveSurfaceActivityContentState,
  liveSurfaceControlValueProvider,
  liveSurfaceLockAccessoryEntry,
  liveSurfaceNotificationContentPayload,
  liveSurfaceNotificationSliceForExtension,
  liveSurfaceSnapshot,
  liveSurfaceSnapshotV4,
  liveSurfaceStandbyEntry,
  liveSurfaceWidgetTimelineEntry,
  migrateV4ToV5,
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

// `queued` is a liveActivity-kind snapshot. Tests that build a different kind
// by spreading queued must strip the liveActivity slice first; the strict
// per-kind objects reject unknown sibling slices.
function withoutLiveActivity(snapshot) {
  const { liveActivity: _drop, ...rest } = snapshot;
  return rest;
}

// In v4 every kind carries its own rendering inside its slice; widgets,
// controls, lock accessories, standby, and notifications no longer share
// base-shape fields with liveActivity. Helper to author a non-liveActivity
// fixture from `queued` quickly.
function widgetSnapshot(overrides = {}) {
  return assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-widget",
    surfaceId: "surface-widget",
    kind: "widget",
    widget: {
      title: queued.liveActivity.title,
      body: queued.liveActivity.body,
      progress: queued.liveActivity.progress,
      deepLink: queued.liveActivity.deepLink,
      family: "systemMedium",
      reloadPolicy: "manual",
      ...overrides,
    },
  });
}

test("live activity fixtures project to ActivityKit content state", () => {
  assert.equal(queued.kind, "liveActivity");
  assert.deepEqual(toLiveActivityContentState(queued), {
    headline: queued.liveActivity.title,
    subhead: queued.liveActivity.body,
    progress: queued.liveActivity.progress,
    stage: queued.liveActivity.stage,
  });
});

test("assertSnapshotKind throws when narrowing the wrong kind", () => {
  const widget = widgetSnapshot();
  assert.throws(
    () => assertSnapshotKind(widget, "liveActivity"),
    /Cannot project widget snapshot as liveActivity/,
  );
});

test("widget projection reads from the widget slice", () => {
  const widget = widgetSnapshot();
  assert.deepEqual(toWidgetTimelineEntry(widget), {
    schemaVersion: "5",
    kind: "widget",
    snapshotId: "fixture-widget",
    surfaceId: "surface-widget",
    state: "queued",
    family: "systemMedium",
    reloadPolicy: "manual",
    headline: queued.liveActivity.title,
    subhead: queued.liveActivity.body,
    progress: queued.liveActivity.progress,
    deepLink: queued.liveActivity.deepLink,
  });
});

test("control projection reads label and deepLink from the control slice", () => {
  const control = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-control",
    surfaceId: "surface-control",
    kind: "control",
    control: {
      label: "Surface toggle",
      deepLink: queued.liveActivity.deepLink,
      controlKind: "toggle",
      state: true,
      intent: "toggleSurface",
    },
  });

  assert.deepEqual(toControlValueProvider(control), {
    schemaVersion: "5",
    kind: "control",
    snapshotId: "fixture-control",
    surfaceId: "surface-control",
    controlKind: "toggle",
    value: true,
    intent: "toggleSurface",
    label: "Surface toggle",
    deepLink: queued.liveActivity.deepLink,
  });
});

test("notification projection maps slice title/body to aps.alert", () => {
  const notification = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-notification",
    surfaceId: "surface-notification",
    kind: "notification",
    notification: {
      title: "Surface needs attention",
      body: "Open the app to review the surface state.",
      deepLink: queued.liveActivity.deepLink,
      category: "surface-update",
      threadId: "surface-thread",
    },
  });

  assert.deepEqual(toNotificationContentPayload(notification), {
    schemaVersion: "5",
    aps: {
      alert: {
        title: "Surface needs attention",
        body: "Open the app to review the surface state.",
      },
      sound: "default",
      category: "surface-update",
      "thread-id": "surface-thread",
    },
    liveSurface: {
      schemaVersion: "5",
      kind: "surface_snapshot",
      snapshotId: "fixture-notification",
      surfaceId: "surface-notification",
      state: "queued",
      deepLink: queued.liveActivity.deepLink,
      category: "surface-update",
    },
  });
});

// ---------------------------------------------------------------------------
// Discriminated-union enforcement
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

test("liveSurfaceNotificationSliceForExtension accepts a registry category and requires it", () => {
  // The producer-boundary refinement keeps the underlying enum constraint
  // from `liveSurfaceNotificationSlice` while flipping `category` from
  // optional to required. A payload naming a registry id parses; the same
  // payload with `category` omitted fails with a required-field issue.
  const ok = liveSurfaceNotificationSliceForExtension.safeParse({
    title: "Order update",
    body: "Driver is two minutes away.",
    deepLink: "myapp://orders/123",
    category: "surface-update",
  });
  assert.equal(ok.success, true);

  const missing = liveSurfaceNotificationSliceForExtension.safeParse({
    title: "Order update",
    body: "Driver is two minutes away.",
    deepLink: "myapp://orders/123",
  });
  assert.equal(missing.success, false);
});

test("liveSurfaceNotificationSliceForExtension rejects a category outside the registry (enum constraint preserved)", () => {
  // Regression for the .extend({ category: z.string().min(1) }) shape that
  // widened the type back to any non-empty string. The refinement now uses
  // .required({ category: true }) so the z.enum(NOTIFICATION_CATEGORY_IDS)
  // constraint from the base slice still applies at the producer boundary.
  const result = liveSurfaceNotificationSliceForExtension.safeParse({
    title: "Order update",
    body: "Driver is two minutes away.",
    deepLink: "myapp://orders/123",
    category: "not-in-registry",
  });
  assert.equal(result.success, false);
  const issuesText = JSON.stringify(result.error.issues);
  // The Zod enum issue carries either `code: "invalid_enum_value"` (Zod v3)
  // or `code: "invalid_value"` with `values: [...]` (Zod v4). Either form
  // proves the enum constraint fired rather than a min(1) string check.
  assert.match(issuesText, /invalid_enum_value|invalid_value|enum/);
});

test("kind/slice mismatch is rejected: liveActivity kind with widget slice attached fails safeParse", () => {
  const result = liveSurfaceSnapshot.safeParse({
    ...queued,
    id: "fixture-live-with-widget",
    kind: "liveActivity",
    widget: {
      title: "x",
      body: "",
      progress: 0,
      deepLink: "myapp://x",
    },
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

test("v5 requires kind: payload without kind fails safeParse (no preprocess fallback)", () => {
  const { kind: _omit, ...withoutKind } = queued;
  const result = safeParseSnapshot(withoutKind);
  assert.equal(result.success, false);
});

test("v5 requires schemaVersion: payload without schemaVersion fails safeParse (no default)", () => {
  const { schemaVersion: _omit, ...withoutVersion } = queued;
  const result = safeParseSnapshot(withoutVersion);
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

test("lockAccessory projection reads slice fields and propagates optional gauge/shortText", () => {
  const accessory = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-lock-accessory",
    surfaceId: "surface-lock-accessory",
    kind: "lockAccessory",
    lockAccessory: {
      title: "Surface 80%",
      deepLink: queued.liveActivity.deepLink,
      family: "accessoryCircular",
      gaugeValue: 0.8,
      shortText: "80%",
    },
  });

  assert.deepEqual(toLockAccessoryEntry(accessory), {
    schemaVersion: "5",
    kind: "lockAccessory",
    snapshotId: "fixture-lock-accessory",
    surfaceId: "surface-lock-accessory",
    state: "queued",
    family: "accessoryCircular",
    headline: "Surface 80%",
    shortText: "80%",
    gaugeValue: 0.8,
    deepLink: queued.liveActivity.deepLink,
  });
});

test("toLockAccessoryEntry omits gaugeValue and shortText when slice omits them", () => {
  const accessory = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-lock-bare",
    surfaceId: "surface-lock-bare",
    kind: "lockAccessory",
    lockAccessory: {
      title: "Surface",
      deepLink: queued.liveActivity.deepLink,
      family: "accessoryRectangular",
    },
  });
  const projected = toLockAccessoryEntry(accessory);
  assert.equal("gaugeValue" in projected, false);
  assert.equal("shortText" in projected, false);
  assert.equal(projected.headline, "Surface");
});

test("standby projection reads slice fields and applies presentation default", () => {
  const standby = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-standby",
    surfaceId: "surface-standby",
    kind: "standby",
    standby: {
      title: "Standby surface",
      body: "Mirrors the active surface.",
      progress: 0.4,
      deepLink: queued.liveActivity.deepLink,
      presentation: "night",
      tint: "monochrome",
    },
  });

  assert.deepEqual(toStandbyEntry(standby), {
    schemaVersion: "5",
    kind: "standby",
    snapshotId: "fixture-standby",
    surfaceId: "surface-standby",
    state: "queued",
    presentation: "night",
    tint: "monochrome",
    headline: "Standby surface",
    subhead: "Mirrors the active surface.",
    progress: 0.4,
    deepLink: queued.liveActivity.deepLink,
  });
});

test("toStandbyEntry defaults presentation to card and null-tints when absent", () => {
  const standby = assertSnapshot({
    ...withoutLiveActivity(queued),
    id: "fixture-standby-default",
    surfaceId: "surface-standby-default",
    kind: "standby",
    standby: {
      title: "Surface",
      body: "",
      progress: 0,
      deepLink: queued.liveActivity.deepLink,
    },
  });
  const entry = toStandbyEntry(standby);
  assert.equal(entry.presentation, "card");
  assert.equal(entry.tint, null);
});

// ---------------------------------------------------------------------------
// safeParseAnyVersion: v5 (strict) -> v4 (frozen codec, deprecated, removed
// in 9.0). The v3 codec was dropped at 8.0; consumers still emitting v3 must
// promote via @mobile-surfaces/surface-contracts@7.x once.
// ---------------------------------------------------------------------------

test("safeParseAnyVersion accepts a v5 payload with no deprecation warning", () => {
  const result = safeParseAnyVersion(queued);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.kind, "liveActivity");
    assert.equal(result.data.schemaVersion, "5");
    assert.equal(result.deprecationWarning, undefined);
  }
});

test("safeParseAnyVersion accepts a v4 payload and surfaces a v4 deprecation warning", () => {
  // Build a valid v4 snapshot by spreading a v5 fixture and downgrading the
  // schemaVersion literal. v4's wire shape is otherwise identical to v5 for
  // liveActivity-kind snapshots (the v5 additions live on the notification
  // slice), so this is a faithful v4 input.
  const v4Payload = { ...queued, schemaVersion: "4" };
  const result = safeParseAnyVersion(v4Payload);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.kind, "liveActivity");
    assert.equal(result.data.schemaVersion, "5");
    assert.match(result.deprecationWarning ?? "", /v4 is deprecated/i);
  }
});

test("safeParseAnyVersion fails when no version parses", () => {
  const result = safeParseAnyVersion({ schemaVersion: "999", nonsense: true });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error);
  }
});

test("safeParseAnyVersion rejects a v3-shaped payload (v3 codec retired at 8.0)", () => {
  const v3Shaped = {
    schemaVersion: "3",
    kind: "liveActivity",
    id: "fixture-v3-live",
    surfaceId: "surface-v3-live",
    updatedAt: "2026-05-12T18:00:00.000Z",
    state: "active",
    primaryText: "Surface in progress",
    secondaryText: "v3 body copy.",
    liveActivity: {
      stage: "inProgress",
      estimatedSeconds: 90,
      morePartsCount: 1,
    },
  };
  const result = safeParseAnyVersion(v3Shaped);
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Deep-link regex edge cases.
// ---------------------------------------------------------------------------

const deepLinkPositiveCases = [
  "mobilesurfaces://foo",
  "https://example.com/path",
  "custom-scheme://x",
  "h+t.p://opaque",
];

for (const link of deepLinkPositiveCases) {
  test(`deepLink accepts ${JSON.stringify(link)}`, () => {
    const result = safeParseSnapshot({
      ...queued,
      liveActivity: { ...queued.liveActivity, deepLink: link },
    });
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
    const result = safeParseSnapshot({
      ...queued,
      liveActivity: { ...queued.liveActivity, deepLink: link },
    });
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
// updatedAt (required since v2)
// ---------------------------------------------------------------------------

test("updatedAt is required: payloads without it fail safeParse", () => {
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
// .describe() propagation into the generated JSON Schema.
// ---------------------------------------------------------------------------

test("Zod .describe() strings propagate into the generated JSON Schema", () => {
  const json = z.toJSONSchema(liveSurfaceSnapshot, {
    target: "draft-2020-12",
  });
  // The base shape's schemaVersion description should ride into every
  // discriminated-union branch.
  const flat = JSON.stringify(json);
  assert.match(
    flat,
    /Wire-format generation\. Required; producers MUST set this explicitly\./,
  );
  // Per-kind slice rendering field description.
  assert.match(flat, /Lock-Screen \/ Dynamic-Island headline/);
  // Enum description on liveSurfaceState.
  assert.match(flat, /Lifecycle states\./);
});

// ---------------------------------------------------------------------------
// Round-trip: every fixture projects through its helper and parses against
// its output schema. This pins the helper ↔ projection-output schema link.
// ---------------------------------------------------------------------------

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
    assert.deepEqual(
      result.data,
      projected,
      `kind=${snapshot.kind} fixture=${name}`,
    );
  }
});

test("output schemas reject helper drift: widget entry without snapshotId", () => {
  const widget = surfaceFixtureSnapshots.widgetDashboard ??
    Object.values(surfaceFixtureSnapshots).find((s) => s.kind === "widget");
  assert.ok(widget, "expected at least one widget fixture");
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

  const result = std.validate(queued);
  assert.ok("value" in result, "expected success result with `value`");
  assert.equal(result.value.kind, "liveActivity");

  const bad = std.validate({ ...queued, kind: "control" });
  assert.ok(
    "issues" in bad && Array.isArray(bad.issues) && bad.issues.length > 0,
    "expected failure result with `issues`",
  );
});
