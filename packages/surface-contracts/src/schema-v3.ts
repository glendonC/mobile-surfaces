// ---------------------------------------------------------------------------
// FROZEN v3 SCHEMA SOURCE - DO NOT EDIT
//
// This file is the v3 LiveSurfaceSnapshot schema, frozen verbatim at the
// boundary between v3 and v4 (package version 4.x -> 5.0.0). It exists so
// safeParseAnyVersion can keep parsing v3 payloads through the entire 5.x
// release line, even as the live schema in ./schema.ts evolves on v4.
//
// HARD RULE: this file MUST NOT import any Zod definitions from ./schema.ts.
// Every enum, slice, and type definition that v3 depends on is duplicated
// here. The duplication is intentional. If a v4 edit changes a shared
// shape, the frozen v3 schema must keep the v3 behavior so a v3 payload
// continues to parse the same way it did at 4.x.
//
// The file will be removed in 8.0.0, when the v3 codec is dropped from
// safeParseAnyVersion. The original v2 RFC promised retirement at 6.0; the
// versioning charter (see apps/site/src/content/docs/stability.md) instead
// guarantees one full major of warning between deprecation announcement and
// codec removal, so v3 retirement is pushed to 8.0 to honor that. Do not
// extend it; if a future change to v3 parsing is needed,
// the change is by definition a new schema version.
//
// What v4 changes vs v3: the base shape lost its kind-specific rendering
// fields (primaryText, secondaryText, modeLabel, contextLabel, statusLine,
// actionLabel, progress, deepLink). Each per-kind slice now carries its own
// rendering set. The notification slice renames primaryText/secondaryText to
// title/body. The control slice gains a required `label`. v3's `progress`
// on control (fictional) and `progress` on lockAccessory (only a projection-
// fallback source) are dropped from the wire shape. v3's `.default("3")` on
// schemaVersion is preserved here verbatim so producers that historically
// relied on the default keep parsing through the v3 path.
// ---------------------------------------------------------------------------

import { z } from "zod";

const liveSurfaceStateV3 = z.enum([
  "queued",
  "active",
  "paused",
  "attention",
  "bad_timing",
  "completed",
]);

const liveSurfaceStageV3 = z.enum([
  "prompted",
  "inProgress",
  "completing",
]);

const liveSurfaceWidgetSliceV3 = z
  .object({
    family: z.enum(["systemSmall", "systemMedium", "systemLarge"]).optional(),
    reloadPolicy: z.enum(["manual", "afterDate"]).optional(),
  })
  .strict();

// v3's control slice: inner field renamed from v2's `kind` to `controlKind`
// to stop shadowing the outer discriminator. Frozen here for v3 payloads.
const liveSurfaceControlSliceV3 = z
  .object({
    controlKind: z.enum(["toggle", "button", "deepLink"]),
    state: z.boolean().optional(),
    intent: z.string().optional(),
  })
  .strict();

const liveSurfaceNotificationSliceV3 = z
  .object({
    category: z.string().optional(),
    threadId: z.string().optional(),
  })
  .strict();

const liveSurfaceLockAccessoryFamilyV3 = z.enum([
  "accessoryCircular",
  "accessoryRectangular",
  "accessoryInline",
]);

const liveSurfaceLockAccessorySliceV3 = z
  .object({
    family: liveSurfaceLockAccessoryFamilyV3,
    gaugeValue: z.number().min(0).max(1).optional(),
    shortText: z.string().max(20).optional(),
  })
  .strict();

const liveSurfaceStandbyPresentationV3 = z.enum(["card", "night"]);

const liveSurfaceStandbySliceV3 = z
  .object({
    presentation: liveSurfaceStandbyPresentationV3.default("card"),
    tint: z.enum(["default", "monochrome"]).optional(),
  })
  .strict();

const liveSurfaceLiveActivitySliceV3 = z
  .object({
    stage: liveSurfaceStageV3,
    estimatedSeconds: z.int().min(0),
    morePartsCount: z.int().min(0),
  })
  .strict();

// v3 base shape. schemaVersion literal "3" with .default("3") preserved
// from the v3 released behavior; v4 drops the default but the frozen file
// must not retroactively tighten v3 parsing.
const liveSurfaceSnapshotBaseShapeV3 = {
  schemaVersion: z.literal("3").default("3"),
  id: z.string().min(1),
  surfaceId: z.string().min(1),
  updatedAt: z.string().datetime({ offset: true }),
  state: liveSurfaceStateV3,
  modeLabel: z.string().min(1),
  contextLabel: z.string(),
  statusLine: z.string(),
  primaryText: z.string().min(1),
  secondaryText: z.string(),
  actionLabel: z.string().optional(),
  progress: z.number().min(0).max(1),
  deepLink: z.string().regex(/^[a-z][a-z0-9+\-.]*:\/\//),
} as const;

const liveSurfaceSnapshotLiveActivityV3 = z
  .object({
    kind: z.literal("liveActivity"),
    ...liveSurfaceSnapshotBaseShapeV3,
    liveActivity: liveSurfaceLiveActivitySliceV3,
  })
  .strict();

const liveSurfaceSnapshotWidgetV3 = z
  .object({
    kind: z.literal("widget"),
    ...liveSurfaceSnapshotBaseShapeV3,
    widget: liveSurfaceWidgetSliceV3,
  })
  .strict();

const liveSurfaceSnapshotControlV3 = z
  .object({
    kind: z.literal("control"),
    ...liveSurfaceSnapshotBaseShapeV3,
    control: liveSurfaceControlSliceV3,
  })
  .strict();

const liveSurfaceSnapshotNotificationV3 = z
  .object({
    kind: z.literal("notification"),
    ...liveSurfaceSnapshotBaseShapeV3,
    notification: liveSurfaceNotificationSliceV3,
  })
  .strict();

const liveSurfaceSnapshotLockAccessoryV3 = z
  .object({
    kind: z.literal("lockAccessory"),
    ...liveSurfaceSnapshotBaseShapeV3,
    lockAccessory: liveSurfaceLockAccessorySliceV3,
  })
  .strict();

const liveSurfaceSnapshotStandbyV3 = z
  .object({
    kind: z.literal("standby"),
    ...liveSurfaceSnapshotBaseShapeV3,
    standby: liveSurfaceStandbySliceV3,
  })
  .strict();

// v3's discriminated union. Like v2 it requires `kind` to be set explicitly.
export const liveSurfaceSnapshotV3 = z.discriminatedUnion("kind", [
  liveSurfaceSnapshotLiveActivityV3,
  liveSurfaceSnapshotWidgetV3,
  liveSurfaceSnapshotControlV3,
  liveSurfaceSnapshotNotificationV3,
  liveSurfaceSnapshotLockAccessoryV3,
  liveSurfaceSnapshotStandbyV3,
]);

export type LiveSurfaceSnapshotV3 = z.infer<typeof liveSurfaceSnapshotV3>;
