export {
  liveSurfaceSnapshot,
  liveSurfaceState,
  liveSurfaceStage,
  liveSurfaceActivityContentState,
  liveSurfaceAlertPayload,
  liveSurfaceStates,
  liveSurfaceStages,
  assertSnapshot,
  safeParseSnapshot,
} from "./schema.js";
export type {
  LiveSurfaceSnapshot,
  LiveSurfaceState,
  LiveSurfaceStage,
  LiveSurfaceActivityContentState,
  LiveSurfaceAlertPayload,
} from "./schema.js";

import type {
  LiveSurfaceSnapshot,
  LiveSurfaceActivityContentState,
  LiveSurfaceAlertPayload,
} from "./schema.js";

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

export { surfaceFixtureSnapshots } from "./fixtures.js";
