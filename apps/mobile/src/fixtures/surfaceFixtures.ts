import {
  surfaceFixtureSnapshots,
  toLiveActivityContentState,
} from "@mobile-surfaces/surface-contracts";

export const surfaceFixtures = surfaceFixtureSnapshots;

export const activityFixtureStates = Object.fromEntries(
  Object.entries(surfaceFixtures).map(([key, snapshot]) => [
    key,
    toLiveActivityContentState(snapshot),
  ]),
) as Record<keyof typeof surfaceFixtures, ReturnType<typeof toLiveActivityContentState>>;
