// ---------------------------------------------------------------------------
// FROZEN v2 SCHEMA SOURCE - DO NOT EDIT
//
// This file is the v2 LiveSurfaceSnapshot schema, frozen verbatim at the
// boundary between v2 and v3 (package version 3.2.0 -> 4.0.0). It exists
// so safeParseAnyVersion can keep parsing v2 payloads through the entire
// 4.x release line, even as the live schema in ./schema.ts evolves on v3.
//
// HARD RULE: this file MUST NOT import any Zod definitions from ./schema.ts.
// Every enum, slice, and type definition that v2 depends on is duplicated
// here. The duplication is intentional. If a v3 edit changes a shared
// shape, the frozen v2 schema must keep the v2 behavior so a v2 payload
// continues to parse the same way it did at 3.2.0.
//
// The file will be removed in 5.0.0, when the v2 codec is dropped from
// safeParseAnyVersion (same lifetime promise the v1 codec had through
// the 3.x line). Do not extend it; if a future change to v2 parsing is
// needed, the change is by definition a new schema version (v4).
//
// What v3 changes vs v2: the inner field on the control slice was
// renamed from `kind` to `controlKind` to stop shadowing the outer
// discriminator (controlSnap.kind === "control" vs
// controlSnap.control.kind === "toggle"). Every other field is identical.
// ---------------------------------------------------------------------------

import { z } from "zod";

const liveSurfaceStateV2 = z.enum([
  "queued",
  "active",
  "paused",
  "attention",
  "bad_timing",
  "completed",
]);

const liveSurfaceStageV2 = z.enum([
  "prompted",
  "inProgress",
  "completing",
]);

const liveSurfaceWidgetSliceV2 = z
  .object({
    family: z.enum(["systemSmall", "systemMedium", "systemLarge"]).optional(),
    reloadPolicy: z.enum(["manual", "afterDate"]).optional(),
  })
  .strict();

// v2's control slice: inner `kind` shadowing the outer discriminator.
// Frozen here for v2 payloads; v3's liveSurfaceControlSlice in schema.ts
// renames this field to `controlKind`.
const liveSurfaceControlSliceV2 = z
  .object({
    kind: z.enum(["toggle", "button", "deepLink"]),
    state: z.boolean().optional(),
    intent: z.string().optional(),
  })
  .strict();

const liveSurfaceNotificationSliceV2 = z
  .object({
    category: z.string().optional(),
    threadId: z.string().optional(),
  })
  .strict();

const liveSurfaceLockAccessoryFamilyV2 = z.enum([
  "accessoryCircular",
  "accessoryRectangular",
  "accessoryInline",
]);

const liveSurfaceLockAccessorySliceV2 = z
  .object({
    family: liveSurfaceLockAccessoryFamilyV2,
    gaugeValue: z.number().min(0).max(1).optional(),
    shortText: z.string().max(20).optional(),
  })
  .strict();

const liveSurfaceStandbyPresentationV2 = z.enum(["card", "night"]);

const liveSurfaceStandbySliceV2 = z
  .object({
    presentation: liveSurfaceStandbyPresentationV2.default("card"),
    tint: z.enum(["default", "monochrome"]).optional(),
  })
  .strict();

const liveSurfaceLiveActivitySliceV2 = z
  .object({
    stage: liveSurfaceStageV2,
    estimatedSeconds: z.int().min(0),
    morePartsCount: z.int().min(0),
  })
  .strict();

// v2 base shape: updatedAt required, no stage/estimatedSeconds/morePartsCount
// (those live in the liveActivity slice). schemaVersion literal "2".
const liveSurfaceSnapshotBaseShapeV2 = {
  schemaVersion: z.literal("2").default("2"),
  id: z.string().min(1),
  surfaceId: z.string().min(1),
  updatedAt: z.string().datetime({ offset: true }),
  state: liveSurfaceStateV2,
  modeLabel: z.string().min(1),
  contextLabel: z.string(),
  statusLine: z.string(),
  primaryText: z.string().min(1),
  secondaryText: z.string(),
  actionLabel: z.string().optional(),
  progress: z.number().min(0).max(1),
  deepLink: z.string().regex(/^[a-z][a-z0-9+\-.]*:\/\//),
} as const;

const liveSurfaceSnapshotLiveActivityV2 = z
  .object({
    kind: z.literal("liveActivity"),
    ...liveSurfaceSnapshotBaseShapeV2,
    liveActivity: liveSurfaceLiveActivitySliceV2,
  })
  .strict();

const liveSurfaceSnapshotWidgetV2 = z
  .object({
    kind: z.literal("widget"),
    ...liveSurfaceSnapshotBaseShapeV2,
    widget: liveSurfaceWidgetSliceV2,
  })
  .strict();

const liveSurfaceSnapshotControlV2 = z
  .object({
    kind: z.literal("control"),
    ...liveSurfaceSnapshotBaseShapeV2,
    control: liveSurfaceControlSliceV2,
  })
  .strict();

const liveSurfaceSnapshotNotificationV2 = z
  .object({
    kind: z.literal("notification"),
    ...liveSurfaceSnapshotBaseShapeV2,
    notification: liveSurfaceNotificationSliceV2,
  })
  .strict();

const liveSurfaceSnapshotLockAccessoryV2 = z
  .object({
    kind: z.literal("lockAccessory"),
    ...liveSurfaceSnapshotBaseShapeV2,
    lockAccessory: liveSurfaceLockAccessorySliceV2,
  })
  .strict();

const liveSurfaceSnapshotStandbyV2 = z
  .object({
    kind: z.literal("standby"),
    ...liveSurfaceSnapshotBaseShapeV2,
    standby: liveSurfaceStandbySliceV2,
  })
  .strict();

// v2's discriminated union. v2 already requires `kind` to be set explicitly
// (the v1 missing-kind preprocess was removed at the v1->v2 boundary), so
// there's no preprocess shim here either.
export const liveSurfaceSnapshotV2 = z.discriminatedUnion("kind", [
  liveSurfaceSnapshotLiveActivityV2,
  liveSurfaceSnapshotWidgetV2,
  liveSurfaceSnapshotControlV2,
  liveSurfaceSnapshotNotificationV2,
  liveSurfaceSnapshotLockAccessoryV2,
  liveSurfaceSnapshotStandbyV2,
]);

export type LiveSurfaceSnapshotV2 = z.infer<typeof liveSurfaceSnapshotV2>;
