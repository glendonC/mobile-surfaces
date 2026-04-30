export {
  liveSurfaceSnapshot,
  liveSurfaceState,
  liveSurfaceStage,
  liveSurfaceKind,
  liveSurfaceWidgetSlice,
  liveSurfaceControlSlice,
  liveSurfaceNotificationSlice,
  liveSurfaceActivityContentState,
  liveSurfaceAlertPayload,
  liveSurfaceStates,
  liveSurfaceStages,
  liveSurfaceKinds,
  assertSnapshot,
  safeParseSnapshot,
} from "./schema.ts";
export type {
  LiveSurfaceSnapshot,
  LiveSurfaceState,
  LiveSurfaceStage,
  LiveSurfaceKind,
  LiveSurfaceWidgetSlice,
  LiveSurfaceControlSlice,
  LiveSurfaceNotificationSlice,
  LiveSurfaceActivityContentState,
  LiveSurfaceAlertPayload,
} from "./schema.ts";

import type {
  LiveSurfaceSnapshot,
  LiveSurfaceKind,
  LiveSurfaceWidgetSlice,
  LiveSurfaceActivityContentState,
  LiveSurfaceAlertPayload,
} from "./schema.ts";

export interface LiveSurfaceWidgetTimelineEntry {
  kind: "widget";
  snapshotId: string;
  surfaceId: string;
  state: LiveSurfaceSnapshot["state"];
  family: LiveSurfaceWidgetSlice["family"];
  reloadPolicy: LiveSurfaceWidgetSlice["reloadPolicy"];
  headline: string;
  subhead: string;
  progress: number;
  deepLink: string;
}

export interface LiveSurfaceControlValueProvider {
  kind: "control";
  snapshotId: string;
  surfaceId: string;
  controlKind: NonNullable<LiveSurfaceSnapshot["control"]>["kind"];
  value: boolean | null;
  intent: string | null;
  label: string;
  deepLink: string;
}

export interface LiveSurfaceNotificationContentPayload {
  aps: {
    alert: {
      title: string;
      body: string;
    };
    sound?: "default";
    category?: string;
    "thread-id"?: string;
  };
  liveSurface: {
    kind: "surface_notification";
    snapshotId: string;
    surfaceId: string;
    state: LiveSurfaceSnapshot["state"];
    deepLink: string;
  };
}

export function toLiveActivityContentState(
  snapshot: LiveSurfaceSnapshot,
): LiveSurfaceActivityContentState {
  assertSnapshotKind(snapshot, "liveActivity");
  return {
    headline: snapshot.primaryText,
    subhead: snapshot.secondaryText,
    progress: snapshot.progress,
    stage: snapshot.stage,
  };
}

export function toAlertPayload(snapshot: LiveSurfaceSnapshot): LiveSurfaceAlertPayload {
  assertSnapshotKind(snapshot, "liveActivity");
  return {
    aps: {
      alert: {
        title: snapshot.primaryText,
        body: snapshot.secondaryText,
      },
      sound: "default",
    },
    liveSurface: {
      kind: "surface_snapshot",
      snapshotId: snapshot.id,
      surfaceId: snapshot.surfaceId,
      state: snapshot.state,
      deepLink: snapshot.deepLink,
    },
  };
}

export function toWidgetTimelineEntry(
  snapshot: LiveSurfaceSnapshot,
): LiveSurfaceWidgetTimelineEntry {
  assertSnapshotKind(snapshot, "widget");
  return {
    kind: "widget",
    snapshotId: snapshot.id,
    surfaceId: snapshot.surfaceId,
    state: snapshot.state,
    family: snapshot.widget?.family,
    reloadPolicy: snapshot.widget?.reloadPolicy,
    headline: snapshot.primaryText,
    subhead: snapshot.secondaryText,
    progress: snapshot.progress,
    deepLink: snapshot.deepLink,
  };
}

export function toControlValueProvider(
  snapshot: LiveSurfaceSnapshot,
): LiveSurfaceControlValueProvider {
  assertSnapshotKind(snapshot, "control");
  const control = snapshot.control;
  if (!control) {
    throw new Error('Cannot project control snapshot without a "control" slice.');
  }
  return {
    kind: "control",
    snapshotId: snapshot.id,
    surfaceId: snapshot.surfaceId,
    controlKind: control.kind,
    value: control.state ?? null,
    intent: control.intent ?? null,
    label: snapshot.actionLabel ?? snapshot.primaryText,
    deepLink: snapshot.deepLink,
  };
}

export function toNotificationContentPayload(
  snapshot: LiveSurfaceSnapshot,
): LiveSurfaceNotificationContentPayload {
  assertSnapshotKind(snapshot, "notification");
  return {
    aps: {
      alert: {
        title: snapshot.primaryText,
        body: snapshot.secondaryText,
      },
      sound: "default",
      ...(snapshot.notification?.category
        ? { category: snapshot.notification.category }
        : {}),
      ...(snapshot.notification?.threadId
        ? { "thread-id": snapshot.notification.threadId }
        : {}),
    },
    liveSurface: {
      kind: "surface_notification",
      snapshotId: snapshot.id,
      surfaceId: snapshot.surfaceId,
      state: snapshot.state,
      deepLink: snapshot.deepLink,
    },
  };
}

function assertSnapshotKind(
  snapshot: LiveSurfaceSnapshot,
  expected: LiveSurfaceKind,
): void {
  if (snapshot.kind !== expected) {
    throw new Error(
      `Cannot project ${snapshot.kind} snapshot as ${expected}.`,
    );
  }
}

export { surfaceFixtureSnapshots } from "./fixtures.ts";
