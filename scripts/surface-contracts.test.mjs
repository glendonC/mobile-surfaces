import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSnapshot,
  surfaceFixtureSnapshots,
  toAlertPayload,
  toControlValueProvider,
  toLiveActivityContentState,
  toNotificationContentPayload,
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

test("control projection accepts control snapshots and requires a control slice", () => {
  const control = assertSnapshot({
    ...queued,
    id: "fixture-control",
    surfaceId: "surface-control",
    kind: "control",
    control: { kind: "toggle", state: true, intent: "toggleSurface" },
  });
  const missingSlice = assertSnapshot({
    ...queued,
    id: "fixture-control-missing-slice",
    kind: "control",
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
  assert.throws(() => toControlValueProvider(missingSlice), /without a "control" slice/);
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
