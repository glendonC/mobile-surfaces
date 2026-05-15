import { z } from "zod";
import {
  liveSurfaceSnapshotV2,
  type LiveSurfaceSnapshotV2,
} from "./schema-v2.ts";

export { liveSurfaceSnapshotV2, type LiveSurfaceSnapshotV2 };

export const liveSurfaceState = z.enum([
  "queued",
  "active",
  "paused",
  "attention",
  "bad_timing",
  "completed",
]);
export type LiveSurfaceState = z.infer<typeof liveSurfaceState>;

export const liveSurfaceStage = z.enum([
  "prompted",
  "inProgress",
  "completing",
]);
export type LiveSurfaceStage = z.infer<typeof liveSurfaceStage>;

export const liveSurfaceKind = z.enum([
  "liveActivity",
  "widget",
  "control",
  "lockAccessory",
  "standby",
  "notification",
]);
export type LiveSurfaceKind = z.infer<typeof liveSurfaceKind>;

export const liveSurfaceWidgetSlice = z
  .object({
    family: z.enum(["systemSmall", "systemMedium", "systemLarge"]).optional(),
    reloadPolicy: z.enum(["manual", "afterDate"]).optional(),
  })
  .strict();
export type LiveSurfaceWidgetSlice = z.infer<typeof liveSurfaceWidgetSlice>;

// v3 renamed the inner `kind` field to `controlKind`. In v2 it shadowed the
// outer discriminator (controlSnap.kind === "control" vs
// controlSnap.control.kind === "toggle") and was a hand-authoring footgun
// in raw payloads. The projection output (liveSurfaceControlValueProvider)
// already exposed the field as `controlKind`, so consumers reading the
// projected value didn't see the shadow; v3 closes the gap on the wire.
export const liveSurfaceControlSlice = z
  .object({
    controlKind: z.enum(["toggle", "button", "deepLink"]),
    state: z.boolean().optional(),
    intent: z.string().optional(),
  })
  .strict();
export type LiveSurfaceControlSlice = z.infer<typeof liveSurfaceControlSlice>;

export const liveSurfaceNotificationSlice = z
  .object({
    category: z.string().optional(),
    threadId: z.string().optional(),
  })
  .strict();
export type LiveSurfaceNotificationSlice = z.infer<
  typeof liveSurfaceNotificationSlice
>;

export const liveSurfaceLockAccessoryFamily = z.enum([
  "accessoryCircular",
  "accessoryRectangular",
  "accessoryInline",
]);
export type LiveSurfaceLockAccessoryFamily = z.infer<
  typeof liveSurfaceLockAccessoryFamily
>;

export const liveSurfaceLockAccessorySlice = z
  .object({
    family: liveSurfaceLockAccessoryFamily,
    gaugeValue: z.number().min(0).max(1).optional(),
    shortText: z.string().max(20).optional(),
  })
  .strict();
export type LiveSurfaceLockAccessorySlice = z.infer<
  typeof liveSurfaceLockAccessorySlice
>;

export const liveSurfaceStandbyPresentation = z.enum(["card", "night"]);
export type LiveSurfaceStandbyPresentation = z.infer<
  typeof liveSurfaceStandbyPresentation
>;

export const liveSurfaceStandbySlice = z
  .object({
    presentation: liveSurfaceStandbyPresentation.default("card"),
    tint: z.enum(["default", "monochrome"]).optional(),
  })
  .strict();
export type LiveSurfaceStandbySlice = z.infer<typeof liveSurfaceStandbySlice>;

// liveActivity-only timing and stage hints. v1 carried these on every
// snapshot regardless of kind; v2 moves them into a per-kind slice so a
// widget or control snapshot no longer pretends to have a stage or an
// estimatedSeconds.
//
// `stage` is what toLiveActivityContentState projects into the
// ActivityKit ContentState; `estimatedSeconds` is a Lock-Screen duration
// hint; `morePartsCount` lets a producer indicate queued follow-up parts
// without inflating the payload. None of these have meaning outside the
// Lock Screen surface.
export const liveSurfaceLiveActivitySlice = z
  .object({
    stage: liveSurfaceStage,
    estimatedSeconds: z.int().min(0),
    morePartsCount: z.int().min(0),
  })
  .strict();
export type LiveSurfaceLiveActivitySlice = z.infer<
  typeof liveSurfaceLiveActivitySlice
>;

// Base fields shared by every snapshot variant. We spread this into each
// per-kind z.object below so types stay inferred from Zod (no hand-written
// interfaces) while the discriminated union narrows on `kind`. Keeping the
// raw shape (instead of a built schema) lets each variant call `.strict()`
// after attaching its kind-specific slice.
const liveSurfaceSnapshotBaseShape = {
  schemaVersion: z.literal("3").default("3"),
  id: z.string().min(1),
  surfaceId: z.string().min(1),
  // Wall-clock instant the snapshot was authored, as an RFC 3339 datetime
  // string. Consumers use it to drop out-of-order pushes: ActivityKit and
  // APNs offer no in-band ordering guarantee, and the network may reorder
  // a stage-transition update behind a content-state tick. Comparing
  // updatedAt against the snapshot already applied is the only correct
  // discard test on the client.
  //
  // UTC (Z-suffixed) is recommended for trivial lexicographic comparison
  // ("2026-05-12T18:32:11.482Z") but offsets are also accepted so producers
  // emitting OffsetDateTime / time.Time / Instant do not have to normalize
  // before serialization. When mixing producers, normalize to UTC before
  // comparing.
  //
  // Required in v2. Optional in v1; the v1->v2 migration codec exposes an
  // `updatedAtFallback` opt-in for callers who know it is safe to
  // synthesize a value at migration time.
  updatedAt: z.string().datetime({ offset: true }),
  state: liveSurfaceState,
  modeLabel: z.string().min(1),
  contextLabel: z.string(),
  statusLine: z.string(),
  primaryText: z.string().min(1),
  secondaryText: z.string(),
  actionLabel: z.string().optional(),
  progress: z.number().min(0).max(1),
  deepLink: z.string().regex(/^[a-z][a-z0-9+\-.]*:\/\//),
} as const;

export const liveSurfaceSnapshotLiveActivity = z
  .object({
    kind: z.literal("liveActivity"),
    ...liveSurfaceSnapshotBaseShape,
    liveActivity: liveSurfaceLiveActivitySlice,
  })
  .strict();
export type LiveSurfaceSnapshotLiveActivity = z.infer<
  typeof liveSurfaceSnapshotLiveActivity
>;

export const liveSurfaceSnapshotWidget = z
  .object({
    kind: z.literal("widget"),
    ...liveSurfaceSnapshotBaseShape,
    widget: liveSurfaceWidgetSlice,
  })
  .strict();
export type LiveSurfaceSnapshotWidget = z.infer<
  typeof liveSurfaceSnapshotWidget
>;

export const liveSurfaceSnapshotControl = z
  .object({
    kind: z.literal("control"),
    ...liveSurfaceSnapshotBaseShape,
    control: liveSurfaceControlSlice,
  })
  .strict();
export type LiveSurfaceSnapshotControl = z.infer<
  typeof liveSurfaceSnapshotControl
>;

export const liveSurfaceSnapshotNotification = z
  .object({
    kind: z.literal("notification"),
    ...liveSurfaceSnapshotBaseShape,
    notification: liveSurfaceNotificationSlice,
  })
  .strict();
export type LiveSurfaceSnapshotNotification = z.infer<
  typeof liveSurfaceSnapshotNotification
>;

export const liveSurfaceSnapshotLockAccessory = z
  .object({
    kind: z.literal("lockAccessory"),
    ...liveSurfaceSnapshotBaseShape,
    lockAccessory: liveSurfaceLockAccessorySlice,
  })
  .strict();
export type LiveSurfaceSnapshotLockAccessory = z.infer<
  typeof liveSurfaceSnapshotLockAccessory
>;

export const liveSurfaceSnapshotStandby = z
  .object({
    kind: z.literal("standby"),
    ...liveSurfaceSnapshotBaseShape,
    standby: liveSurfaceStandbySlice,
  })
  .strict();
export type LiveSurfaceSnapshotStandby = z.infer<
  typeof liveSurfaceSnapshotStandby
>;

// Discriminated union over `kind`. v2 requires `kind` to be set explicitly;
// the v1 missing-kind preprocess shim was removed because every authored
// fixture in this repo (and every payload the v1->v2 codec emits) sets it.
//
// Wrapped in z.lazy() so the discriminated-union construction (building the
// kind -> variant Map across 6 variants) is deferred to the first
// parse/safeParse call instead of running at module import. Backends that
// import this package but only validate occasionally, and short-lived
// serverless invocations that rarely hit the codepath, do not pay the
// construction cost on cold start. The variants themselves stay eagerly
// built (they are independently exported) and .parse / .safeParse still
// pass through transparently.
//
// Standard Schema (https://standardschema.dev) interop is provided automatically
// by Zod 4 via the `~standard` property: `liveSurfaceSnapshot["~standard"]`
// returns `{ vendor: "zod", version: 1, validate, jsonSchema }`. Consumers can
// pass this contract to any Standard-Schema-aware library (Valibot, ArkType,
// `@standard-schema/spec` runners) without depending on Zod at runtime. The
// fixture-validation tests pin this; do not remove the assertion.
export const liveSurfaceSnapshot = z.lazy(() =>
  z.discriminatedUnion("kind", [
    liveSurfaceSnapshotLiveActivity,
    liveSurfaceSnapshotWidget,
    liveSurfaceSnapshotControl,
    liveSurfaceSnapshotNotification,
    liveSurfaceSnapshotLockAccessory,
    liveSurfaceSnapshotStandby,
  ]));
export type LiveSurfaceSnapshot = z.infer<typeof liveSurfaceSnapshot>;

export const liveSurfaceActivityContentState = z
  .object({
    headline: z.string(),
    subhead: z.string(),
    progress: z.number().min(0).max(1),
    stage: liveSurfaceStage,
  })
  .strict();
export type LiveSurfaceActivityContentState = z.infer<
  typeof liveSurfaceActivityContentState
>;

// Output schemas for the non-alert projections. The projection helpers in
// index.ts already return strongly-typed results, but TypeScript-only types
// cannot defend against a future helper edit that silently widens the
// returned shape (or a fixture edit that drives the helper into a runtime-
// only branch the type checker missed). Pairing each helper with an output
// schema lets the drift test in scripts/surface-contracts.test.mjs project
// every committed fixture through its helper, parse the result, and fail
// closed on any divergence.
//
// Optional fields are modeled with `.optional()` to mirror the projection
// helpers' "drop empty / falsy" behavior (toNotificationContentPayload omits
// category/threadId when empty; toStandbyEntry sets tint to null when
// absent — see the helper for the exact rule).

export const liveSurfaceWidgetTimelineEntry = z
  .object({
    kind: z.literal("widget"),
    snapshotId: z.string(),
    surfaceId: z.string(),
    state: liveSurfaceState,
    family: z.enum(["systemSmall", "systemMedium", "systemLarge"]).optional(),
    reloadPolicy: z.enum(["manual", "afterDate"]).optional(),
    headline: z.string(),
    subhead: z.string(),
    progress: z.number().min(0).max(1),
    deepLink: z.string(),
  })
  .strict();
export type LiveSurfaceWidgetTimelineEntryOutput = z.infer<
  typeof liveSurfaceWidgetTimelineEntry
>;

export const liveSurfaceControlValueProvider = z
  .object({
    kind: z.literal("control"),
    snapshotId: z.string(),
    surfaceId: z.string(),
    controlKind: z.enum(["toggle", "button", "deepLink"]),
    value: z.boolean().nullable(),
    intent: z.string().nullable(),
    label: z.string().min(1),
    deepLink: z.string(),
  })
  .strict();
export type LiveSurfaceControlValueProviderOutput = z.infer<
  typeof liveSurfaceControlValueProvider
>;

export const liveSurfaceLockAccessoryEntry = z
  .object({
    kind: z.literal("lockAccessory"),
    snapshotId: z.string(),
    surfaceId: z.string(),
    state: liveSurfaceState,
    family: liveSurfaceLockAccessoryFamily,
    headline: z.string(),
    shortText: z.string(),
    gaugeValue: z.number().min(0).max(1),
    deepLink: z.string(),
  })
  .strict();
export type LiveSurfaceLockAccessoryEntryOutput = z.infer<
  typeof liveSurfaceLockAccessoryEntry
>;

export const liveSurfaceStandbyEntry = z
  .object({
    kind: z.literal("standby"),
    snapshotId: z.string(),
    surfaceId: z.string(),
    state: liveSurfaceState,
    presentation: liveSurfaceStandbyPresentation,
    tint: z.enum(["default", "monochrome"]).nullable(),
    headline: z.string(),
    subhead: z.string(),
    progress: z.number().min(0).max(1),
    deepLink: z.string(),
  })
  .strict();
export type LiveSurfaceStandbyEntryOutput = z.infer<
  typeof liveSurfaceStandbyEntry
>;

export const liveSurfaceNotificationContentPayload = z
  .object({
    aps: z
      .object({
        alert: z
          .object({
            title: z.string(),
            body: z.string(),
          })
          .strict(),
        sound: z.literal("default"),
        category: z.string().optional(),
        "thread-id": z.string().optional(),
      })
      .strict(),
    liveSurface: z
      .object({
        kind: z.literal("surface_notification"),
        snapshotId: z.string(),
        surfaceId: z.string(),
        state: liveSurfaceState,
        deepLink: z.string(),
      })
      .strict(),
  })
  .strict();
export type LiveSurfaceNotificationContentPayloadOutput = z.infer<
  typeof liveSurfaceNotificationContentPayload
>;

// Derived arrays preserve the older string-list export surface for consumers
// who only need the union members. Tuple-narrow so downstream `as const`
// patterns keep working.
export const liveSurfaceStates = liveSurfaceState.options as unknown as readonly [
  "queued",
  "active",
  "paused",
  "attention",
  "bad_timing",
  "completed",
];
export const liveSurfaceStages = liveSurfaceStage.options as unknown as readonly [
  "prompted",
  "inProgress",
  "completing",
];
export const liveSurfaceKinds = liveSurfaceKind.options as unknown as readonly [
  "liveActivity",
  "widget",
  "control",
  "lockAccessory",
  "standby",
  "notification",
];

/**
 * Strict v2 parser. Throws on any payload that does not match the v2
 * discriminated union. Does NOT auto-migrate v1 payloads — for that, use
 * {@link safeParseAnyVersion}.
 */
export function assertSnapshot(value: unknown): LiveSurfaceSnapshot {
  return liveSurfaceSnapshot.parse(value);
}

/**
 * Strict v2 safe-parse. Returns Zod's standard SafeParseReturnType. Does NOT
 * auto-migrate v1 payloads — for that, use {@link safeParseAnyVersion}.
 */
export function safeParseSnapshot(value: unknown) {
  return liveSurfaceSnapshot.safeParse(value);
}

export type SafeParseAnyVersionSuccess = {
  success: true;
  data: LiveSurfaceSnapshot;
  /** Set when the input parsed as v1 and was migrated to v2. */
  deprecationWarning?: string;
};

export type SafeParseAnyVersionFailure = {
  success: false;
  error: z.ZodError;
};

export type SafeParseAnyVersionResult =
  | SafeParseAnyVersionSuccess
  | SafeParseAnyVersionFailure;

/**
 * Pure v2->v3 transform. Always succeeds for a parsed v2 payload.
 *
 * Mapping:
 * - `kind: "control"` -> the control slice's inner field is renamed
 *   `kind` -> `controlKind` to stop shadowing the outer discriminator.
 *   Everything else on a control snapshot carries over unchanged.
 * - Every other kind: pass-through. v3 made no other shape changes.
 * - `schemaVersion: "2"` -> `"3"`.
 */
export function migrateV2ToV3(
  v2: LiveSurfaceSnapshotV2,
): LiveSurfaceSnapshot {
  const { schemaVersion: _v2Version, ...rest } = v2;
  if (v2.kind === "control") {
    const { kind: innerKind, ...controlRest } = v2.control;
    return {
      ...rest,
      schemaVersion: "3" as const,
      kind: "control",
      control: { controlKind: innerKind, ...controlRest },
    } as LiveSurfaceSnapshot;
  }
  return {
    ...rest,
    schemaVersion: "3" as const,
  } as unknown as LiveSurfaceSnapshot;
}

/**
 * Multi-version safe-parse. Tries v3 (strict) first; on failure, tries v2
 * (frozen) and migrates the result to v3. Returns the v3 ZodError when
 * both attempts fail so callers see the most relevant message.
 *
 * On v2->v3 migration, the result carries a `deprecationWarning` so
 * telemetry can surface producers still on the old shape; see
 * https://mobile-surfaces.com/docs/observability for the recommended log.
 *
 * The v1 codec was dropped at 4.0.0 per the v2 RFC commitment. Consumers
 * still emitting v1 must run their payloads through @mobile-surfaces/surface-contracts@3
 * to migrate to v2 first, then this package to reach v3.
 */
export function safeParseAnyVersion(value: unknown): SafeParseAnyVersionResult {
  const v3 = liveSurfaceSnapshot.safeParse(value);
  if (v3.success) {
    return { success: true, data: v3.data };
  }
  const v2 = liveSurfaceSnapshotV2.safeParse(value);
  if (v2.success) {
    const migrated = migrateV2ToV3(v2.data);
    const v3Recheck = liveSurfaceSnapshot.safeParse(migrated);
    if (v3Recheck.success) {
      return {
        success: true,
        data: v3Recheck.data,
        deprecationWarning:
          'liveSurfaceSnapshot v2 is deprecated and will be removed in @mobile-surfaces/surface-contracts@5.0. Migrate producers to schemaVersion "3" and rename control.kind to control.controlKind.',
      };
    }
    return { success: false, error: v3Recheck.error };
  }
  return { success: false, error: v3.error };
}
