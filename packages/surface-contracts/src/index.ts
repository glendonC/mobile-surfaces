import schema from "../schema.json";

export const liveSurfaceStates = schema.liveSurfaceStates as unknown as readonly [
  "queued",
  "active",
  "paused",
  "attention",
  "bad_timing",
  "completed",
];

export type LiveSurfaceState = (typeof liveSurfaceStates)[number];

export const liveSurfaceStages = schema.liveSurfaceStages as unknown as readonly [
  "prompted",
  "inProgress",
  "completing",
];

export type LiveSurfaceStage = (typeof liveSurfaceStages)[number];

export type LiveSurfaceColorIntent =
  | "primary"
  | "accent"
  | "success"
  | "warning"
  | "muted";

export interface LiveSurfaceSnapshot {
  id: string;
  surfaceId: string;
  state: LiveSurfaceState;
  modeLabel: string;
  contextLabel: string;
  statusLine: string;
  primaryText: string;
  secondaryText: string;
  actionLabel?: string;
  estimatedSeconds: number;
  morePartsCount: number;
  progress: number;
  stage: LiveSurfaceStage;
  colorIntent: LiveSurfaceColorIntent;
  deepLink: string;
}

export interface LiveSurfaceActivityContentState {
  headline: string;
  subhead: string;
  progress: number;
  stage: LiveSurfaceStage;
}

export interface LiveSurfaceAlertPayload {
  aps: {
    alert: {
      title: string;
      body: string;
    };
    sound?: "default";
  };
  liveSurface: {
    kind: "surface_snapshot";
    snapshotId: string;
    surfaceId: string;
    state: LiveSurfaceState;
    deepLink: string;
  };
}

export function toLiveActivityContentState(
  snapshot: LiveSurfaceSnapshot,
): LiveSurfaceActivityContentState {
  return {
    headline: snapshot.primaryText,
    subhead: snapshot.secondaryText,
    progress: snapshot.progress,
    stage: snapshot.stage,
  };
}

export function toLiveActivityModeLabel(snapshot: LiveSurfaceSnapshot): string {
  return snapshot.modeLabel;
}

export function toAlertPayload(snapshot: LiveSurfaceSnapshot): LiveSurfaceAlertPayload {
  return {
    aps: {
      alert: {
        title: snapshot.primaryText,
        body: snapshot.secondaryText,
      },
      sound: "default",
    },
    liveSurface: {
      kind: "surface_snapshot",
      snapshotId: snapshot.id,
      surfaceId: snapshot.surfaceId,
      state: snapshot.state,
      deepLink: snapshot.deepLink,
    },
  };
}

export { surfaceFixtureSnapshots } from "./fixtures";
