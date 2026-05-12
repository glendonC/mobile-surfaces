import { z } from "zod";

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

// Base fields shared by every snapshot variant. We spread this into each
// per-kind z.object below so types stay inferred from Zod (no hand-written
// interfaces) while the discriminated union narrows on `kind`. Keeping the
// raw shape (instead of a built schema) lets each variant call `.strict()`
// after attaching its kind-specific slice.
const liveSurfaceSnapshotBaseShape = {
  schemaVersion: z.literal("1").default("1"),
  id: z.string().min(1),
  surfaceId: z.string().min(1),
  state: liveSurfaceState,
  modeLabel: z.string().min(1),
  contextLabel: z.string(),
  statusLine: z.string(),
  primaryText: z.string().min(1),
  secondaryText: z.string(),
  actionLabel: z.string().optional(),
  estimatedSeconds: z.int().min(0),
  morePartsCount: z.int().min(0),
  progress: z.number().min(0).max(1),
  stage: liveSurfaceStage,
  deepLink: z.string().regex(/^[a-z][a-z0-9+\-.]*:\/\//),
} as const;

export const liveSurfaceSnapshotLiveActivity = z
  .object({
    kind: z.literal("liveActivity"),
    ...liveSurfaceSnapshotBaseShape,
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

// Discriminated union over `kind`. The .preprocess wrapper preserves the
// historical "missing kind defaults to liveActivity" behavior so v1 payloads
// stored before the discriminator was enforced still parse. Authored payloads
// in this repo always set `kind` explicitly; this is a safety net for any
// externally-stored snapshot.
//
// Wrapped in z.lazy() so the preprocess + discriminated-union construction
// (building the kind -> variant Map across 6 variants) is deferred to the
// first parse/safeParse call instead of running at module import. Backends
// that import this package but only validate occasionally, and short-lived
// serverless invocations that rarely hit the codepath, no longer pay the
// construction cost on cold start. The variants themselves stay eagerly
// built (they are independently exported) and .parse / .safeParse still
// pass through transparently.
//
// Standard Schema (https://standardschema.dev) interop is provided automatically
// by Zod 4 via the `~standard` property — `liveSurfaceSnapshot["~standard"]`
// returns `{ vendor: "zod", version: 1, validate, jsonSchema }`. Consumers can
// pass this contract to any Standard-Schema-aware library (Valibot, ArkType,
// `@standard-schema/spec` runners) without depending on Zod at runtime. The
// fixture-validation tests pin this; do not remove the assertion.
export const liveSurfaceSnapshot = z.lazy(() =>
  z.preprocess(
    (value) => {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !("kind" in (value as Record<string, unknown>))
      ) {
        return { ...(value as Record<string, unknown>), kind: "liveActivity" };
      }
      return value;
    },
    z.discriminatedUnion("kind", [
      liveSurfaceSnapshotLiveActivity,
      liveSurfaceSnapshotWidget,
      liveSurfaceSnapshotControl,
      liveSurfaceSnapshotNotification,
      liveSurfaceSnapshotLockAccessory,
      liveSurfaceSnapshotStandby,
    ]),
  ),
);
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
 * Strict v1 parser. Throws on any payload that does not match the v1
 * discriminated union. Does NOT auto-migrate v0 payloads — for that, use
 * {@link safeParseAnyVersion}.
 */
export function assertSnapshot(value: unknown): LiveSurfaceSnapshot {
  return liveSurfaceSnapshot.parse(value);
}

/**
 * Strict v1 safe-parse. Returns Zod's standard SafeParseReturnType. Does NOT
 * auto-migrate v0 payloads — for that, use {@link safeParseAnyVersion}.
 */
export function safeParseSnapshot(value: unknown) {
  return liveSurfaceSnapshot.safeParse(value);
}

// ---------------------------------------------------------------------------
// v0 → v1 migration codec
//
// v0 was the pre-multi-projection shape: a single liveActivity-shaped object
// with no `kind` discriminator and no projection slices. v1 adds `kind` and
// per-kind slices. We keep the v0 schema verbatim here (reconstructed from
// commit a834bad's packages/surface-contracts/src/schema.ts) so historical
// payloads can be promoted without manual editing.
// ---------------------------------------------------------------------------

export const liveSurfaceSnapshotV0 = z
  .object({
    schemaVersion: z.literal("0"),
    id: z.string().min(1),
    surfaceId: z.string().min(1),
    state: liveSurfaceState,
    modeLabel: z.string().min(1),
    contextLabel: z.string(),
    statusLine: z.string(),
    primaryText: z.string().min(1),
    secondaryText: z.string(),
    actionLabel: z.string().optional(),
    estimatedSeconds: z.int().min(0),
    morePartsCount: z.int().min(0),
    progress: z.number().min(0).max(1),
    stage: liveSurfaceStage,
    deepLink: z.string().regex(/^[a-z][a-z0-9+\-.]*:\/\//),
  })
  .strict();
export type LiveSurfaceSnapshotV0 = z.infer<typeof liveSurfaceSnapshotV0>;

/**
 * Pure v0→v1 transform. Promotes a parsed v0 payload to a v1
 * liveActivity-kind snapshot. v0 had no projection slices, so the result
 * always has `kind: "liveActivity"` with no `widget` / `control` /
 * `notification` slice.
 */
export function migrateV0ToV1(v0: LiveSurfaceSnapshotV0): LiveSurfaceSnapshot {
  const { schemaVersion: _v0Version, ...rest } = v0;
  return {
    ...rest,
    schemaVersion: "1",
    kind: "liveActivity",
  } satisfies LiveSurfaceSnapshot;
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

/**
 * Multi-version safe-parse. Tries the strict v1 discriminated union first; on
 * failure, tries v0 and migrates the result. Returns the v1 Zod error only
 * when both attempts fail (so callers can surface the more relevant message).
 */
export function safeParseAnyVersion(value: unknown): SafeParseAnyVersionResult {
  const v1 = liveSurfaceSnapshot.safeParse(value);
  if (v1.success) {
    return { success: true, data: v1.data };
  }
  const v0 = liveSurfaceSnapshotV0.safeParse(value);
  if (v0.success) {
    return {
      success: true,
      data: migrateV0ToV1(v0.data),
      deprecationWarning:
        'liveSurfaceSnapshot v0 is deprecated. Migrate producers to schemaVersion "1" with an explicit `kind`.',
    };
  }
  return { success: false, error: v1.error };
}
