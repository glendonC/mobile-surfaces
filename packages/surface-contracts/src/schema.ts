import { z } from "zod";
import { NOTIFICATION_CATEGORY_IDS } from "./notificationCategories.ts";
import { SCHEMA_VERSION } from "./version.ts";

// ---------------------------------------------------------------------------
// Enums (shared across base, slices, and projection-output schemas).
// Each `.describe()` adds semantic intent beyond the value list, which is
// what an LLM emitting structured output (or a human reading the published
// JSON Schema at unpkg.com/@mobile-surfaces/surface-contracts@6.0/schema.json)
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

export const liveSurfaceInterruptionLevel = z
  .enum(["passive", "active", "timeSensitive", "critical"])
  .describe(
    "iOS aps.interruption-level (iOS 15+). passive = no sound, no banner; " +
      "active (system default) = standard delivery; timeSensitive = breaks " +
      "through Focus modes; critical = bypasses Do Not Disturb (requires " +
      "an Apple-granted entitlement). Omit the field to inherit the system " +
      "default rather than echoing 'active' on the wire.",
  );
export type LiveSurfaceInterruptionLevel = z.infer<
  typeof liveSurfaceInterruptionLevel
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
    subtitle: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Notification subtitle. Maps to aps.alert.subtitle. Renders between " +
          "the title and body on iOS 10+. Empty string is rejected: the " +
          "projection helper drops absent subtitles via a truthy check, so " +
          "an empty string would silently disappear from the wire. Producers " +
          "that want no subtitle should omit the field.",
      ),
    body: z
      .string()
      .describe("Notification body. Maps directly to aps.alert.body."),
    deepLink: deepLinkSchema,
    category: z
      .enum(NOTIFICATION_CATEGORY_IDS)
      .optional()
      .describe(
        "UNNotificationCategory identifier. Selects which set of action " +
          "buttons the system shows AND - when a UNNotificationContentExtension " +
          "is registered - decides whether the extension's custom view renders. " +
          "Maps to aps.category. The set of legal values is the registry in " +
          "packages/surface-contracts/src/notificationCategories.ts; the " +
          "schema rejects values not declared there so the wire stays in " +
          "lockstep with the categories the host registers and the extension " +
          "Info.plist routes on. Producers intending to route into a content " +
          "extension SHOULD validate against liveSurfaceNotificationSliceForExtension " +
          "(category required) instead of the base slice.",
      ),
    threadId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Thread identifier for notification grouping. Maps to aps.thread-id. " +
          "Empty string is rejected: the projection drops absent threadIds via " +
          "a truthy check, so an empty string would silently disappear from the " +
          "wire. Producers that do not want grouping should omit the field.",
      ),
    interruptionLevel: liveSurfaceInterruptionLevel.optional().describe(
      "iOS aps.interruption-level (iOS 15+). Omitted = system default " +
        "(active). Use timeSensitive for notifications that must break " +
        "through Focus modes (e.g. delivery-arrived alerts).",
    ),
    relevanceScore: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "iOS aps.relevance-score (0..1, iOS 15+). Drives ranking inside the " +
          "grouped-summary Notification Center view. Higher = more prominent.",
      ),
    targetContentId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "iOS aps.target-content-id. Routes the tap to a specific scene/" +
          "window identifier the host app advertises via " +
          "UISceneActivationConditions. Empty string is rejected: the " +
          "projection drops an absent value via a truthy check, so an empty " +
          "string would silently disappear from the wire. Omit the field if " +
          "no specific scene/window should be targeted.",
      ),
  })
  .strict();
export type LiveSurfaceNotificationSlice = z.infer<
  typeof liveSurfaceNotificationSlice
>;

/**
 * Producer-side refinement for the notification slice. The base slice keeps
 * `category` optional because plain transactional alerts (no custom UI, no
 * action buttons) do not require it. Producers intending to route into a
 * UNNotificationContentExtension MUST validate outgoing snapshots against
 * this refinement: iOS only invokes the extension when aps.category matches
 * the extension's UNNotificationExtensionCategory Info.plist key, and
 * omitting category silently falls back to the default system chrome.
 *
 * Use at the producer boundary, never at the consumer boundary. Consumers
 * still parse the loose schema and decide routing at runtime.
 */
// Use `.required({ category: true })` rather than `.extend({ category: ... })`
// so the underlying `z.enum(NOTIFICATION_CATEGORY_IDS)` constraint on
// `category` stays load-bearing at the producer boundary. The earlier
// `.extend({ category: z.string().min(1) })` widened the type back to any
// non-empty string, defeating the registry parity guarantee MS037 is built
// on. `.required` flips optional -> required while preserving the enum.
export const liveSurfaceNotificationSliceForExtension =
  liveSurfaceNotificationSlice.required({ category: true });
export type LiveSurfaceNotificationSliceForExtension = z.infer<
  typeof liveSurfaceNotificationSliceForExtension
>;

// ---------------------------------------------------------------------------
// Minimal base shape: identification + state only. Every rendering field
// lives inside its per-kind slice (the move out of the base happened at
// v4); v5 keeps that base unchanged and adds notification-only optional
// fields (subtitle / interruptionLevel / relevanceScore / targetContentId)
// inside the notification slice; see the slice definitions above.
// ---------------------------------------------------------------------------
const liveSurfaceSnapshotBaseShape = {
  schemaVersion: z.literal(SCHEMA_VERSION).describe(
    "Wire-format generation. Required; producers MUST set this explicitly. " +
      "Consumers parse against the version they understand; a payload on a " +
      "different generation fails parse and must be migrated by its producer.",
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
  updatedAt: z.iso
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

// Discriminated union over `kind`. Six variants, one per surface kind.
//
// Standard Schema (https://standardschema.dev) interop is provided automatically
// by Zod 4 via the `~standard` property: `liveSurfaceSnapshot["~standard"]`
// returns `{ vendor: "zod", version: 1, validate, jsonSchema }`. Consumers can
// pass this contract to any Standard-Schema-aware library (Valibot, ArkType,
// `@standard-schema/spec` runners) without depending on Zod at runtime. The
// fixture-validation tests pin this; do not remove the assertion.
export const liveSurfaceSnapshot = z.discriminatedUnion("kind", [
  liveSurfaceSnapshotLiveActivity,
  liveSurfaceSnapshotWidget,
  liveSurfaceSnapshotControl,
  liveSurfaceSnapshotNotification,
  liveSurfaceSnapshotLockAccessory,
  liveSurfaceSnapshotStandby,
]);
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
    schemaVersion: z
      .literal(SCHEMA_VERSION)
      .describe(
        "Wire-format generation. Read by App Group consumers before full decode so a host on a newer schemaVersion than the widget binary expects renders 'needs app update' instead of failing silently (MS041).",
      ),
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
    deepLink: deepLinkSchema,
  })
  .strict();
export type LiveSurfaceWidgetTimelineEntryOutput = z.infer<
  typeof liveSurfaceWidgetTimelineEntry
>;

export const liveSurfaceControlValueProvider = z
  .object({
    schemaVersion: z
      .literal(SCHEMA_VERSION)
      .describe(
        "Wire-format generation. Read by App Group consumers before full decode so a host on a newer schemaVersion than the widget binary expects renders 'needs app update' instead of failing silently (MS041).",
      ),
    kind: z.literal("control"),
    snapshotId: z.string(),
    surfaceId: z.string(),
    controlKind: z.enum(["toggle", "button", "deepLink"]),
    // `value` and `intent` mirror the optional fields on liveSurfaceControlSlice
    // (state, intent). They are omitted, not null, when absent: a "button" or
    // "deepLink" control carries no toggle value, and the absence of the key is
    // the signal. Modeling them as required-but-nullable would erase the
    // distinction between "toggle is off" (value: false) and "not a toggle"
    // (no value), forcing consumers to also branch on controlKind to recover it.
    value: z.boolean().optional(),
    intent: z.string().optional(),
    label: z.string().min(1),
    deepLink: deepLinkSchema,
  })
  .strict();
export type LiveSurfaceControlValueProviderOutput = z.infer<
  typeof liveSurfaceControlValueProvider
>;

export const liveSurfaceLockAccessoryEntry = z
  .object({
    schemaVersion: z
      .literal(SCHEMA_VERSION)
      .describe(
        "Wire-format generation. Read by App Group consumers before full decode so a host on a newer schemaVersion than the widget binary expects renders 'needs app update' instead of failing silently (MS041).",
      ),
    kind: z.literal("lockAccessory"),
    snapshotId: z.string(),
    surfaceId: z.string(),
    state: liveSurfaceState,
    family: liveSurfaceLockAccessoryFamily,
    headline: z.string(),
    shortText: z.string().optional(),
    gaugeValue: z.number().min(0).max(1).optional(),
    deepLink: deepLinkSchema,
  })
  .strict();
export type LiveSurfaceLockAccessoryEntryOutput = z.infer<
  typeof liveSurfaceLockAccessoryEntry
>;

export const liveSurfaceStandbyEntry = z
  .object({
    schemaVersion: z
      .literal(SCHEMA_VERSION)
      .describe(
        "Wire-format generation. Read by App Group consumers before full decode so a host on a newer schemaVersion than the widget binary expects renders 'needs app update' instead of failing silently (MS041).",
      ),
    kind: z.literal("standby"),
    snapshotId: z.string(),
    surfaceId: z.string(),
    state: liveSurfaceState,
    presentation: liveSurfaceStandbyPresentation,
    // `tint` mirrors the optional field on liveSurfaceStandbySlice: omitted,
    // not null, when the producer states no preference. See the value/intent
    // note on liveSurfaceControlValueProvider for the omit-not-null rationale.
    tint: z.enum(["default", "monochrome"]).optional(),
    headline: z.string(),
    subhead: z.string(),
    progress: z.number().min(0).max(1),
    deepLink: deepLinkSchema,
  })
  .strict();
export type LiveSurfaceStandbyEntryOutput = z.infer<
  typeof liveSurfaceStandbyEntry
>;

/**
 * Sidecar block inside the notification APNs payload's `liveSurface` field.
 * Hoisted out of the envelope so MS036's generate-surface-swift gate can
 * target it directly and so a Codable mirror on the on-device extension can
 * decode `notification.request.content.userInfo.liveSurface` against the
 * same shape the wire emits.
 *
 * The `kind: "surface_snapshot"` literal aligns with the liveActivity alert
 * payload's sidecar discriminator (`liveActivityAlertPayload.liveSurface.kind`
 * in `@mobile-surfaces/push`). v4 emitted `"surface_notification"`; v5
 * realigns so on-device routing code can switch on one literal regardless of
 * which Mobile Surfaces wrapper produced the userInfo. The sidecar
 * intentionally carries minimal data; everything else the extension renders
 * (title, body, subtitle, etc.) is available on `notification.request.content`
 * via standard accessors. See `liveSurfaceNotificationContentPayload` for the
 * full envelope.
 */
export const liveSurfaceNotificationContentEntry = z
  .object({
    schemaVersion: z
      .literal(SCHEMA_VERSION)
      .describe(
        "Wire-format generation. Mirrors the envelope-level schemaVersion so the notification-content extension can gate on `userInfo.liveSurface.schemaVersion` directly without having to read a sibling key (MS041). The Codable mirror in the extension reads this field first; a mismatch against EXPECTED_SCHEMA_VERSION renders a 'needs app update' placeholder instead of a half-decoded sidecar.",
      ),
    kind: z.literal("surface_snapshot"),
    snapshotId: z.string(),
    surfaceId: z.string(),
    state: liveSurfaceState,
    deepLink: deepLinkSchema,
    // Deliberately `z.string()`, not the NOTIFICATION_CATEGORY_IDS enum that
    // constrains the input slice (liveSurfaceNotificationSlice.category). This
    // is a projection *output*: its schema exists to catch helper bugs, not to
    // re-validate input. toNotificationContentPayload copies note.category
    // verbatim, and note.category was already enum-checked at the input gate,
    // so the value reaching here is always a registry id by construction.
    // Keeping it `z.string()` also keeps the generated Swift sidecar mirror a
    // plain String rather than a second generated enum coupled to the registry.
    // The asymmetry is intentional; see the projection-invariants test that
    // pins it.
    category: z.string().optional(),
  })
  .strict();
export type LiveSurfaceNotificationContentEntryOutput = z.infer<
  typeof liveSurfaceNotificationContentEntry
>;

export const liveSurfaceNotificationContentPayload = z
  .object({
    schemaVersion: z
      .literal(SCHEMA_VERSION)
      .describe(
        "Wire-format generation. Read by the notification-content extension before sidecar decode so a payload emitted by a newer host than the extension binary expects renders default system chrome instead of a half-decoded custom view (MS041).",
      ),
    aps: z
      .object({
        alert: z
          .object({
            title: z.string(),
            subtitle: z.string().optional(),
            body: z.string(),
          })
          .strict(),
        sound: z.literal("default"),
        category: z.string().optional(),
        "thread-id": z.string().optional(),
        "interruption-level": liveSurfaceInterruptionLevel.optional(),
        "relevance-score": z.number().min(0).max(1).optional(),
        "target-content-id": z.string().optional(),
      })
      .strict(),
    liveSurface: liveSurfaceNotificationContentEntry,
  })
  .strict();
export type LiveSurfaceNotificationContentPayloadOutput = z.infer<
  typeof liveSurfaceNotificationContentPayload
>;

// Derived arrays preserve the older string-list export surface for consumers
// who only need the union members. `.options` on a Zod enum is already a
// typed `readonly` tuple of the literal members, so these are a direct
// re-export with no cast: the previous `as unknown as readonly [...]` form
// hand-duplicated the member list next to the enum it was derived from, which
// is exactly the drift risk the rest of this file is built to avoid. A new
// enum member now propagates here automatically.
export const liveSurfaceStates = liveSurfaceState.options;
export const liveSurfaceStages = liveSurfaceStage.options;
export const liveSurfaceKinds = liveSurfaceKind.options;

/**
 * Strict v5 parser. Throws on any payload that does not match the v5
 * discriminated union. A payload on an older wire generation must be
 * migrated by its producer before it reaches this parser.
 */
export function assertSnapshot(value: unknown): LiveSurfaceSnapshot {
  return liveSurfaceSnapshot.parse(value);
}

/**
 * Strict v5 safe-parse. Returns Zod's standard SafeParseReturnType. A payload
 * on an older wire generation must be migrated by its producer before it
 * reaches this parser.
 */
export function safeParseSnapshot(value: unknown) {
  return liveSurfaceSnapshot.safeParse(value);
}
