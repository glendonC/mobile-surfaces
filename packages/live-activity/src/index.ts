import { NativeModule, requireNativeModule } from "expo";
import type {
  LiveSurfaceActivityContentState,
  LiveSurfaceStage,
} from "@mobile-surfaces/surface-contracts";

export type LiveActivityStage = LiveSurfaceStage;

export type LiveActivityContentState = LiveSurfaceActivityContentState;

export interface LiveActivitySnapshot {
  id: string;
  surfaceId: string;
  modeLabel: string;
  state: LiveActivityContentState;
  pushToken: string | null;
}

export type LiveActivityEvents = {
  onPushToken: (payload: { activityId: string; token: string }) => void;
  onActivityStateChange: (payload: {
    activityId: string;
    state: "active" | "ended" | "dismissed" | "stale" | "pending";
  }) => void;
};

declare class LiveActivityNativeModule extends NativeModule<LiveActivityEvents> {
  areActivitiesEnabled(): Promise<boolean>;
  start(
    surfaceId: string,
    modeLabel: string,
    state: LiveActivityContentState,
  ): Promise<{ id: string; state: LiveActivityContentState }>;
  update(
    activityId: string,
    state: LiveActivityContentState,
  ): Promise<void>;
  end(
    activityId: string,
    dismissalPolicy: "immediate" | "default",
  ): Promise<void>;
  listActive(): Promise<LiveActivitySnapshot[]>;
}

const LiveActivity = requireNativeModule<LiveActivityNativeModule>("LiveActivity");

export default LiveActivity;
