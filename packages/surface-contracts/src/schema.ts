import { z } from "zod";
import {
  liveSurfaceSnapshotV1,
  type LiveSurfaceSnapshotV1,
} from "./schema-v1.ts";

export { liveSurfaceSnapshotV1, type LiveSurfaceSnapshotV1 };

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

export const liveSurfaceControlSlice = z
  .object({
    kind: z.enum(["toggle", "button", "deepLink"]),
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
  schemaVersion: z.literal("2").default("2"),
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

export const liveSurfaceAlertPayload = z
  .object({
    aps: z.object({
      alert: z.object({
        title: z.string(),
        body: z.string(),
      }),
      sound: z.literal("default").optional(),
    }),
    liveSurface: z.object({
      kind: z.literal("surface_snapshot"),
      snapshotId: z.string(),
      surfaceId: z.string(),
      state: liveSurfaceState,
      deepLink: z.string(),
    }),
  })
  .strict();
export type LiveSurfaceAlertPayload = z.infer<typeof liveSurfaceAlertPayload>;

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
  /** Set when the input parsed as v0 and was migrated to v1. */
  deprecationWarning?: string;
};

export type SafeParseAnyVersionFailure = {
  success: false;
  error: z.ZodError;
};

export type SafeParseAnyVersionResult =
  | SafeParseAnyVersionSuccess
  | SafeParseAnyVersionFailure;

export type MigrateV1ToV2Options = {
  /**
   * Synthesizes a value for `updatedAt` when the v1 payload omits it.
   * v2 requires `updatedAt`; the codec's default is to leave it undefined
   * so the resulting v2 snapshot fails parse with an explicit
   * "Required" error, which is louder than a synthesized "now" lie that
   * silently breaks ordering. Pass this only when the caller can vouch
   * for the substituted timestamp's correctness.
   */
  updatedAtFallback?: string;
};

/**
 * Pure v1->v2 transform. Always succeeds for a parsed v1 payload; the
 * result still needs to pass v2 parse if the v1 payload lacked
 * `updatedAt` and the caller did not provide an `updatedAtFallback`.
 *
 * Mapping:
 * - `kind: "liveActivity"` -> the three v1 base fields (stage,
 *   estimatedSeconds, morePartsCount) move under the new
 *   `liveActivity` slice. Everything else carries over unchanged.
 * - `kind: "widget" | "control" | "notification" | "lockAccessory" |
 *   "standby"` -> v1's stage, estimatedSeconds, and morePartsCount are
 *   dropped (they had no meaning on these kinds).
 * - `schemaVersion: "1"` -> `"2"`
 * - `updatedAt`: pass-through; or the provided fallback; or undefined.
 */
export function migrateV1ToV2(
  v1: LiveSurfaceSnapshotV1,
  opts: MigrateV1ToV2Options = {},
): LiveSurfaceSnapshot {
  const {
    schemaVersion: _v1Version,
    stage,
    estimatedSeconds,
    morePartsCount,
    updatedAt,
    ...rest
  } = v1;
  const effectiveUpdatedAt =
    updatedAt ?? opts.updatedAtFallback;
  const base = {
    ...rest,
    schemaVersion: "2" as const,
    ...(effectiveUpdatedAt !== undefined
      ? { updatedAt: effectiveUpdatedAt }
      : {}),
  };
  if (v1.kind === "liveActivity") {
    return {
      ...base,
      kind: "liveActivity",
      liveActivity: { stage, estimatedSeconds, morePartsCount },
    } as LiveSurfaceSnapshot;
  }
  // Every non-liveActivity kind drops the three liveActivity-only fields
  // and carries through its own existing slice unchanged. The cast keeps
  // TS from re-narrowing across each branch; the runtime data is correct
  // by construction since we only stripped fields v2 does not accept.
  return base as unknown as LiveSurfaceSnapshot;
}

/**
 * Multi-version safe-parse. Tries v2 (strict) first; on failure, tries v1
 * (frozen, with the v1 missing-kind preprocess) and migrates the result.
 * Returns the v2 ZodError when both attempts fail so callers see the most
 * relevant message.
 *
 * On v1->v2 migration, the result carries a `deprecationWarning` so
 * telemetry can surface producers still on the old shape; see
 * docs/observability.md for the recommended log.
 */
export function safeParseAnyVersion(value: unknown): SafeParseAnyVersionResult {
  const v2 = liveSurfaceSnapshot.safeParse(value);
  if (v2.success) {
    return { success: true, data: v2.data };
  }
  const v1 = liveSurfaceSnapshotV1.safeParse(value);
  if (v1.success) {
    const migrated = migrateV1ToV2(v1.data);
    const v2Recheck = liveSurfaceSnapshot.safeParse(migrated);
    if (v2Recheck.success) {
      return {
        success: true,
        data: v2Recheck.data,
        deprecationWarning:
          'liveSurfaceSnapshot v1 is deprecated and will be removed in @mobile-surfaces/surface-contracts@4.0. Migrate producers to schemaVersion "2" and explicit liveActivity-slice fields.',
      };
    }
    // The v1 payload parsed v1 but failed v2 parse after migration. The
    // most common case is a v1 payload with no updatedAt: v2 requires it
    // and migrateV1ToV2 deliberately does not synthesize one. Surface the
    // v2 ZodError so callers see the missing-field path explicitly.
    return { success: false, error: v2Recheck.error };
  }
  return { success: false, error: v2.error };
}
