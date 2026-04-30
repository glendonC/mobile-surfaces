import {
  surfaceFixtureSnapshots,
  toControlValueProvider,
  toLiveActivityContentState,
  toWidgetTimelineEntry,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

type LiveActivityFixture = LiveSurfaceSnapshot & { kind: "liveActivity" };
type WidgetFixture = LiveSurfaceSnapshot & { kind: "widget" };
type ControlFixture = LiveSurfaceSnapshot & { kind: "control" };

const liveActivityEntries = Object.entries(surfaceFixtureSnapshots).filter(
  ([, snapshot]) => snapshot.kind === "liveActivity",
) as Array<[string, LiveActivityFixture]>;

export const surfaceFixtures = Object.fromEntries(liveActivityEntries) as Record<
  string,
  LiveActivityFixture
>;

const widgetEntries = Object.entries(surfaceFixtureSnapshots).filter(
  ([, snapshot]) => snapshot.kind === "widget",
) as Array<[string, WidgetFixture]>;
const controlEntries = Object.entries(surfaceFixtureSnapshots).filter(
  ([, snapshot]) => snapshot.kind === "control",
) as Array<[string, ControlFixture]>;

export const widgetSurfaceFixtures = Object.fromEntries(widgetEntries) as Record<
  string,
  WidgetFixture
>;
export const controlSurfaceFixtures = Object.fromEntries(controlEntries) as Record<
  string,
  ControlFixture
>;

export const activityFixtureStates = Object.fromEntries(
  Object.entries(surfaceFixtures).map(([key, snapshot]) => [
    key,
    toLiveActivityContentState(snapshot),
  ]),
) as Record<keyof typeof surfaceFixtures, ReturnType<typeof toLiveActivityContentState>>;

export const widgetFixtureEntries = Object.fromEntries(
  Object.entries(widgetSurfaceFixtures).map(([key, snapshot]) => [
    key,
    toWidgetTimelineEntry(snapshot),
  ]),
) as Record<keyof typeof widgetSurfaceFixtures, ReturnType<typeof toWidgetTimelineEntry>>;

export const controlFixtureValues = Object.fromEntries(
  Object.entries(controlSurfaceFixtures).map(([key, snapshot]) => [
    key,
    toControlValueProvider(snapshot),
  ]),
) as Record<keyof typeof controlSurfaceFixtures, ReturnType<typeof toControlValueProvider>>;
