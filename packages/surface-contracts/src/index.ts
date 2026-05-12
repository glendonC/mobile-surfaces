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
  liveSurfaceLockAccessoryFamily,
  liveSurfaceLockAccessorySlice,
  liveSurfaceStandbyPresentation,
  liveSurfaceStandbySlice,
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
  LiveSurfaceLockAccessoryFamily,
  LiveSurfaceLockAccessorySlice,
  LiveSurfaceStandbyPresentation,
  LiveSurfaceStandbySlice,
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
  LiveSurfaceSnapshotLockAccessory,
  LiveSurfaceSnapshotStandby,
  LiveSurfaceKind,
  LiveSurfaceWidgetSlice,
  LiveSurfaceLockAccessoryFamily,
  LiveSurfaceStandbyPresentation,
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

export interface LiveSurfaceLockAccessoryEntry {
  kind: "lockAccessory";
  snapshotId: string;
  surfaceId: string;
  state: LiveSurfaceSnapshot["state"];
  family: LiveSurfaceLockAccessoryFamily;
  headline: string;
  shortText: string;
  gaugeValue: number;
  deepLink: string;
}

export interface LiveSurfaceStandbyEntry {
  kind: "standby";
  snapshotId: string;
  surfaceId: string;
  state: LiveSurfaceSnapshot["state"];
  presentation: LiveSurfaceStandbyPresentation;
  tint: "default" | "monochrome" | null;
  headline: string;
  subhead: string;
  progress: number;
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

/**
 * Thrown when a projection helper receives a snapshot that parses against the
 * schema but is missing a field the target wire format requires. The schema
 * accepts the input (so producers see no Zod error), but the projection would
 * otherwise emit a silently-broken downstream payload.
 */
export class IncompleteProjectionError extends Error {
  readonly projection: string;
  readonly field: string;
  constructor(projection: string, field: string, detail: string) {
    super(`${projection}: ${detail} (missing: ${field})`);
    this.name = "IncompleteProjectionError";
    this.projection = projection;
    this.field = field;
  }
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
  // `actionLabel` is optional and `z.string().optional()` accepts the empty
  // string, but `??` only triggers on null/undefined. An empty actionLabel
  // would silently produce an empty button label downstream, so coerce
  // empty-string to "absent" before falling back to primaryText.
  const labelCandidate = controlSnap.actionLabel?.length
    ? controlSnap.actionLabel
    : controlSnap.primaryText;
  if (!labelCandidate) {
    throw new IncompleteProjectionError(
      "toControlValueProvider",
      "actionLabel or primaryText",
      "control snapshots must supply a non-empty actionLabel or primaryText to drive the control widget label.",
    );
  }
  return {
    kind: "control",
    snapshotId: controlSnap.id,
    surfaceId: controlSnap.surfaceId,
    controlKind: control.kind,
    value: control.state ?? null,
    intent: control.intent ?? null,
    label: labelCandidate,
    deepLink: controlSnap.deepLink,
  };
}

export function toLockAccessoryEntry(
  snapshot: LiveSurfaceSnapshot,
): LiveSurfaceLockAccessoryEntry {
  const accessory: LiveSurfaceSnapshotLockAccessory = assertSnapshotKind(
    snapshot,
    "lockAccessory",
  );
  // shortText is the constrained-length label families like accessoryInline
  // and accessoryRectangular render. Coerce empty string to "absent" so the
  // primaryText fallback fires (same pattern as toControlValueProvider).
  const shortTextCandidate = accessory.lockAccessory.shortText?.length
    ? accessory.lockAccessory.shortText
    : accessory.primaryText;
  // gaugeValue drives the circular ring and rectangular progress fill. Falls
  // back to the snapshot's overall `progress` so callers don't have to repeat
  // themselves when the gauge mirrors progress.
  const gaugeValue = accessory.lockAccessory.gaugeValue ?? accessory.progress;
  return {
    kind: "lockAccessory",
    snapshotId: accessory.id,
    surfaceId: accessory.surfaceId,
    state: accessory.state,
    family: accessory.lockAccessory.family,
    headline: accessory.primaryText,
    shortText: shortTextCandidate,
    gaugeValue,
    deepLink: accessory.deepLink,
  };
}

export function toStandbyEntry(
  snapshot: LiveSurfaceSnapshot,
): LiveSurfaceStandbyEntry {
  const standbySnap: LiveSurfaceSnapshotStandby = assertSnapshotKind(
    snapshot,
    "standby",
  );
  return {
    kind: "standby",
    snapshotId: standbySnap.id,
    surfaceId: standbySnap.surfaceId,
    state: standbySnap.state,
    presentation: standbySnap.standby.presentation,
    tint: standbySnap.standby.tint ?? null,
    headline: standbySnap.primaryText,
    subhead: standbySnap.secondaryText,
    progress: standbySnap.progress,
    deepLink: standbySnap.deepLink,
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
