export {
  liveSurfaceSnapshot,
  liveSurfaceSnapshotLiveActivity,
  liveSurfaceSnapshotWidget,
  liveSurfaceSnapshotControl,
  liveSurfaceSnapshotNotification,
  liveSurfaceSnapshotLockAccessory,
  liveSurfaceSnapshotStandby,
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
} from "./schema.ts";
export type {
  LiveSurfaceSnapshot,
  LiveSurfaceSnapshotLiveActivity,
  LiveSurfaceSnapshotWidget,
  LiveSurfaceSnapshotControl,
  LiveSurfaceSnapshotNotification,
  LiveSurfaceSnapshotLockAccessory,
  LiveSurfaceSnapshotStandby,
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

import {
  liveSurfaceActivityContentState,
  liveSurfaceWidgetTimelineEntry,
  liveSurfaceControlValueProvider,
  liveSurfaceLockAccessoryEntry,
  liveSurfaceStandbyEntry,
  liveSurfaceNotificationContentPayload,
} from "./schema.ts";
import { SCHEMA_VERSION } from "./version.ts";
import type { ZodIssue, ZodType } from "zod";

/**
 * Thrown when a projection helper's output fails to parse against its paired
 * Zod schema. The input snapshot has already been validated by the Zod gate
 * before reaching the helper, so this error indicates a bug in the helper
 * itself (a renamed field, a missing literal, a forgotten optional flag),
 * not bad caller input.
 *
 * The error fires at the call site rather than letting an invalid payload
 * reach ActivityKit, WidgetKit, or APNs where the failure mode is silent
 * placeholder rendering. Catch this in production only if you have a
 * deliberate fallback story for an unreachable bug; the right fix is almost
 * always to update the helper.
 */
export class ProjectionInvariantError extends Error {
  readonly helper: string;
  readonly issues: ZodIssue[];
  constructor(helper: string, issues: ZodIssue[]) {
    const summary = issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    super(
      `Projection helper ${helper} produced output that does not parse against its paired schema. This is a bug in the helper itself. Issues: ${summary}`,
    );
    this.name = "ProjectionInvariantError";
    this.helper = helper;
    this.issues = issues;
  }
}

// Defense-in-depth wrapper: run the helper's constructed output through the
// paired Zod schema before returning. If a future edit to the helper drops a
// field, renames it, or forgets the schemaVersion literal, the error fires
// at the call site instead of corrupting the wire.
//
// Cost: one Zod parse per projection call. Live Activity update rates are
// low enough (single-digit per second per activity) that the overhead is
// negligible. Hot-path consumers concerned about microbenchmarks can hold
// onto the input snapshot and project it once instead of repeatedly.
function ensureProjection<T>(
  helper: string,
  schema: ZodType<T>,
  candidate: unknown,
): T {
  const result = schema.safeParse(candidate);
  if (!result.success) {
    throw new ProjectionInvariantError(helper, result.error.issues);
  }
  return result.data;
}

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
  return ensureProjection(
    "toLiveActivityContentState",
    liveSurfaceActivityContentState,
    {
      headline: snapshot.liveActivity.title,
      subhead: snapshot.liveActivity.body,
      progress: snapshot.liveActivity.progress,
      stage: snapshot.liveActivity.stage,
    },
  );
}

export function toWidgetTimelineEntry(
  snapshot: LiveSurfaceSnapshotWidget,
): LiveSurfaceWidgetTimelineEntryOutput {
  return ensureProjection(
    "toWidgetTimelineEntry",
    liveSurfaceWidgetTimelineEntry,
    {
      schemaVersion: SCHEMA_VERSION,
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
    },
  );
}

export function toControlValueProvider(
  snapshot: LiveSurfaceSnapshotControl,
): LiveSurfaceControlValueProviderOutput {
  const control = snapshot.control;
  return ensureProjection(
    "toControlValueProvider",
    liveSurfaceControlValueProvider,
    {
      schemaVersion: SCHEMA_VERSION,
      kind: "control",
      snapshotId: snapshot.id,
      surfaceId: snapshot.surfaceId,
      controlKind: control.controlKind,
      // Omit absent optionals rather than coercing them to null, matching
      // toLockAccessoryEntry / toNotificationContentPayload. A button or
      // deepLink control has no toggle state; the key is simply absent.
      ...(control.state !== undefined ? { value: control.state } : {}),
      ...(control.intent !== undefined ? { intent: control.intent } : {}),
      label: control.label,
      deepLink: control.deepLink,
    },
  );
}

export function toLockAccessoryEntry(
  snapshot: LiveSurfaceSnapshotLockAccessory,
): LiveSurfaceLockAccessoryEntryOutput {
  const accessory = snapshot.lockAccessory;
  return ensureProjection(
    "toLockAccessoryEntry",
    liveSurfaceLockAccessoryEntry,
    {
      schemaVersion: SCHEMA_VERSION,
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
    },
  );
}

export function toStandbyEntry(
  snapshot: LiveSurfaceSnapshotStandby,
): LiveSurfaceStandbyEntryOutput {
  return ensureProjection("toStandbyEntry", liveSurfaceStandbyEntry, {
    schemaVersion: SCHEMA_VERSION,
    kind: "standby",
    snapshotId: snapshot.id,
    surfaceId: snapshot.surfaceId,
    state: snapshot.state,
    presentation: snapshot.standby.presentation,
    ...(snapshot.standby.tint !== undefined
      ? { tint: snapshot.standby.tint }
      : {}),
    headline: snapshot.standby.title,
    subhead: snapshot.standby.body,
    progress: snapshot.standby.progress,
    deepLink: snapshot.standby.deepLink,
  });
}

export function toNotificationContentPayload(
  snapshot: LiveSurfaceSnapshotNotification,
): LiveSurfaceNotificationContentPayloadOutput {
  const note = snapshot.notification;
  return ensureProjection(
    "toNotificationContentPayload",
    liveSurfaceNotificationContentPayload,
    {
      schemaVersion: SCHEMA_VERSION,
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
        schemaVersion: SCHEMA_VERSION,
        kind: "surface_snapshot",
        snapshotId: snapshot.id,
        surfaceId: snapshot.surfaceId,
        state: snapshot.state,
        deepLink: note.deepLink,
        ...(note.category ? { category: note.category } : {}),
      },
    },
  );
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
