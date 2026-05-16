// ---------------------------------------------------------------------------
// FROZEN v4 SCHEMA SOURCE - DO NOT EDIT
//
// This file is the v4 LiveSurfaceSnapshot schema, frozen verbatim at the
// boundary between v4 and v5 (package version 5.x -> 6.0.0). It exists so
// safeParseAnyVersion can keep parsing v4 payloads through the 7.x and 8.x
// release lines, even as the live schema in ./schema.ts evolves on v5.
//
// HARD RULE: this file MUST NOT import any Zod definitions from ./schema.ts.
// Every enum, slice, and snapshot definition v4 depends on is duplicated
// here with a V4 suffix. The duplication is intentional. If a v5 edit
// changes a shared shape, the frozen v4 schema must keep the v4 behavior
// so a v4 payload continues to parse the same way it did at 5.x.
//
// The file will be removed in 9.0.0, when the v4 codec is dropped from
// safeParseAnyVersion. The versioning charter (see
// apps/site/src/content/docs/stability.md) guarantees one full major of
// warning between deprecation announcement and codec removal; v4 was
// deprecated when v5 shipped and ages out one major past v3's retirement
// (v3 retired at 8.0). Do not extend it; if a future change to v4 parsing
// is needed, the change is by definition a new schema version.
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

