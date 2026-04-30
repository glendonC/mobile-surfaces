import {
  surfaceFixtureSnapshots,
  toLiveActivityContentState,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

type LiveActivityFixture = LiveSurfaceSnapshot & { kind: "liveActivity" };

const liveActivityEntries = Object.entries(surfaceFixtureSnapshots).filter(
  ([, snapshot]) => snapshot.kind === "liveActivity",
) as Array<[string, LiveActivityFixture]>;

export const surfaceFixtures = Object.fromEntries(liveActivityEntries) as Record<
  string,
  LiveActivityFixture
>;

export const activityFixtureStates = Object.fromEntries(
  Object.entries(surfaceFixtures).map(([key, snapshot]) => [
    key,
    toLiveActivityContentState(snapshot),
  ]),
) as Record<keyof typeof surfaceFixtures, ReturnType<typeof toLiveActivityContentState>>;
