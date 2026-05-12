import {
  surfaceFixtureSnapshots,
  toControlValueProvider,
  toLiveActivityContentState,
  toLockAccessoryEntry,
  toStandbyEntry,
  toWidgetTimelineEntry,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

type LiveActivityFixture = LiveSurfaceSnapshot & { kind: "liveActivity" };
type WidgetFixture = LiveSurfaceSnapshot & { kind: "widget" };
type ControlFixture = LiveSurfaceSnapshot & { kind: "control" };
type LockAccessoryFixture = LiveSurfaceSnapshot & { kind: "lockAccessory" };
type StandbyFixture = LiveSurfaceSnapshot & { kind: "standby" };

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
const lockAccessoryEntries = Object.entries(surfaceFixtureSnapshots).filter(
  ([, snapshot]) => snapshot.kind === "lockAccessory",
) as Array<[string, LockAccessoryFixture]>;
const standbyEntries = Object.entries(surfaceFixtureSnapshots).filter(
  ([, snapshot]) => snapshot.kind === "standby",
) as Array<[string, StandbyFixture]>;

export const widgetSurfaceFixtures = Object.fromEntries(widgetEntries) as Record<
  string,
  WidgetFixture
>;
export const controlSurfaceFixtures = Object.fromEntries(controlEntries) as Record<
  string,
  ControlFixture
>;
export const lockAccessorySurfaceFixtures = Object.fromEntries(lockAccessoryEntries) as Record<
  string,
  LockAccessoryFixture
>;
export const standbySurfaceFixtures = Object.fromEntries(standbyEntries) as Record<
  string,
  StandbyFixture
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

export const lockAccessoryFixtureEntries = Object.fromEntries(
  Object.entries(lockAccessorySurfaceFixtures).map(([key, snapshot]) => [
    key,
    toLockAccessoryEntry(snapshot),
  ]),
) as Record<keyof typeof lockAccessorySurfaceFixtures, ReturnType<typeof toLockAccessoryEntry>>;

export const standbyFixtureEntries = Object.fromEntries(
  Object.entries(standbySurfaceFixtures).map(([key, snapshot]) => [
    key,
    toStandbyEntry(snapshot),
  ]),
) as Record<keyof typeof standbySurfaceFixtures, ReturnType<typeof toStandbyEntry>>;
