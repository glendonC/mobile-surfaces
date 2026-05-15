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

/**
 * Optional ActivityKit knobs passed to `start()` / `update()` that the
 * native module threads into `ActivityContent(state:, staleDate:,
 * relevanceScore:)`.
 *
 * - `staleDateSeconds`: when the activity should be greyed out on the Lock
 *   Screen if the host hasn't updated it. Unix seconds; iOS clamps to its
 *   own ceiling (8h for typed apps; 8h relaxed on iOS 18). Omit to let the
 *   OS pick the default.
 * - `relevanceScore`: [0, 1]. The OS uses it to decide which Live Activity
 *   wins the Dynamic Island compact slot when multiple activities are
 *   active for the same app. Higher score wins. Omit for the Apple-side
 *   default. The push wire layer also accepts `relevanceScore` on
 *   `SendOptions` so remote sends can drive it without a bridge call.
 */
export interface LiveActivityContentOptions {
  staleDateSeconds?: number;
  relevanceScore?: number;
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

/**
 * Stable surface every Live Activity adapter must implement. The harness re-export
 * at `apps/mobile/src/liveActivity/index.ts` is typed against this interface, and
 * `LiveActivityNativeModule` below is constrained to `implements LiveActivityAdapter`
 * so the local Expo module and the boundary cannot drift in opposite directions.
 *
 * Swapping to a different runtime (e.g. `expo-live-activity`, `expo-widgets`, a
 * custom module) is a one-file edit at `apps/mobile/src/liveActivity/index.ts` plus
 * a shim that conforms to this interface. There is no hand-mirrored prose copy:
 * this file is the contract.
 */
export interface LiveActivityAdapter {
  /** Probe iOS for Live Activity authorization. Resolves false on iOS < 16.1, when the user has disabled Live Activities, or in Expo Go. */
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
    options?: LiveActivityContentOptions | null,
  ): Promise<{
    id: string;
    state: LiveActivityContentState;
    channelId?: string;
  }>;
  update(
    activityId: string,
    state: LiveActivityContentState,
    options?: LiveActivityContentOptions | null,
  ): Promise<void>;
  end(
    activityId: string,
    dismissalPolicy: "immediate" | "default",
  ): Promise<void>;
  listActive(): Promise<LiveActivitySnapshot[]>;
  /**
   * Returns the most recent push-to-start token Apple delivered through
   * `onPushToStartToken`, or `null` if no token has been observed yet on
   * this bridge session. The Swift side caches the latest emission in an
   * `ObserverRegistry` actor, so a JS caller polling after the event already
   * fired does not get a misleading `nil`.
   *
   * This is a probe, not a substitute for the event. Tokens may rotate at
   * any time (MS020); production code subscribes to `onPushToStartToken` in
   * a mount-time effect and treats every emission as authoritative.
   */
  getPushToStartToken(): Promise<string | null>;
  /**
   * Subscribe to a Live Activity event. Returns a handle whose `remove()`
   * detaches the listener. Inherited `removeAllListeners` from `NativeModule`
   * is not part of the adapter contract.
   */
  addListener<E extends keyof LiveActivityEvents>(
    event: E,
    handler: LiveActivityEvents[E],
  ): { remove(): void };
}

declare class LiveActivityNativeModule
  extends NativeModule<LiveActivityEvents>
  implements LiveActivityAdapter
{
  areActivitiesEnabled(): Promise<boolean>;
  start(
    surfaceId: string,
    modeLabel: string,
    state: LiveActivityContentState,
    channelId?: string | null,
    options?: LiveActivityContentOptions | null,
  ): Promise<{
    id: string;
    state: LiveActivityContentState;
    channelId?: string;
  }>;
  update(
    activityId: string,
    state: LiveActivityContentState,
    options?: LiveActivityContentOptions | null,
  ): Promise<void>;
  end(
    activityId: string,
    dismissalPolicy: "immediate" | "default",
  ): Promise<void>;
  listActive(): Promise<LiveActivitySnapshot[]>;
  getPushToStartToken(): Promise<string | null>;
}

const LiveActivity = requireNativeModule<LiveActivityNativeModule>("LiveActivity");

export default LiveActivity;
