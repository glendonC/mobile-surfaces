import { z } from "zod";
import {
  liveSurfaceSnapshotV3,
  type LiveSurfaceSnapshotV3,
} from "./schema-v3.ts";

export { liveSurfaceSnapshotV3, type LiveSurfaceSnapshotV3 };

// ---------------------------------------------------------------------------
// Enums (shared across base, slices, and projection-output schemas).
// Each `.describe()` adds semantic intent beyond the value list, which is
// what an LLM emitting structured output (or a human reading the published
// JSON Schema at unpkg.com/@mobile-surfaces/surface-contracts@5.0/schema.json)
// needs to use the value correctly.
// ---------------------------------------------------------------------------

export const liveSurfaceState = z
  .enum([
    "queued",
    "active",
    "paused",
    "attention",
    "bad_timing",
    "completed",
  ])
  .describe(
    "Lifecycle states. queued/active/paused = in-flight; attention = needs " +
      "user action (drives high-priority APNs); bad_timing = should not " +
      "interrupt right now; completed = terminal.",
  );
export type LiveSurfaceState = z.infer<typeof liveSurfaceState>;

export const liveSurfaceStage = z
  .enum(["prompted", "inProgress", "completing"])
  .describe(
    "ActivityKit-only sub-lifecycle within an active Live Activity. " +
      "prompted = system-prompted user action; inProgress = work continuing; " +
      "completing = dismissal grace window.",
  );
export type LiveSurfaceStage = z.infer<typeof liveSurfaceStage>;

export const liveSurfaceKind = z
  .enum([
    "liveActivity",
    "widget",
    "control",
    "lockAccessory",
    "standby",
    "notification",
  ])
  .describe(
    "Discriminator. Each value selects exactly one projection helper and " +
      "exactly one required slice.",
  );
export type LiveSurfaceKind = z.infer<typeof liveSurfaceKind>;

export const liveSurfaceLockAccessoryFamily = z.enum([
  "accessoryCircular",
  "accessoryRectangular",
  "accessoryInline",
]);
export type LiveSurfaceLockAccessoryFamily = z.infer<
  typeof liveSurfaceLockAccessoryFamily
>;

export const liveSurfaceStandbyPresentation = z.enum(["card", "night"]);
export type LiveSurfaceStandbyPresentation = z.infer<
  typeof liveSurfaceStandbyPresentation
>;

// ---------------------------------------------------------------------------
// Per-kind slices. v4 carries all kind-specific rendering inside its slice;
// the base shape (below) is identification + state only.
// ---------------------------------------------------------------------------

const deepLinkSchema = z
  .string()
  .regex(/^[a-z][a-z0-9+\-.]*:\/\//)
  .describe(
    "Tapping the surface opens this URL. Validated as a scheme://… prefix.",
  );

export const liveSurfaceLiveActivitySlice = z
  .object({
    title: z.string().min(1).describe("Lock-Screen / Dynamic-Island headline."),
    body: z.string().describe("Lock-Screen subhead under the title."),
    progress: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Completion ratio (0..1). Renders as the activity's progress bar and " +
          "is what toLiveActivityContentState forwards into ActivityKit.",
      ),
    deepLink: deepLinkSchema,
    modeLabel: z
      .string()
      .min(1)
      .describe(
        "Compact mode label for the Dynamic Island leading region (e.g. \"active\").",
      ),
    contextLabel: z
      .string()
      .describe(
        "Trailing context tag for the Dynamic Island (e.g. \"queue · stage 2\").",
      ),
    statusLine: z
      .string()
      .describe(
        "One-line status string composed for accessibility readout and for " +
          "the expanded Lock-Screen layout's secondary row.",
      ),
    actionLabel: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Label for the activity's primary action button. Omitted when the " +
          "activity has no action affordance.",
      ),
    stage: liveSurfaceStage.describe(
      "ActivityKit ContentState stage. Producers transition prompted → " +
        "inProgress → completing; iOS uses it to decide the Dynamic Island " +
        "compact layout and the dismissal grace period.",
    ),
    estimatedSeconds: z
      .int()
      .min(0)
      .describe(
        "Estimated remaining seconds. Optional hint to the Lock-Screen " +
          "layout for countdown UIs; zero means \"unknown\".",
      ),
    morePartsCount: z
      .int()
      .min(0)
      .describe(
        "Number of queued follow-up parts (e.g. \"+3 more\"). Lets producers " +
          "signal continuity without padding the payload with the full queue.",
      ),
  })
  .strict();
export type LiveSurfaceLiveActivitySlice = z.infer<
  typeof liveSurfaceLiveActivitySlice
>;

export const liveSurfaceWidgetSlice = z
  .object({
    title: z.string().min(1).describe("Widget headline."),
    body: z.string().describe("Widget secondary line."),
    progress: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Optional progress fill on system{Small,Medium,Large} widgets that " +
          "render a progress ring or bar.",
      ),
    deepLink: deepLinkSchema,
    family: z
      .enum(["systemSmall", "systemMedium", "systemLarge"])
      .optional()
      .describe(
        "Preferred widget family. Optional because the host can render at " +
          "the user-chosen size and ignore the hint.",
      ),
    reloadPolicy: z
      .enum(["manual", "afterDate"])
      .optional()
      .describe(
        "WidgetKit timeline reload policy. \"manual\" means the host reloads " +
          "only when the App Group write triggers; \"afterDate\" uses the " +
          "framework's next-update hint.",
      ),
  })
  .strict();
export type LiveSurfaceWidgetSlice = z.infer<typeof liveSurfaceWidgetSlice>;

export const liveSurfaceControlSlice = z
  .object({
    label: z
      .string()
      .min(1)
      .describe(
        "Button / toggle label rendered in the Control Center tile.",
      ),
    deepLink: deepLinkSchema,
    controlKind: z
      .enum(["toggle", "button", "deepLink"])
      .describe(
        "Tile behavior. \"toggle\" exposes a boolean value; \"button\" runs " +
          "an App Intent without state; \"deepLink\" opens the URL.",
      ),
    state: z
      .boolean()
      .optional()
      .describe(
        "Toggle state for \"toggle\"-kind controls. Absent on \"button\" / " +
          "\"deepLink\". Round-trips through App Group storage when the user " +
          "toggles.",
      ),
    intent: z
      .string()
      .optional()
      .describe(
        "App Intent identifier invoked on tap (\"toggle\" / \"button\").",
      ),
  })
  .strict();
export type LiveSurfaceControlSlice = z.infer<typeof liveSurfaceControlSlice>;

export const liveSurfaceLockAccessorySlice = z
  .object({
    title: z
      .string()
      .min(1)
      .describe(
        "Accessory headline. accessoryCircular ignores it; " +
          "accessoryRectangular and accessoryInline render it.",
      ),
    deepLink: deepLinkSchema,
    family: liveSurfaceLockAccessoryFamily.describe(
      "Lock-screen accessory family (accessoryCircular / " +
        "accessoryRectangular / accessoryInline).",
    ),
    gaugeValue: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Gauge fill (0..1). Drives the circular ring or rectangular progress; " +
          "absent means \"no gauge.\"",
      ),
    shortText: z
      .string()
      .max(20)
      .optional()
      .describe(
        "Compact label. Length-bounded because accessoryInline truncates at " +
          "~20 chars; longer strings will be elided by the system.",
      ),
  })
  .strict();
export type LiveSurfaceLockAccessorySlice = z.infer<
  typeof liveSurfaceLockAccessorySlice
>;

export const liveSurfaceStandbySlice = z
  .object({
    title: z
      .string()
      .min(1)
      .describe("Standby card / night-mode headline."),
    body: z.string().describe("Standby secondary line."),
    progress: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Standby progress fill. Standby is a passive surface; producers " +
          "usually mirror the active liveActivity's progress here.",
      ),
    deepLink: deepLinkSchema,
    presentation: liveSurfaceStandbyPresentation
      .default("card")
      .describe(
        "\"card\" for full-color Standby; \"night\" for low-light red-shifted " +
          "rendering.",
      ),
    tint: z
      .enum(["default", "monochrome"])
      .optional()
      .describe(
        "Color treatment hint. \"monochrome\" forces white-on-black for " +
          "accessibility.",
      ),
  })
  .strict();
export type LiveSurfaceStandbySlice = z.infer<typeof liveSurfaceStandbySlice>;

export const liveSurfaceNotificationSlice = z
  .object({
    title: z
      .string()
      .min(1)
      .describe(
        "Notification title. Maps directly to aps.alert.title in the APNs " +
          "envelope.",
      ),
    body: z
      .string()
      .describe("Notification body. Maps directly to aps.alert.body."),
    deepLink: deepLinkSchema,
    category: z
      .string()
      .optional()
      .describe(
        "UNNotificationCategory identifier. Selects which set of action " +
          "buttons the system shows. Maps to aps.category.",
      ),
    threadId: z
      .string()
      .optional()
      .describe(
        "Thread identifier for notification grouping. Maps to aps.thread-id.",
      ),
  })
  .strict();
export type LiveSurfaceNotificationSlice = z.infer<
  typeof liveSurfaceNotificationSlice
>;

// ---------------------------------------------------------------------------
// Minimal base shape: identification + state only.
//
// Every cross-kind rendering field that v3 carried in the base (primaryText,
// secondaryText, modeLabel, contextLabel, statusLine, actionLabel, progress,
// deepLink) moved into per-kind slices for v4. The base only carries fields
// every kind genuinely shares.
// ---------------------------------------------------------------------------
const liveSurfaceSnapshotBaseShape = {
  schemaVersion: z.literal("4").describe(
    "Wire-format generation. Required; producers MUST set this explicitly. " +
      "Consumers parse against the version they understand; cross-version " +
      "payloads are upgraded via migrateV3ToV4 + safeParseAnyVersion before " +
      "parsing.",
  ),
  id: z.string().min(1).describe(
    "Stable, idempotent snapshot identifier. The same logical state produced " +
      "twice MUST yield the same id (e.g. \"<surfaceId>@<revision>\"). " +
      "Consumers use it to deduplicate re-deliveries from APNs and ActivityKit.",
  ),
  surfaceId: z.string().min(1).describe(
    "Identifier for the surface this snapshot updates. One surfaceId is " +
      "rendered by at most one Live Activity / widget timeline / control / " +
      "lock-accessory / standby slot at a time. Maps to the App Group key " +
      "`surface.snapshot.<surfaceId>` and to the per-kind currentSurfaceId " +
      "pointer.",
  ),
  kind: liveSurfaceKind,
  updatedAt: z
    .string()
    .datetime({ offset: true })
    .describe(
      "RFC 3339 instant the snapshot was authored. Consumers compare against " +
        "the previously-applied snapshot's updatedAt to drop out-of-order " +
        "deliveries. UTC (Z-suffixed) recommended for lexicographic " +
        "comparison; offsets accepted for producers emitting OffsetDateTime / " +
        "time.Time / Instant.",
    ),
  state: liveSurfaceState,
} as const;

export const liveSurfaceSnapshotLiveActivity = z
  .object({
    ...liveSurfaceSnapshotBaseShape,
    kind: z.literal("liveActivity"),
    liveActivity: liveSurfaceLiveActivitySlice,
  })
  .strict();
export type LiveSurfaceSnapshotLiveActivity = z.infer<
  typeof liveSurfaceSnapshotLiveActivity
>;

export const liveSurfaceSnapshotWidget = z
  .object({
    ...liveSurfaceSnapshotBaseShape,
    kind: z.literal("widget"),
    widget: liveSurfaceWidgetSlice,
  })
  .strict();
export type LiveSurfaceSnapshotWidget = z.infer<
  typeof liveSurfaceSnapshotWidget
>;

export const liveSurfaceSnapshotControl = z
  .object({
    ...liveSurfaceSnapshotBaseShape,
    kind: z.literal("control"),
    control: liveSurfaceControlSlice,
  })
  .strict();
export type LiveSurfaceSnapshotControl = z.infer<
  typeof liveSurfaceSnapshotControl
>;

export const liveSurfaceSnapshotNotification = z
  .object({
    ...liveSurfaceSnapshotBaseShape,
    kind: z.literal("notification"),
    notification: liveSurfaceNotificationSlice,
  })
  .strict();
export type LiveSurfaceSnapshotNotification = z.infer<
  typeof liveSurfaceSnapshotNotification
>;

export const liveSurfaceSnapshotLockAccessory = z
  .object({
    ...liveSurfaceSnapshotBaseShape,
    kind: z.literal("lockAccessory"),
    lockAccessory: liveSurfaceLockAccessorySlice,
  })
  .strict();
export type LiveSurfaceSnapshotLockAccessory = z.infer<
  typeof liveSurfaceSnapshotLockAccessory
>;

export const liveSurfaceSnapshotStandby = z
  .object({
    ...liveSurfaceSnapshotBaseShape,
    kind: z.literal("standby"),
    standby: liveSurfaceStandbySlice,
  })
  .strict();
export type LiveSurfaceSnapshotStandby = z.infer<
  typeof liveSurfaceSnapshotStandby
>;

// Discriminated union over `kind`. v4 requires `kind` to be set explicitly.
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

// ---------------------------------------------------------------------------
// Projection-output schemas. Each helper in index.ts pairs with one of these
// so drift tests can project every committed fixture, parse the result, and
// fail closed on any divergence.
// ---------------------------------------------------------------------------

export const liveSurfaceActivityContentState = z
  .object({
    headline: z
      .string()
      .describe(
        "ActivityKit ContentState headline. Sourced from liveActivity.title.",
      ),
    subhead: z
      .string()
      .describe(
        "ActivityKit ContentState subhead. Sourced from liveActivity.body.",
      ),
    progress: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Completion ratio forwarded into the ActivityKit progress bar.",
      ),
    stage: liveSurfaceStage.describe(
      "Sub-lifecycle stage forwarded into ActivityKit ContentState.",
    ),
  })
  .strict();
export type LiveSurfaceActivityContentState = z.infer<
  typeof liveSurfaceActivityContentState
>;

export const liveSurfaceWidgetTimelineEntry = z
  .object({
    kind: z.literal("widget"),
    snapshotId: z.string(),
    surfaceId: z.string(),
    state: liveSurfaceState,
    family: z
      .enum(["systemSmall", "systemMedium", "systemLarge"])
      .optional(),
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
    shortText: z.string().optional(),
    gaugeValue: z.number().min(0).max(1).optional(),
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
 * Strict v4 parser. Throws on any payload that does not match the v4
 * discriminated union. Does NOT auto-migrate v3 payloads — for that, use
 * {@link safeParseAnyVersion}.
 */
export function assertSnapshot(value: unknown): LiveSurfaceSnapshot {
  return liveSurfaceSnapshot.parse(value);
}

/**
 * Strict v4 safe-parse. Returns Zod's standard SafeParseReturnType. Does NOT
 * auto-migrate v3 payloads — for that, use {@link safeParseAnyVersion}.
 */
export function safeParseSnapshot(value: unknown) {
  return liveSurfaceSnapshot.safeParse(value);
}

export type SafeParseAnyVersionSuccess = {
  success: true;
  data: LiveSurfaceSnapshot;
  /** Set when the input parsed as v3 and was migrated to v4. */
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
 * Pure v3->v4 transform. Always succeeds for a parsed v3 payload.
 *
 * The base shape's rendering fields (primaryText, secondaryText, modeLabel,
 * contextLabel, statusLine, actionLabel, progress, deepLink) move into the
 * per-kind slice. v3's modeLabel/contextLabel/statusLine on non-liveActivity
 * kinds are dropped because no consumer outside Lock-Screen rendering read
 * them. v3's actionLabel is preserved only as the control slice's `label`
 * (matching v3's projection behavior); on other kinds it is dropped.
 *
 * v3's `progress` on `control` is dropped (the fictional `1` that motivated
 * this refactor). v3's `progress` on `lockAccessory` is also dropped from the
 * wire shape; v4 sources the gauge only from `lockAccessory.gaugeValue`.
 */
export function migrateV3ToV4(v3: LiveSurfaceSnapshotV3): LiveSurfaceSnapshot {
  const base = {
    schemaVersion: "4" as const,
    id: v3.id,
    surfaceId: v3.surfaceId,
    updatedAt: v3.updatedAt,
    state: v3.state,
  };
  switch (v3.kind) {
    case "liveActivity":
      return {
        ...base,
        kind: "liveActivity",
        liveActivity: {
          title: v3.primaryText,
          body: v3.secondaryText,
          progress: v3.progress,
          deepLink: v3.deepLink,
          modeLabel: v3.modeLabel,
          contextLabel: v3.contextLabel,
          statusLine: v3.statusLine,
          ...(v3.actionLabel ? { actionLabel: v3.actionLabel } : {}),
          stage: v3.liveActivity.stage,
          estimatedSeconds: v3.liveActivity.estimatedSeconds,
          morePartsCount: v3.liveActivity.morePartsCount,
        },
      };
    case "widget":
      return {
        ...base,
        kind: "widget",
        widget: {
          title: v3.primaryText,
          body: v3.secondaryText,
          progress: v3.progress,
          deepLink: v3.deepLink,
          ...(v3.widget.family ? { family: v3.widget.family } : {}),
          ...(v3.widget.reloadPolicy
            ? { reloadPolicy: v3.widget.reloadPolicy }
            : {}),
        },
      };
    case "control":
      // primaryText becomes the label fallback; v3's actionLabel takes
      // precedence when non-empty (matches v3 toControlValueProvider behavior).
      return {
        ...base,
        kind: "control",
        control: {
          label: v3.actionLabel?.length ? v3.actionLabel : v3.primaryText,
          deepLink: v3.deepLink,
          controlKind: v3.control.controlKind,
          ...(v3.control.state !== undefined
            ? { state: v3.control.state }
            : {}),
          ...(v3.control.intent ? { intent: v3.control.intent } : {}),
        },
      };
    case "lockAccessory":
      return {
        ...base,
        kind: "lockAccessory",
        lockAccessory: {
          title: v3.primaryText,
          deepLink: v3.deepLink,
          family: v3.lockAccessory.family,
          // v3 fallback from snapshot.progress was a projection-helper
          // concern, not a wire shape. The migration preserves only what was
          // on the wire.
          ...(v3.lockAccessory.gaugeValue !== undefined
            ? { gaugeValue: v3.lockAccessory.gaugeValue }
            : {}),
          ...(v3.lockAccessory.shortText
            ? { shortText: v3.lockAccessory.shortText }
            : {}),
        },
      };
    case "standby":
      return {
        ...base,
        kind: "standby",
        standby: {
          title: v3.primaryText,
          body: v3.secondaryText,
          progress: v3.progress,
          deepLink: v3.deepLink,
          presentation: v3.standby.presentation,
          ...(v3.standby.tint ? { tint: v3.standby.tint } : {}),
        },
      };
    case "notification":
      return {
        ...base,
        kind: "notification",
        notification: {
          title: v3.primaryText,
          body: v3.secondaryText,
          deepLink: v3.deepLink,
          ...(v3.notification.category
            ? { category: v3.notification.category }
            : {}),
          ...(v3.notification.threadId
            ? { threadId: v3.notification.threadId }
            : {}),
        },
      };
  }
}

/**
 * Multi-version safe-parse. Tries v4 (strict) first; on failure, tries v3
 * (frozen) and migrates the result to v4. Returns the v4 ZodError when
 * both attempts fail so callers see the most relevant message.
 *
 * On v3->v4 migration, the result carries a `deprecationWarning` so
 * telemetry can surface producers still on the old shape; see
 * https://mobile-surfaces.com/docs/observability for the recommended log.
 *
 * The v2 codec was dropped at 5.0.0 per the v3 RFC commitment. Consumers
 * still emitting v2 must run their payloads through
 * @mobile-surfaces/surface-contracts@4 to migrate to v3 first, then this
 * package to reach v4.
 */
export function safeParseAnyVersion(value: unknown): SafeParseAnyVersionResult {
  const v4 = liveSurfaceSnapshot.safeParse(value);
  if (v4.success) return { success: true, data: v4.data };

  const v3 = liveSurfaceSnapshotV3.safeParse(value);
  if (v3.success) {
    const migrated = migrateV3ToV4(v3.data);
    const recheck = liveSurfaceSnapshot.safeParse(migrated);
    if (recheck.success) {
      return {
        success: true,
        data: recheck.data,
        deprecationWarning:
          "liveSurfaceSnapshot v3 is deprecated and will be removed in " +
          "@mobile-surfaces/surface-contracts@6.0. Migrate producers to " +
          "schemaVersion \"4\"; the rendering fields moved from the base " +
          "shape into per-kind slices (see schema-migration docs).",
      };
    }
    return { success: false, error: recheck.error };
  }
  // Return v4 error: most relevant to a producer targeting current.
  return { success: false, error: v4.error };
}
