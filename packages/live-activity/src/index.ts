import { NativeModule, requireNativeModule } from "expo";
import type { ZodIssue } from "zod";
import {
  liveSurfaceActivityContentState,
  type LiveSurfaceActivityContentState,
  type LiveSurfaceStage,
} from "@mobile-surfaces/surface-contracts";
import { MobileSurfacesError, type TrapId } from "@mobile-surfaces/traps";

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

const NativeLiveActivity =
  requireNativeModule<LiveActivityNativeModule>("LiveActivity");

/**
 * Thrown when application code calls `LiveActivity.start` or
 * `LiveActivity.update` with a ContentState that does not parse
 * against the canonical `liveSurfaceActivityContentState` Zod schema.
 * The adapter parses on entry (MS038) so a contract drift surfaces at
 * the call site with `trapId === "MS038"` and the Zod issue list
 * attached, rather than crossing the native bridge and producing a
 * silent Lock Screen failure.
 */
export class InvalidContentStateError extends MobileSurfacesError {
  readonly issues: ReadonlyArray<ZodIssue>;
  constructor(issues: ReadonlyArray<ZodIssue>) {
    const message = issues.length
      ? `Invalid Live Activity content state: ${issues
          .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
          .join("; ")}`
      : "Invalid Live Activity content state.";
    super(message);
    this.name = "InvalidContentStateError";
    this.issues = issues;
  }
}

function parseContentState(
  state: LiveActivityContentState,
): LiveActivityContentState {
  const parsed = liveSurfaceActivityContentState.safeParse(state);
  if (!parsed.success) {
    throw new InvalidContentStateError(parsed.error.issues);
  }
  return parsed.data;
}

// Wrap the native module so:
//   1. Every input crossing the bridge (start, update) is parsed
//      through liveSurfaceActivityContentState first (MS038). A drift
//      surfaces as InvalidContentStateError at the call site instead
//      of as a silent ActivityKit decode failure on the device.
//   2. Every rejection is routed through wrapNativeError, so the
//      Swift `[trap=MSXXX url=...]` suffix is parsed and the caught
//      error carries trapId/docsUrl through MobileSurfacesError.
const LiveActivity: LiveActivityAdapter = {
  async areActivitiesEnabled(): Promise<boolean> {
    try {
      return await NativeLiveActivity.areActivitiesEnabled();
    } catch (err) {
      throw wrapNativeError(err);
    }
  },
  async start(
    surfaceId: string,
    modeLabel: string,
    state: LiveActivityContentState,
    channelId?: string | null,
    options?: LiveActivityContentOptions | null,
  ): Promise<{
    id: string;
    state: LiveActivityContentState;
    channelId?: string;
  }> {
    const parsed = parseContentState(state);
    try {
      return await NativeLiveActivity.start(
        surfaceId,
        modeLabel,
        parsed,
        channelId,
        options,
      );
    } catch (err) {
      throw wrapNativeError(err);
    }
  },
  async update(
    activityId: string,
    state: LiveActivityContentState,
    options?: LiveActivityContentOptions | null,
  ): Promise<void> {
    const parsed = parseContentState(state);
    try {
      return await NativeLiveActivity.update(activityId, parsed, options);
    } catch (err) {
      throw wrapNativeError(err);
    }
  },
  async end(
    activityId: string,
    dismissalPolicy: "immediate" | "default",
  ): Promise<void> {
    try {
      return await NativeLiveActivity.end(activityId, dismissalPolicy);
    } catch (err) {
      throw wrapNativeError(err);
    }
  },
  async listActive(): Promise<LiveActivitySnapshot[]> {
    try {
      return await NativeLiveActivity.listActive();
    } catch (err) {
      throw wrapNativeError(err);
    }
  },
  async getPushToStartToken(): Promise<string | null> {
    try {
      return await NativeLiveActivity.getPushToStartToken();
    } catch (err) {
      throw wrapNativeError(err);
    }
  },
  addListener(event, handler) {
    return NativeLiveActivity.addListener(event, handler);
  },
};

// JS-side carrier for native rejections thrown across the ExpoModulesCore
// bridge. The Swift `LiveActivityError` description starts with the legacy
// `ACTIVITY_*` code (which JS-side consumers may still pattern-match on)
// and, when a case maps to a catalog trap, appends ` [trap=MSXXX url=...]`.
// `wrapNativeError` parses both fields off the message, sets `name` from
// the leading code, and rebases the value onto `MobileSurfacesError` so
// callers can render `err.trapId` + `err.docsUrl` through the catalog
// without juggling parser logic at every call site.
//
// The wrapped `LiveActivity` adapter above (Phase 2, MS038) routes
// every native rejection through `wrapNativeError`, so callers that
// `try { await LiveActivity.start(...) }` receive a `MobileSurfacesError`
// subclass carrying `trapId` + `docsUrl` without re-implementing the
// parse at each call site.
export class LiveActivityNativeError extends MobileSurfacesError {
  /** Leading `ACTIVITY_*` code parsed off the native message. */
  readonly code: string | undefined;

  /** Trap id parsed off the `[trap=...]` suffix, when present. */
  readonly nativeTrapId: TrapId | undefined;

  /** Docs URL parsed off the `[trap=... url=...]` suffix, when present. */
  readonly nativeDocsUrl: string | undefined;

  constructor(cause: unknown) {
    const message = extractNativeMessage(cause);
    super(message);
    const parsed = parseNativeMessage(message);
    this.name = parsed.errorName ?? "LiveActivityNativeError";
    this.code = parsed.code;
    this.nativeTrapId = parsed.trapId;
    this.nativeDocsUrl = parsed.docsUrl;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }

  // The base `trapId` / `docsUrl` getters resolve through ERROR_CLASS_TO_TRAP_ID
  // using this.name. When the native message carries a `[trap=...]` suffix we
  // prefer that, since the Swift side knows the case-specific binding and the
  // JS-side class table is intentionally narrow (LiveActivityNativeError is
  // one class for every native case). Fall back to the base lookup so a
  // future case bound at the class level still resolves.
  override get trapId(): TrapId | undefined {
    return this.nativeTrapId ?? super.trapId;
  }

  override get docsUrl(): string | undefined {
    return this.nativeDocsUrl ?? super.docsUrl;
  }
}

function extractNativeMessage(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause && typeof cause === "object") {
    const m = (cause as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(cause);
}

// Swift `description` shapes (see packages/live-activity/ios/LiveActivityError.swift):
//   "ACTIVITY_UNSUPPORTED_OS"
//   "ACTIVITY_DECODE_FAILED: <reason>"
//   "ACTIVITY_UNSUPPORTED_OS [trap=MS012 url=https://...]"
//   "ACTIVITY_DECODE_FAILED: <reason> [trap=MS003 url=https://...]"
// ExpoModulesCore may also prepend a prefix like "ERR_INTERNAL: " around
// the description before it reaches JS; the regex matches anywhere in the
// string. Returns undefined fields on no match instead of throwing.
const TRAP_SUFFIX_RE =
  /\[trap=(MS\d+)(?:\s+url=([^\]\s]+))?\]/;
const CODE_RE = /\bACTIVITY_[A-Z_]+\b/;
const CODE_TO_CLASS: Record<string, string> = {
  ACTIVITY_DECODE_FAILED: "LiveActivityDecodingError",
  ACTIVITY_ENCODE_FAILED: "LiveActivityEncodingError",
  ACTIVITY_UNSUPPORTED_OS: "LiveActivityUnsupportedOSError",
  ACTIVITY_UNSUPPORTED_FEATURE: "LiveActivityUnsupportedFeatureError",
  ACTIVITY_NOT_FOUND: "LiveActivityNotFoundError",
};

function parseNativeMessage(message: string): {
  code: string | undefined;
  errorName: string | undefined;
  trapId: TrapId | undefined;
  docsUrl: string | undefined;
} {
  const codeMatch = CODE_RE.exec(message);
  const code = codeMatch ? codeMatch[0] : undefined;
  const errorName = code ? CODE_TO_CLASS[code] : undefined;
  const trapMatch = TRAP_SUFFIX_RE.exec(message);
  return {
    code,
    errorName,
    trapId: trapMatch ? (trapMatch[1] as TrapId) : undefined,
    docsUrl: trapMatch ? trapMatch[2] : undefined,
  };
}

/**
 * Convenience helper: wrap a caught native rejection so the trap id and
 * docs URL flow through to logging/UI. No-op when `cause` is already a
 * `LiveActivityNativeError`. Returns the original value when it is not
 * a real error-like (so callers can `try { ... } catch (e) { throw wrapNativeError(e); }`
 * without losing non-Error throws).
 */
export function wrapNativeError(cause: unknown): unknown {
  if (cause instanceof LiveActivityNativeError) return cause;
  if (cause && typeof cause === "object" && "message" in (cause as object)) {
    return new LiveActivityNativeError(cause);
  }
  return cause;
}

export default LiveActivity;
