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

export const liveSurfaceSnapshot = z
  .object({
    schemaVersion: z.literal("0").default("0"),
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

export function assertSnapshot(value: unknown): LiveSurfaceSnapshot {
  return liveSurfaceSnapshot.parse(value);
}

export function safeParseSnapshot(value: unknown) {
  return liveSurfaceSnapshot.safeParse(value);
}
