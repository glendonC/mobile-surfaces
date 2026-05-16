export {
  liveSurfaceSnapshot,
  liveSurfaceSnapshotLiveActivity,
  liveSurfaceSnapshotWidget,
  liveSurfaceSnapshotControl,
  liveSurfaceSnapshotNotification,
  liveSurfaceSnapshotLockAccessory,
  liveSurfaceSnapshotStandby,
  liveSurfaceSnapshotV4,
  liveSurfaceLiveActivitySlice,
  liveSurfaceState,
  liveSurfaceStage,
  liveSurfaceKind,
  liveSurfaceInterruptionLevel,
  liveSurfaceWidgetSlice,
  liveSurfaceControlSlice,
  liveSurfaceNotificationSlice,
  liveSurfaceNotificationSliceForExtension,
  liveSurfaceLockAccessoryFamily,
  liveSurfaceLockAccessorySlice,
  liveSurfaceStandbyPresentation,
  liveSurfaceStandbySlice,
  liveSurfaceActivityContentState,
  liveSurfaceWidgetTimelineEntry,
  liveSurfaceControlValueProvider,
  liveSurfaceLockAccessoryEntry,
  liveSurfaceStandbyEntry,
  liveSurfaceNotificationContentEntry,
  liveSurfaceNotificationContentPayload,
  liveSurfaceStates,
  liveSurfaceStages,
  liveSurfaceKinds,
  assertSnapshot,
  safeParseSnapshot,
  migrateV4ToV5,
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
  LiveSurfaceSnapshotV4,
  LiveSurfaceLiveActivitySlice,
  LiveSurfaceState,
  LiveSurfaceStage,
  LiveSurfaceKind,
  LiveSurfaceInterruptionLevel,
  LiveSurfaceWidgetSlice,
  LiveSurfaceControlSlice,
  LiveSurfaceNotificationSlice,
  LiveSurfaceNotificationSliceForExtension,
  LiveSurfaceLockAccessoryFamily,
  LiveSurfaceLockAccessorySlice,
  LiveSurfaceStandbyPresentation,
  LiveSurfaceStandbySlice,
  LiveSurfaceActivityContentState,
  SafeParseAnyVersionResult,
  SafeParseAnyVersionSuccess,
  SafeParseAnyVersionFailure,
} from "./schema.ts";

// Public projection-output types are inferred from the Zod schemas in
// schema.ts. The hand-written shadow interfaces that previously lived here
// were deleted in v5 because they duplicated the Zod-inferred shape and
// drifted independently. The Output suffix is dropped from the public
// surface; the *Output identifier remains the convention inside schema.ts.
export type {
  LiveSurfaceWidgetTimelineEntryOutput as LiveSurfaceWidgetTimelineEntry,
  LiveSurfaceControlValueProviderOutput as LiveSurfaceControlValueProvider,
  LiveSurfaceLockAccessoryEntryOutput as LiveSurfaceLockAccessoryEntry,
  LiveSurfaceStandbyEntryOutput as LiveSurfaceStandbyEntry,
  LiveSurfaceNotificationContentEntryOutput as LiveSurfaceNotificationContentEntry,
  LiveSurfaceNotificationContentPayloadOutput as LiveSurfaceNotificationContentPayload,
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
  LiveSurfaceActivityContentState,
  LiveSurfaceWidgetTimelineEntryOutput,
  LiveSurfaceControlValueProviderOutput,
  LiveSurfaceLockAccessoryEntryOutput,
  LiveSurfaceStandbyEntryOutput,
  LiveSurfaceNotificationContentPayloadOutput,
} from "./schema.ts";

// Projection helpers take narrowed snapshot types, not the union. In v5 each
// kind has required slice fields (title.min(1), progress.min(0).max(1), etc.)
// so a snapshot that parses against e.g. liveSurfaceSnapshotWidget is
// guaranteed to carry every field its projection needs. The Zod parser is
// the gate; the projection cannot see an "incomplete" valid snapshot, so
// IncompleteProjectionError (previously exported here) was deleted.
//
// Callers holding a LiveSurfaceSnapshot (the union) narrow with
// snapshot.kind === "<kind>" before calling, or use assertSnapshotKind to
// turn a runtime check into a typed projection. assertSnapshotKind is kept
// for callers that have an already-parsed union value and want to skip
// re-validation.

export function toLiveActivityContentState(
  snapshot: LiveSurfaceSnapshotLiveActivity,
): LiveSurfaceActivityContentState {
  return {
    headline: snapshot.liveActivity.title,
    subhead: snapshot.liveActivity.body,
    progress: snapshot.liveActivity.progress,
    stage: snapshot.liveActivity.stage,
  };
}

export function toWidgetTimelineEntry(
  snapshot: LiveSurfaceSnapshotWidget,
): LiveSurfaceWidgetTimelineEntryOutput {
  return {
    schemaVersion: "5",
    kind: "widget",
    snapshotId: snapshot.id,
    surfaceId: snapshot.surfaceId,
    state: snapshot.state,
    family: snapshot.widget.family,
    reloadPolicy: snapshot.widget.reloadPolicy,
    headline: snapshot.widget.title,
    subhead: snapshot.widget.body,
    progress: snapshot.widget.progress,
    deepLink: snapshot.widget.deepLink,
  };
}

export function toControlValueProvider(
  snapshot: LiveSurfaceSnapshotControl,
): LiveSurfaceControlValueProviderOutput {
  const control = snapshot.control;
  return {
    schemaVersion: "5",
    kind: "control",
    snapshotId: snapshot.id,
    surfaceId: snapshot.surfaceId,
    controlKind: control.controlKind,
    value: control.state ?? null,
    intent: control.intent ?? null,
    label: control.label,
    deepLink: control.deepLink,
  };
}

export function toLockAccessoryEntry(
  snapshot: LiveSurfaceSnapshotLockAccessory,
): LiveSurfaceLockAccessoryEntryOutput {
  const accessory = snapshot.lockAccessory;
  return {
    schemaVersion: "5",
    kind: "lockAccessory",
    snapshotId: snapshot.id,
    surfaceId: snapshot.surfaceId,
    state: snapshot.state,
    family: accessory.family,
    headline: accessory.title,
    ...(accessory.shortText !== undefined
      ? { shortText: accessory.shortText }
      : {}),
    ...(accessory.gaugeValue !== undefined
      ? { gaugeValue: accessory.gaugeValue }
      : {}),
    deepLink: accessory.deepLink,
  };
}

export function toStandbyEntry(
  snapshot: LiveSurfaceSnapshotStandby,
): LiveSurfaceStandbyEntryOutput {
  return {
    schemaVersion: "5",
    kind: "standby",
    snapshotId: snapshot.id,
    surfaceId: snapshot.surfaceId,
    state: snapshot.state,
    presentation: snapshot.standby.presentation,
    tint: snapshot.standby.tint ?? null,
    headline: snapshot.standby.title,
    subhead: snapshot.standby.body,
    progress: snapshot.standby.progress,
    deepLink: snapshot.standby.deepLink,
  };
}

export function toNotificationContentPayload(
  snapshot: LiveSurfaceSnapshotNotification,
): LiveSurfaceNotificationContentPayloadOutput {
  const note = snapshot.notification;
  return {
    schemaVersion: "5",
    aps: {
      alert: {
        title: note.title,
        ...(note.subtitle ? { subtitle: note.subtitle } : {}),
        body: note.body,
      },
      sound: "default",
      ...(note.category ? { category: note.category } : {}),
      ...(note.threadId ? { "thread-id": note.threadId } : {}),
      ...(note.interruptionLevel
        ? { "interruption-level": note.interruptionLevel }
        : {}),
      ...(note.relevanceScore !== undefined
        ? { "relevance-score": note.relevanceScore }
        : {}),
      ...(note.targetContentId
        ? { "target-content-id": note.targetContentId }
        : {}),
    },
    liveSurface: {
      schemaVersion: "5",
      kind: "surface_snapshot",
      snapshotId: snapshot.id,
      surfaceId: snapshot.surfaceId,
      state: snapshot.state,
      deepLink: note.deepLink,
      ...(note.category ? { category: note.category } : {}),
    },
  };
}

// Defense-in-depth runtime narrowing utility. The discriminated union makes
// invalid-kind payloads unparseable up front, so this rarely throws — but we
// keep it so callers that hold a LiveSurfaceSnapshot (the union) can narrow
// without re-validating.
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
      `Cannot project ${snapshot.kind} snapshot as ${expected}. Use ` +
        `safeParseSnapshot to widen back to the union, or narrow with ` +
        `snapshot.kind === "${expected}" before calling.`,
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

// Traps catalog runtime helpers are now sourced from @mobile-surfaces/traps
// (the single home for the catalog, error base, and Swift bindings as of
// v7). surface-contracts re-exports the lookups so existing consumers
// (the harness, TrapErrorCard, SetupStatusRow) keep their imports
// working. The legacy `traps: readonly TrapEntry[]` array (a typed
// catalog snapshot generated from the full Zod entry shape) is dropped:
// the new package ships a TrapBinding map keyed by id, which is the
// shape every consumer actually used. Reach for `TRAP_BINDINGS` from
// `@mobile-surfaces/traps` if you need the full iterable.
export { findTrap, findTrapByErrorClass } from "@mobile-surfaces/traps";

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

export {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_IDS,
  notificationCategoryId,
  notificationCategoryAction,
  notificationCategory,
  notificationCategoryRegistry,
} from "./notificationCategories.ts";
export type {
  NotificationCategoryId,
  NotificationCategoryAction,
  NotificationCategory,
  NotificationCategoryRegistry,
} from "./notificationCategories.ts";
