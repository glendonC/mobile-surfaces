// ---------------------------------------------------------------------------
// FROZEN v1 SCHEMA SOURCE - DO NOT EDIT
//
// This file is the v1 LiveSurfaceSnapshot schema, frozen verbatim at the
// boundary between v1 and v2 (2026-05-12, package version 2.1.1). It exists
// so safeParseAnyVersion can keep parsing v1 payloads through the entire
// 3.x release line, even as the live schema in ./schema.ts evolves on v2.
//
// HARD RULE: this file MUST NOT import any Zod definitions from ./schema.ts.
// Every enum, slice, and type definition that v1 depends on is duplicated
// here. The duplication is intentional. If a v2 edit changes a shared
// shape, the frozen v1 schema must keep the v1 behavior so a v1 payload
// continues to parse the same way it did at 2.1.1.
//
// The file is removed in 4.0.0, when the v1 codec is dropped from
// safeParseAnyVersion. Do not extend it; if a future change to v1 parsing
// is needed, the change is by definition a new schema version (v3).
//
// Reconstructed by reading packages/surface-contracts/src/schema.ts at
// commit 2e45117 (post-Phase A; updatedAt optional). See notes/v2-schema-rfc.md
// for the surrounding context and confirmed decisions.
// ---------------------------------------------------------------------------

import { z } from "zod";

const liveSurfaceStateV1 = z.enum([
  "queued",
  "active",
  "paused",
  "attention",
  "bad_timing",
  "completed",
]);

const liveSurfaceStageV1 = z.enum([
  "prompted",
  "inProgress",
  "completing",
]);

const liveSurfaceWidgetSliceV1 = z
  .object({
    family: z.enum(["systemSmall", "systemMedium", "systemLarge"]).optional(),
    reloadPolicy: z.enum(["manual", "afterDate"]).optional(),
  })
  .strict();

const liveSurfaceControlSliceV1 = z
  .object({
    kind: z.enum(["toggle", "button", "deepLink"]),
    state: z.boolean().optional(),
    intent: z.string().optional(),
  })
  .strict();

const liveSurfaceNotificationSliceV1 = z
  .object({
    category: z.string().optional(),
    threadId: z.string().optional(),
  })
  .strict();

const liveSurfaceLockAccessoryFamilyV1 = z.enum([
  "accessoryCircular",
  "accessoryRectangular",
  "accessoryInline",
]);

const liveSurfaceLockAccessorySliceV1 = z
  .object({
    family: liveSurfaceLockAccessoryFamilyV1,
    gaugeValue: z.number().min(0).max(1).optional(),
    shortText: z.string().max(20).optional(),
  })
  .strict();

const liveSurfaceStandbyPresentationV1 = z.enum(["card", "night"]);

const liveSurfaceStandbySliceV1 = z
  .object({
    presentation: liveSurfaceStandbyPresentationV1.default("card"),
    tint: z.enum(["default", "monochrome"]).optional(),
  })
  .strict();

// v1 base shape: stage, estimatedSeconds, morePartsCount, progress all live
// in the base (and apply to every kind). v2 moves the first three into the
// liveActivity slice; the frozen copy here preserves the v1 placement.
//
// updatedAt is optional in v1 (added in Phase A as an additive field);
// v2 promotes it to required.
const liveSurfaceSnapshotBaseShapeV1 = {
  schemaVersion: z.literal("1").default("1"),
  id: z.string().min(1),
  surfaceId: z.string().min(1),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  state: liveSurfaceStateV1,
  modeLabel: z.string().min(1),
  contextLabel: z.string(),
  statusLine: z.string(),
  primaryText: z.string().min(1),
  secondaryText: z.string(),
  actionLabel: z.string().optional(),
  estimatedSeconds: z.int().min(0),
  morePartsCount: z.int().min(0),
  progress: z.number().min(0).max(1),
  stage: liveSurfaceStageV1,
  deepLink: z.string().regex(/^[a-z][a-z0-9+\-.]*:\/\//),
} as const;

const liveSurfaceSnapshotLiveActivityV1 = z
  .object({
    kind: z.literal("liveActivity"),
    ...liveSurfaceSnapshotBaseShapeV1,
  })
  .strict();

const liveSurfaceSnapshotWidgetV1 = z
  .object({
    kind: z.literal("widget"),
    ...liveSurfaceSnapshotBaseShapeV1,
    widget: liveSurfaceWidgetSliceV1,
  })
  .strict();

const liveSurfaceSnapshotControlV1 = z
  .object({
    kind: z.literal("control"),
    ...liveSurfaceSnapshotBaseShapeV1,
    control: liveSurfaceControlSliceV1,
  })
  .strict();

const liveSurfaceSnapshotNotificationV1 = z
  .object({
    kind: z.literal("notification"),
    ...liveSurfaceSnapshotBaseShapeV1,
    notification: liveSurfaceNotificationSliceV1,
  })
  .strict();

const liveSurfaceSnapshotLockAccessoryV1 = z
  .object({
    kind: z.literal("lockAccessory"),
    ...liveSurfaceSnapshotBaseShapeV1,
    lockAccessory: liveSurfaceLockAccessorySliceV1,
  })
  .strict();

const liveSurfaceSnapshotStandbyV1 = z
  .object({
    kind: z.literal("standby"),
    ...liveSurfaceSnapshotBaseShapeV1,
    standby: liveSurfaceStandbySliceV1,
  })
  .strict();

// v1's discriminated union, including the missing-kind preprocess that
// defaulted bare snapshots to liveActivity. v2 drops the preprocess; keep
// it here so v1 payloads authored against the looser shape still parse.
export const liveSurfaceSnapshotV1 = z.preprocess(
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
    liveSurfaceSnapshotLiveActivityV1,
    liveSurfaceSnapshotWidgetV1,
    liveSurfaceSnapshotControlV1,
    liveSurfaceSnapshotNotificationV1,
    liveSurfaceSnapshotLockAccessoryV1,
    liveSurfaceSnapshotStandbyV1,
  ]),
);

export type LiveSurfaceSnapshotV1 = z.infer<typeof liveSurfaceSnapshotV1>;
