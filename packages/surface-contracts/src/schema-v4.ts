// ---------------------------------------------------------------------------
// FROZEN v4 SCHEMA SOURCE - DO NOT EDIT
//
// This file is the v4 LiveSurfaceSnapshot schema, frozen verbatim at the
// boundary between v4 and v5 (package version 5.x -> 6.0.0). It exists so
// safeParseAnyVersion can keep parsing v4 payloads through the entire 6.x
// release line, even as the live schema in ./schema.ts evolves on v5.
//
// HARD RULE: this file MUST NOT import any Zod definitions from ./schema.ts.
// It may import frozen earlier versions (./schema-v3.ts) because those are
// also immutable. Every enum, slice, and snapshot definition v4 depends on
// is duplicated here with a V4 suffix. The duplication is intentional. If a
// v5 edit changes a shared shape, the frozen v4 schema must keep the v4
// behavior so a v4 payload continues to parse the same way it did at 5.x.
//
// The file will be removed in 8.0.0, when the v4 codec is dropped from
// safeParseAnyVersion. The versioning charter (see
// apps/site/src/content/docs/stability.md) guarantees one full major of
// warning between deprecation announcement and codec removal; v4 ages out
// alongside v3 at 8.0. Do not extend it; if a future change to v4 parsing
// is needed,
// the change is by definition a new schema version.
//
// What v5 changes vs v4 (so a future reader knows why the migration exists):
// 1. The notification slice gained four optional fields - subtitle,
//    interruptionLevel, relevanceScore, targetContentId - mapping to iOS
//    aps keys (aps.alert.subtitle, aps.interruption-level,
//    aps.relevance-score, aps.target-content-id). All additive.
// 2. The notification projection-output sidecar (inside
//    liveSurfaceNotificationContentPayload.liveSurface) renamed its
//    discriminator from "surface_notification" to "surface_snapshot",
//    aligning with the liveActivity alert payload's sidecar discriminator.
//    This is a projection-output change only; the snapshot wire shape is
//    unaffected, so the v4->v5 migration is a pure passthrough of the
//    snapshot.
// ---------------------------------------------------------------------------

import { z } from "zod";
import {
  liveSurfaceSnapshotV3,
  type LiveSurfaceSnapshotV3,
} from "./schema-v3.ts";

export { liveSurfaceSnapshotV3, type LiveSurfaceSnapshotV3 };

const liveSurfaceStateV4 = z.enum([
  "queued",
  "active",
  "paused",
  "attention",
  "bad_timing",
  "completed",
]);

const liveSurfaceStageV4 = z.enum(["prompted", "inProgress", "completing"]);

const liveSurfaceKindV4 = z.enum([
  "liveActivity",
  "widget",
  "control",
  "lockAccessory",
  "standby",
  "notification",
]);

const liveSurfaceLockAccessoryFamilyV4 = z.enum([
  "accessoryCircular",
  "accessoryRectangular",
  "accessoryInline",
]);

const liveSurfaceStandbyPresentationV4 = z.enum(["card", "night"]);

const deepLinkSchemaV4 = z.string().regex(/^[a-z][a-z0-9+\-.]*:\/\//);

const liveSurfaceLiveActivitySliceV4 = z
  .object({
    title: z.string().min(1),
    body: z.string(),
    progress: z.number().min(0).max(1),
    deepLink: deepLinkSchemaV4,
    modeLabel: z.string().min(1),
    contextLabel: z.string(),
    statusLine: z.string(),
    actionLabel: z.string().min(1).optional(),
    stage: liveSurfaceStageV4,
    estimatedSeconds: z.int().min(0),
    morePartsCount: z.int().min(0),
  })
  .strict();

const liveSurfaceWidgetSliceV4 = z
  .object({
    title: z.string().min(1),
    body: z.string(),
    progress: z.number().min(0).max(1),
    deepLink: deepLinkSchemaV4,
    family: z.enum(["systemSmall", "systemMedium", "systemLarge"]).optional(),
    reloadPolicy: z.enum(["manual", "afterDate"]).optional(),
  })
  .strict();

const liveSurfaceControlSliceV4 = z
  .object({
    label: z.string().min(1),
    deepLink: deepLinkSchemaV4,
    controlKind: z.enum(["toggle", "button", "deepLink"]),
    state: z.boolean().optional(),
    intent: z.string().optional(),
  })
  .strict();

const liveSurfaceLockAccessorySliceV4 = z
  .object({
    title: z.string().min(1),
    deepLink: deepLinkSchemaV4,
    family: liveSurfaceLockAccessoryFamilyV4,
    gaugeValue: z.number().min(0).max(1).optional(),
    shortText: z.string().max(20).optional(),
  })
  .strict();

const liveSurfaceStandbySliceV4 = z
  .object({
    title: z.string().min(1),
    body: z.string(),
    progress: z.number().min(0).max(1),
    deepLink: deepLinkSchemaV4,
    presentation: liveSurfaceStandbyPresentationV4.default("card"),
    tint: z.enum(["default", "monochrome"]).optional(),
  })
  .strict();

const liveSurfaceNotificationSliceV4 = z
  .object({
    title: z.string().min(1),
    body: z.string(),
    deepLink: deepLinkSchemaV4,
    category: z.string().optional(),
    threadId: z.string().optional(),
  })
  .strict();

const liveSurfaceSnapshotBaseShapeV4 = {
  schemaVersion: z.literal("4"),
  id: z.string().min(1),
  surfaceId: z.string().min(1),
  kind: liveSurfaceKindV4,
  updatedAt: z.string().datetime({ offset: true }),
  state: liveSurfaceStateV4,
} as const;

const liveSurfaceSnapshotLiveActivityV4 = z
  .object({
    ...liveSurfaceSnapshotBaseShapeV4,
    kind: z.literal("liveActivity"),
    liveActivity: liveSurfaceLiveActivitySliceV4,
  })
  .strict();

const liveSurfaceSnapshotWidgetV4 = z
  .object({
    ...liveSurfaceSnapshotBaseShapeV4,
    kind: z.literal("widget"),
    widget: liveSurfaceWidgetSliceV4,
  })
  .strict();

const liveSurfaceSnapshotControlV4 = z
  .object({
    ...liveSurfaceSnapshotBaseShapeV4,
    kind: z.literal("control"),
    control: liveSurfaceControlSliceV4,
  })
  .strict();

const liveSurfaceSnapshotNotificationV4 = z
  .object({
    ...liveSurfaceSnapshotBaseShapeV4,
    kind: z.literal("notification"),
    notification: liveSurfaceNotificationSliceV4,
  })
  .strict();

const liveSurfaceSnapshotLockAccessoryV4 = z
  .object({
    ...liveSurfaceSnapshotBaseShapeV4,
    kind: z.literal("lockAccessory"),
    lockAccessory: liveSurfaceLockAccessorySliceV4,
  })
  .strict();

const liveSurfaceSnapshotStandbyV4 = z
  .object({
    ...liveSurfaceSnapshotBaseShapeV4,
    kind: z.literal("standby"),
    standby: liveSurfaceStandbySliceV4,
  })
  .strict();

export const liveSurfaceSnapshotV4 = z.lazy(() =>
  z.discriminatedUnion("kind", [
    liveSurfaceSnapshotLiveActivityV4,
    liveSurfaceSnapshotWidgetV4,
    liveSurfaceSnapshotControlV4,
    liveSurfaceSnapshotNotificationV4,
    liveSurfaceSnapshotLockAccessoryV4,
    liveSurfaceSnapshotStandbyV4,
  ]),
);
export type LiveSurfaceSnapshotV4 = z.infer<typeof liveSurfaceSnapshotV4>;

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
export function migrateV3ToV4(
  v3: LiveSurfaceSnapshotV3,
): LiveSurfaceSnapshotV4 {
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
