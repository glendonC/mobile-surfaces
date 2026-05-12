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

/**
 * Result returned by `LiveActivity.start` when an iOS 18+ broadcast/channel
 * push start succeeds. The `channelId` is echoed back by the native side so
 * the JS layer can confirm the start request landed in channel mode rather
 * than silently degrading to the per-token path.
 */
export interface LiveActivityChannelStartResult {
  id: string;
  state: LiveActivityContentState;
  channelId: string;
}

export type LiveActivityEvents = {
  onPushToken: (payload: { activityId: string; token: string }) => void;
  onActivityStateChange: (payload: {
    activityId: string;
    state:
      | "active"
      | "ended"
      | "dismissed"
      | "stale"
      | "pending"
      // Reserved for ActivityKit ActivityState cases Apple adds after the
      // current SDK version. The native module surfaces these as "unknown"
      // rather than collapsing them into "active", so consumers can detect
      // and log the new state instead of acting on a misleading default.
      | "unknown";
  }) => void;
  /**
   * Fired when ActivityKit hands us a fresh push-to-start token (iOS 17.2+).
   *
   * The token is the per-app push-to-start credential — distinct from the
   * per-activity push token emitted by `onPushToken`. Listeners are attached
   * once when the JS bridge starts observing; tokens may arrive at any time
   * (cold launch, system rotation, app foreground) so subscribe in your
   * mount-time effect rather than ad-hoc.
   *
   * Known issue: FB21158660 — after a force-close the system stream can stop
   * delivering new tokens until next device boot or a privileged reset. There
   * is no client-side workaround; we simply re-attach the observer on bridge
   * reconnect and rely on the next system-issued rotation.
   */
  onPushToStartToken: (payload: { token: string }) => void;
};

declare class LiveActivityNativeModule extends NativeModule<LiveActivityEvents> {
  areActivitiesEnabled(): Promise<boolean>;
  /**
   * Start a Live Activity.
   *
   * @param channelId Optional iOS 18+ broadcast channel identifier. When
   *   provided, ActivityKit is invoked with `pushType: .channel(channelId)`
   *   instead of the default `.token`, opting the activity into Apple's
   *   broadcast push topology (one APNs publish fans out to every subscribed
   *   device). Passing `channelId` while running on iOS < 18 throws
   *   `ACTIVITY_UNSUPPORTED_FEATURE` rather than silently downgrading.
   *
   *   The returned object includes `channelId` (echoed back by the native
   *   side) only when channel mode actually engaged; use
   *   `LiveActivityChannelStartResult` to narrow.
   */
  start(
    surfaceId: string,
    modeLabel: string,
    state: LiveActivityContentState,
    channelId?: string | null,
  ): Promise<{
    id: string;
    state: LiveActivityContentState;
    channelId?: string;
  }>;
  update(
    activityId: string,
    state: LiveActivityContentState,
  ): Promise<void>;
  end(
    activityId: string,
    dismissalPolicy: "immediate" | "default",
  ): Promise<void>;
  listActive(): Promise<LiveActivitySnapshot[]>;
  /**
   * Probe for the current push-to-start token.
   *
   * Always resolves to `null` today: Apple does not expose a synchronous
   * query for this value — it only arrives via the `onPushToStartToken`
   * event stream (iOS 17.2+). The function is reserved for symmetry with
   * the adapter contract and as a no-op sanity check; production code
   * should subscribe to the event instead.
   */
  getPushToStartToken(): Promise<string | null>;
}

const LiveActivity = requireNativeModule<LiveActivityNativeModule>("LiveActivity");

export default LiveActivity;
