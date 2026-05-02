export {
  liveSurfaceSnapshot,
  liveSurfaceSnapshotLiveActivity,
  liveSurfaceSnapshotWidget,
  liveSurfaceSnapshotControl,
  liveSurfaceSnapshotNotification,
  liveSurfaceSnapshotLockAccessory,
  liveSurfaceSnapshotStandby,
  liveSurfaceSnapshotV0,
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
  migrateV0ToV1,
  safeParseAnyVersion,
} from "./schema.ts";
export type {
  LiveSurfaceSnapshot,
  LiveSurfaceSnapshotLiveActivity,
  LiveSurfaceSnapshotWidget,
  LiveSurfaceSnapshotControl,
  LiveSurfaceSnapshotNotification,
  LiveSurfaceSnapshotLockAccessory,
  LiveSurfaceSnapshotStandby,
  LiveSurfaceSnapshotV0,
  LiveSurfaceState,
  LiveSurfaceStage,
  LiveSurfaceKind,
  LiveSurfaceWidgetSlice,
  LiveSurfaceControlSlice,
  LiveSurfaceNotificationSlice,
  LiveSurfaceActivityContentState,
  LiveSurfaceAlertPayload,
  SafeParseAnyVersionResult,
  SafeParseAnyVersionSuccess,
  SafeParseAnyVersionFailure,
} from "./schema.ts";

import type {
  LiveSurfaceSnapshot,
  LiveSurfaceSnapshotWidget,
  LiveSurfaceSnapshotControl,
  LiveSurfaceSnapshotNotification,
  LiveSurfaceSnapshotLiveActivity,
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
  controlKind: LiveSurfaceSnapshotControl["control"]["kind"];
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
  const live: LiveSurfaceSnapshotLiveActivity = assertSnapshotKind(
    snapshot,
    "liveActivity",
  );
  return {
    headline: live.primaryText,
    subhead: live.secondaryText,
    progress: live.progress,
    stage: live.stage,
  };
}

export function toAlertPayload(snapshot: LiveSurfaceSnapshot): LiveSurfaceAlertPayload {
  const live: LiveSurfaceSnapshotLiveActivity = assertSnapshotKind(
    snapshot,
    "liveActivity",
  );
  return {
    aps: {
      alert: {
        title: live.primaryText,
        body: live.secondaryText,
      },
      sound: "default",
    },
    liveSurface: {
      kind: "surface_snapshot",
      snapshotId: live.id,
      surfaceId: live.surfaceId,
      state: live.state,
      deepLink: live.deepLink,
    },
  };
}

export function toWidgetTimelineEntry(
  snapshot: LiveSurfaceSnapshot,
): LiveSurfaceWidgetTimelineEntry {
  const widgetSnap: LiveSurfaceSnapshotWidget = assertSnapshotKind(
    snapshot,
    "widget",
  );
  return {
    kind: "widget",
    snapshotId: widgetSnap.id,
    surfaceId: widgetSnap.surfaceId,
    state: widgetSnap.state,
    family: widgetSnap.widget.family,
    reloadPolicy: widgetSnap.widget.reloadPolicy,
    headline: widgetSnap.primaryText,
    subhead: widgetSnap.secondaryText,
    progress: widgetSnap.progress,
    deepLink: widgetSnap.deepLink,
  };
}

export function toControlValueProvider(
  snapshot: LiveSurfaceSnapshot,
): LiveSurfaceControlValueProvider {
  const controlSnap: LiveSurfaceSnapshotControl = assertSnapshotKind(
    snapshot,
    "control",
  );
  const control = controlSnap.control;
  return {
    kind: "control",
    snapshotId: controlSnap.id,
    surfaceId: controlSnap.surfaceId,
    controlKind: control.kind,
    value: control.state ?? null,
    intent: control.intent ?? null,
    label: controlSnap.actionLabel ?? controlSnap.primaryText,
    deepLink: controlSnap.deepLink,
  };
}

export function toNotificationContentPayload(
  snapshot: LiveSurfaceSnapshot,
): LiveSurfaceNotificationContentPayload {
  const note: LiveSurfaceSnapshotNotification = assertSnapshotKind(
    snapshot,
    "notification",
  );
  return {
    aps: {
      alert: {
        title: note.primaryText,
        body: note.secondaryText,
      },
      sound: "default",
      ...(note.notification.category
        ? { category: note.notification.category }
        : {}),
      ...(note.notification.threadId
        ? { "thread-id": note.notification.threadId }
        : {}),
    },
    liveSurface: {
      kind: "surface_notification",
      snapshotId: note.id,
      surfaceId: note.surfaceId,
      state: note.state,
      deepLink: note.deepLink,
    },
  };
}

// Defense-in-depth runtime narrowing utility. The discriminated union now
// makes invalid-kind payloads unparseable up front, so this function should
// rarely throw — but we keep it so callers that receive an already-parsed
// LiveSurfaceSnapshot can narrow the union without re-validating.
type SnapshotByKind = {
  liveActivity: Extract<LiveSurfaceSnapshot, { kind: "liveActivity" }>;
  widget: Extract<LiveSurfaceSnapshot, { kind: "widget" }>;
  control: Extract<LiveSurfaceSnapshot, { kind: "control" }>;
  notification: Extract<LiveSurfaceSnapshot, { kind: "notification" }>;
  lockAccessory: Extract<LiveSurfaceSnapshot, { kind: "lockAccessory" }>;
  standby: Extract<LiveSurfaceSnapshot, { kind: "standby" }>;
};

export function assertSnapshotKind<K extends LiveSurfaceKind>(
  snapshot: LiveSurfaceSnapshot,
  expected: K,
): SnapshotByKind[K] {
  if (snapshot.kind !== expected) {
    throw new Error(
      `Cannot project ${snapshot.kind} snapshot as ${expected}.`,
    );
  }
  return snapshot as SnapshotByKind[K];
}

export { surfaceFixtureSnapshots } from "./fixtures.ts";

export {
  trapSeverity,
  trapDetection,
  trapTag,
  trapEntry,
  trapCatalog,
} from "./traps.ts";
export type {
  TrapSeverity,
  TrapDetection,
  TrapTag,
  TrapEntry,
  TrapCatalog,
} from "./traps.ts";

export { traps, findTrap, findTrapByErrorClass } from "./traps-data.ts";

export {
  diagnosticCheckStatus,
  diagnosticReportStatus,
  diagnosticIssue,
  diagnosticDetail,
  diagnosticCheck,
  diagnosticReport,
  diagnosticEnvironment,
  diagnosticConfig,
  diagnosticBundle,
  rollupDiagnosticStatus,
} from "./diagnostics.ts";
export type {
  DiagnosticCheckStatus,
  DiagnosticReportStatus,
  DiagnosticIssue,
  DiagnosticDetail,
  DiagnosticCheck,
  DiagnosticReport,
  DiagnosticEnvironment,
  DiagnosticConfig,
  DiagnosticBundle,
} from "./diagnostics.ts";
