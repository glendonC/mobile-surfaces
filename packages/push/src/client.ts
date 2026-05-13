// PushClient — the canonical entry point for sending Mobile Surfaces snapshots
// to APNs. One client per (auth-key, environment, bundleId) tuple; a single
// client multiplexes alert / Live-Activity / broadcast / channel-management
// requests over its session pool.

import crypto from "node:crypto";
import {
  liveSurfaceSnapshot,
  toLiveActivityContentState,
} from "@mobile-surfaces/surface-contracts";
import type {
  LiveSurfaceSnapshot,
  LiveSurfaceSnapshotLiveActivity,
} from "@mobile-surfaces/surface-contracts";
import { liveActivityAlertPayloadFromSnapshot } from "./payloads.ts";

import {
  ApnsError,
  ClientClosedError,
  InvalidSnapshotError,
  MissingApnsConfigError,
  PayloadTooLargeError,
  TooManyRequestsError,
  reasonToError,
} from "./errors.ts";
import type { Http2ConnectFactory } from "./http.ts";
import { Http2Client } from "./http.ts";
import { JwtCache, resolveKeyPem } from "./jwt.ts";
import {
  DEFAULT_RETRY_POLICY,
  computeBackoffMs,
  effectiveRetryPolicy,
  sleep,
} from "./retry.ts";
import type { RetryPolicy } from "./retry.ts";
import { RETRYABLE_TRANSPORT_CODES, TERMINAL_REASONS } from "./reasons.ts";
import {
  extractChannelList,
  normalizeChannelEntry,
  tryParseChannelIdFromBody,
  tryParseJson,
} from "./channels.ts";
import type { ChannelInfo } from "./channels.ts";

export type { ChannelInfo } from "./channels.ts";

// APNs payload ceilings per MS011. Per-activity and alert sends are bounded at
// 4 KB; iOS 18 broadcast pushes get an extra 1 KB. The SDK enforces these
// client-side so callers see PayloadTooLargeError before the round-trip.
const MAX_PAYLOAD_BYTES_DEFAULT = 4096;
const MAX_PAYLOAD_BYTES_BROADCAST = 5120;

type PayloadKind = "alert" | "update" | "start" | "end" | "broadcast";

function assertPayloadWithinLimit(
  payload: string,
  kind: PayloadKind,
): void {
  const limit =
    kind === "broadcast" ? MAX_PAYLOAD_BYTES_BROADCAST : MAX_PAYLOAD_BYTES_DEFAULT;
  const size = Buffer.byteLength(payload, "utf8");
  if (size > limit) {
    throw new PayloadTooLargeError({
      status: 413,
      message: `Client-side pre-flight: payload size ${size} bytes exceeds limit ${limit} for ${kind}; rejected before APNs round-trip. See MS011.`,
    });
  }
}

export interface CreatePushClientOptions {
  /** 10-character APNs Auth Key ID from the Apple Developer portal. */
  keyId: string;
  /** 10-character Team ID from the Apple Developer portal. */
  teamId: string;
  /** Path to the .p8 file, or its raw PEM contents as a Buffer. */
  keyPath: string | Buffer;
  /** iOS app bundle identifier, without the `.push-type.liveactivity` suffix. */
  bundleId: string;
  /** APNs environment to target. */
  environment: "development" | "production";
  /**
   * Operator-grade override of the retry policy. Defaults — 3 retries, 100ms
   * base, 5s cap, jitter on — are tuned against MS015's iOS budget rules and
   * the priority-aware stretch in `effectiveRetryPolicy`. Changing these is
   * usually wrong; the name is prefixed `_unsafe` to make that visible at
   * the call site.
   *
   * Even with this set, the kill-switch `MOBILE_SURFACES_PUSH_DISABLE_RETRY`
   * env var still forces `maxRetries: 0` if truthy.
   */
  _unsafeRetryOverride?: Partial<RetryPolicy>;
  /**
   * @deprecated Renamed to `_unsafeRetryOverride` in 3.1.0; the old name is
   * still honored but logs a one-time deprecation warning per process and
   * will be removed in 4.0. If both options are set, `_unsafeRetryOverride`
   * wins and this field is ignored.
   */
  retryPolicy?: Partial<RetryPolicy>;
  /** ms with no in-flight requests before the HTTP/2 session is closed. Default 60_000. */
  idleTimeoutMs?: number;
  /**
   * Optional observability hooks fired per-attempt for every send and channel
   * management operation. Use these to wire your own Sentry / PostHog / log
   * aggregator without re-implementing APNs error parsing. The SDK never
   * forwards data anywhere on its own; both fields default to no-op.
   *
   * Hooks run inside an internal try/catch — a hook that throws can never
   * break the send. Hooks fire on every attempt (so retries are observable)
   * with `attempt` (0-indexed) and `isFinalAttempt` populated on the context.
   *
   * Tokens are passed through unredacted; consumers should redact in the
   * hook before forwarding to any aggregator. APNs push tokens are not
   * secrets but they are the only credential needed to send to a device.
   */
  hooks?: PushHooks;
  /**
   * Internal: override the http2 connect factory and/or session options for
   * tests. Production callers should not touch these; they're keyed on a
   * `Symbol.for` so they don't show up in TypeScript's IntelliSense.
   */
}

/**
 * Discriminator for which PushClient method originated a hook event. Stable
 * identifiers; new operations append rather than rename.
 */
export type PushHookOperation =
  | "alert"
  | "update"
  | "start"
  | "end"
  | "broadcast"
  | "createChannel"
  | "listChannels"
  | "deleteChannel";

export interface PushHookContext {
  operation: PushHookOperation;
  /** Zero-indexed retry attempt: 0 on the first try, 1 on the second, etc. */
  attempt: number;
  /**
   * True when the SDK will not retry this attempt. Lets a hook defer alerting
   * until the SDK has actually given up (and rethrown) rather than firing on
   * every transient retryable error.
   */
  isFinalAttempt: boolean;
  /** APNs `apns-id` of the request (UUID v4 unless the caller overrode it). */
  apnsId?: string;
  /** HTTP status from APNs when a response was received. Undefined on transport errors. */
  status?: number;
  /**
   * Device or push-to-start token, channel id, or undefined for management
   * operations that do not target a specific channel. Passed through
   * unredacted; redact in the hook before logging.
   */
  token?: string;
  /** liveSurfaceSnapshot.id for sends; undefined for management ops. */
  snapshotId?: string;
  /** Wall-clock ms from request issue to response (or thrown error). */
  durationMs: number;
}

export interface PushHooks {
  /** Fires after every 2xx response, once per attempt. */
  onResponse?: (context: PushHookContext) => void;
  /**
   * Fires after every thrown error (transport or APNs non-2xx), once per
   * attempt. `isFinalAttempt: false` fires for retryable errors before the
   * SDK retries; `isFinalAttempt: true` fires on the error the caller will
   * actually see.
   */
  onError?: (error: unknown, context: PushHookContext) => void;
}

export interface SendOptions {
  /** Optional `apns-id`. If omitted the SDK generates a UUID v4. */
  apnsId?: string;
  /** APNs priority. Defaults: 10 for `alert`, 5 for Live Activity sends. */
  priority?: 5 | 10;
  /** `apns-expiration` value in unix seconds. Defaults to now + 3600. */
  expirationSeconds?: number;
  /** ActivityKit `stale-date` in unix seconds. */
  staleDateSeconds?: number;
  /** ActivityKit `dismissal-date` in unix seconds. */
  dismissalDateSeconds?: number;
}

export interface BroadcastOptions extends SendOptions {
  // Reserved for future broadcast-only options (relevanceScore, etc.).
}

export interface LiveActivityStartOptions extends SendOptions {
  /** Defaults to `MobileSurfacesActivityAttributes`; override after rename. */
  attributesType?: string;
}

/**
 * Per-attempt record of a retry the SDK decided to perform. Populated in
 * `PushResult.retried` in the order the retries occurred. The successful
 * (final) attempt is never recorded here — `attempts` counts it instead.
 */
export interface RetryAttempt {
  /**
   * APNs reason string ("TooManyRequests", "ServiceUnavailable") for response
   * errors, or transport error code ("ETIMEDOUT", "ECONNRESET") when the
   * attempt failed before a response arrived.
   */
  reason: string;
  /**
   * Trap catalog id when the failure maps to a typed APNs error class.
   * Undefined for transport errors and for response errors without a
   * catalog binding.
   */
  trapId?: string;
  /** HTTP status from APNs. Undefined for transport-level failures. */
  status?: number;
  /** Wall-clock backoff ms slept after this attempt before the next. */
  backoffMs: number;
}

/**
 * Result of a successful send. `apnsId`, `status`, and `timestamp` are the
 * legacy SendResponse shape; the additional fields surface retry behavior
 * and trap activity so consumers can wire dashboards (or assert on first-try
 * health) without re-implementing the same accounting in their hooks.
 *
 * - `attempts` is 1-indexed: 1 on first-try success, 2+ when at least one
 *   retry preceded the eventual 2xx.
 * - `latencyMs` measures wall-clock from the first request issue to the
 *   final response, including every backoff sleep in between.
 * - `retried` records each failed attempt the SDK retried, in order.
 * - `trapHits` is the deduplicated set of trap ids touched across retries.
 *   Empty on healthy first-try sends; non-empty marks a request that hit
 *   the catalog at least once (useful as a metric label).
 */
export interface PushResult {
  apnsId: string;
  status: number;
  timestamp: Date;
  attempts: number;
  latencyMs: number;
  retried: readonly RetryAttempt[];
  trapHits: readonly string[];
}

/**
 * @deprecated Use `PushResult`. Kept as a type alias so existing callers
 * compile without changes; the in-memory shape is identical.
 */
export type SendResponse = PushResult;

interface RetryMeta {
  attempts: number;
  latencyMs: number;
  retried: readonly RetryAttempt[];
  trapHits: readonly string[];
}

/**
 * Discriminated input for `client.describeSend()`. Mirrors the public send-
 * method signatures one-to-one so a caller can preflight the exact bytes
 * any subsequent send would issue.
 */
export type DescribeSendInput =
  | {
      operation: "alert";
      deviceToken: string;
      snapshot: LiveSurfaceSnapshot;
      options?: SendOptions;
    }
  | {
      operation: "update";
      activityToken: string;
      snapshot: LiveSurfaceSnapshot;
      options?: SendOptions;
    }
  | {
      operation: "start";
      pushToStartToken: string;
      snapshot: LiveSurfaceSnapshot;
      attributes: Record<string, unknown>;
      options?: LiveActivityStartOptions;
    }
  | {
      operation: "end";
      activityToken: string;
      snapshot: LiveSurfaceSnapshot;
      options?: SendOptions;
    }
  | {
      operation: "broadcast";
      channelId: string;
      snapshot: LiveSurfaceSnapshot;
      options?: BroadcastOptions;
    };

/**
 * Side-effect-free description of the request `send()` would issue. No JWT
 * is minted; no socket is opened. `withinLimit` and `payloadLimitBytes`
 * encode the MS011 check the SDK applies on real sends — callers can use
 * them to fail-fast at compose-time instead of waiting for the throw.
 */
export interface SendDescription {
  operation: "alert" | "update" | "start" | "end" | "broadcast";
  method: "POST";
  path: string;
  pushType: "alert" | "liveactivity";
  /** `apns-topic` header value, or null for broadcast (which omits the header). */
  topic: string | null;
  priority: 5 | 10;
  apnsId: string;
  expirationSeconds: number;
  staleDateSeconds?: number;
  dismissalDateSeconds?: number;
  attributesType?: string;
  channelId?: string;
  /** Token (device, activity, push-to-start) or channel id; mirrors the send-method arg. */
  target: string;
  snapshotId: string;
  snapshotKind: "liveActivity";
  payload: Record<string, unknown>;
  payloadJson: string;
  payloadBytes: number;
  /** MS011 ceiling that applies to this operation: 5120 for broadcast, 4096 otherwise. */
  payloadLimitBytes: number;
  withinLimit: boolean;
}

interface ChannelManageResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * Symbol-keyed escape hatch for tests to inject a custom http2 connect
 * factory and/or session options (self-signed CA bundle for an in-process
 * server). Production code never reads or writes this key. The symbol uses
 * `Symbol.for` so test files in the same process can reach it without
 * importing it from this module's internal exports.
 */
export const TEST_TRANSPORT_OVERRIDE = Symbol.for(
  "@mobile-surfaces/push/test-transport-override",
);

interface TestTransportOverride {
  connect?: Http2ConnectFactory;
  sessionOptions?: import("node:http2").ClientSessionOptions | import("node:http2").SecureClientSessionOptions;
  /** Override send-host origin (used to point to the in-process test server). */
  sendOrigin?: string;
  /** Override channel-management origin. */
  manageOrigin?: string;
  /**
   * Per-request stream timeout in ms, forwarded to Http2Client.request().
   * Test-only knob so transport-retry coverage can hit ETIMEDOUT without
   * waiting for the 30s production default. Production code never sets this.
   */
  requestTimeoutMs?: number;
  /**
   * Override the JwtCache refresh window. Lets refresh-on-retry tests force
   * the cache to mint a fresh token between attempts without waiting out the
   * 50-minute production window. Production code never sets this.
   */
  jwtRefreshIntervalMs?: number;
  /**
   * Override the JwtCache `now()` source. Paired with `jwtRefreshIntervalMs`
   * so refresh-on-retry tests can also push the iat claim into a later
   * second between attempts (mintJwt's iat resolution is one second, so two
   * mints in the same wall-clock second produce byte-identical tokens).
   * Production code never sets this.
   */
  jwtNow?: () => number;
}

function sendOriginFor(env: "development" | "production"): string {
  return env === "production"
    ? "https://api.push.apple.com:443"
    : "https://api.development.push.apple.com:443";
}

function manageOriginFor(env: "development" | "production"): string {
  return env === "production"
    ? "https://api-manage-broadcast.push.apple.com:2196"
    : "https://api-manage-broadcast.sandbox.push.apple.com:2195";
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function parseApnsErrorBody(
  body: string,
): { reason: string; timestamp?: Date } | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { reason?: unknown; timestamp?: unknown };
    if (typeof parsed.reason !== "string") return undefined;
    const ts = typeof parsed.timestamp === "number"
      ? new Date(parsed.timestamp)
      : undefined;
    return { reason: parsed.reason, timestamp: ts };
  } catch {
    return undefined;
  }
}

function parseRetryAfterSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  // HTTP-date form (rare for APNs but allowed by spec).
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  return Math.max(0, Math.floor((ms - Date.now()) / 1000));
}

function isTransportError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (typeof code !== "string") return false;
  if (RETRYABLE_TRANSPORT_CODES.has(code)) return true;
  // Node wraps RST_STREAM as ERR_HTTP2_STREAM_ERROR and exposes the
  // protocol-level code (e.g. NGHTTP2_REFUSED_STREAM) in the message rather
  // than on err.code. Disambiguate so transient stream-level errors retry
  // but PROTOCOL_ERROR (caller's malformed frame) surfaces.
  // - REFUSED_STREAM: peer rejected before processing; safe to retry.
  // - INTERNAL_ERROR: also raised by Node on in-flight streams when the
  //   peer destroys the session under multiple concurrent streams (the
  //   single-stream case surfaces as ERR_HTTP2_SESSION_ERROR instead, which
  //   is already in RETRYABLE_TRANSPORT_CODES). Treating it as retryable
  //   keeps parallel-recovery symmetric with the single-stream path.
  if (code === "ERR_HTTP2_STREAM_ERROR") {
    const message = (err as { message?: string }).message ?? "";
    return (
      message.includes("NGHTTP2_REFUSED_STREAM") ||
      message.includes("NGHTTP2_INTERNAL_ERROR")
    );
  }
  return false;
}

/**
 * Env var operators set when they need to disable the SDK's retry logic
 * entirely (e.g. during an APNs incident where retries are amplifying load).
 * Any non-empty value counts as truthy; the SDK does not parse "false" or
 * "0" specially — the kill-switch is an ops bypass, set it or unset it.
 */
const DISABLE_RETRY_ENV_VAR = "MOBILE_SURFACES_PUSH_DISABLE_RETRY";

/**
 * Process-wide flag so the `retryPolicy` deprecation warning fires at most
 * once even when many PushClients are instantiated. Per-process, not
 * per-client; the warning is not actionable on every send.
 */
let retryPolicyDeprecationLogged = false;

function resolveRetryPolicy(options: CreatePushClientOptions): RetryPolicy {
  const override = options._unsafeRetryOverride ?? options.retryPolicy;
  if (
    options.retryPolicy &&
    !options._unsafeRetryOverride &&
    !retryPolicyDeprecationLogged
  ) {
    retryPolicyDeprecationLogged = true;
    console.warn(
      "[@mobile-surfaces/push] `retryPolicy` is deprecated; rename to `_unsafeRetryOverride`. " +
        "The old name will be removed in 4.0.",
    );
  }
  const merged: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...(override ?? {}) };
  if (isRetryDisabledByEnv()) {
    // Env-level kill-switch overrides any user override. Operators reach for
    // this during an APNs incident where retries are amplifying load; we
    // honor it unconditionally so a misconfigured deployment cannot bypass
    // the bypass.
    return { ...merged, maxRetries: 0 };
  }
  return merged;
}

function isRetryDisabledByEnv(): boolean {
  const v = process.env[DISABLE_RETRY_ENV_VAR];
  return typeof v === "string" && v.length > 0;
}

// Per MS028: createPushClient validates presence of every required option and
// rejects fast. Empty strings are treated as missing — config files that read
// "${MISSING_VAR}" or similar would otherwise pass a typeof check.
function assertConfigComplete(options: CreatePushClientOptions): void {
  const missing: string[] = [];
  if (!isNonEmpty(options.keyId)) missing.push("keyId");
  if (!isNonEmpty(options.teamId)) missing.push("teamId");
  if (!isNonEmpty(options.bundleId)) missing.push("bundleId");
  if (options.keyPath === undefined || options.keyPath === null) {
    missing.push("keyPath");
  } else if (typeof options.keyPath === "string" && !isNonEmpty(options.keyPath)) {
    missing.push("keyPath");
  } else if (Buffer.isBuffer(options.keyPath) && options.keyPath.length === 0) {
    missing.push("keyPath");
  }
  if (options.environment !== "development" && options.environment !== "production") {
    missing.push("environment");
  }
  if (missing.length > 0) {
    throw new MissingApnsConfigError(missing);
  }
}

function isNonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// Hook invocation isolation: a thrown hook must never break the send. Errors
// from hooks are swallowed silently; the contract is documented on PushHooks.
function safeInvokeHook<Args extends unknown[]>(
  fn: ((...args: Args) => void) | undefined,
  ...args: Args
): void {
  if (!fn) return;
  try {
    fn(...args);
  } catch {
    // Intentional: hook failures cannot affect the SDK's behavior.
  }
}

function snapshotMustBeLiveActivity(
  snapshot: LiveSurfaceSnapshot,
  method: string,
): LiveSurfaceSnapshotLiveActivity {
  if (snapshot.kind !== "liveActivity") {
    throw new InvalidSnapshotError(
      `${method} requires a liveActivity-kind snapshot; got kind=${snapshot.kind}.`,
    );
  }
  return snapshot;
}

function validateSnapshot(input: unknown): LiveSurfaceSnapshot {
  const result = liveSurfaceSnapshot.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
    throw new InvalidSnapshotError(
      `LiveSurfaceSnapshot failed validation: ${issues.join("; ")}`,
      issues,
    );
  }
  return result.data;
}

function genApnsId(): string {
  return crypto.randomUUID();
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export class PushClient {
  readonly #options: Required<Pick<CreatePushClientOptions, "keyId" | "teamId" | "bundleId" | "environment">>;
  readonly #retryPolicy: RetryPolicy;
  readonly #jwt: JwtCache;
  readonly #send: Http2Client;
  readonly #manage: Http2Client;
  readonly #hooks: PushHooks;
  readonly #requestTimeoutMs: number | undefined;
  #closed = false;

  constructor(options: CreatePushClientOptions) {
    assertConfigComplete(options);
    this.#options = {
      keyId: options.keyId,
      teamId: options.teamId,
      bundleId: options.bundleId,
      environment: options.environment,
    };
    this.#retryPolicy = resolveRetryPolicy(options);
    this.#hooks = options.hooks ?? {};

    const idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
    const override = (options as unknown as Record<symbol, unknown>)[
      TEST_TRANSPORT_OVERRIDE
    ] as TestTransportOverride | undefined;
    this.#requestTimeoutMs = override?.requestTimeoutMs;

    const keyPem = resolveKeyPem(options.keyPath);
    this.#jwt = new JwtCache(
      {
        keyPem,
        keyId: options.keyId,
        teamId: options.teamId,
      },
      {
        refreshIntervalMs: override?.jwtRefreshIntervalMs,
        now: override?.jwtNow,
      },
    );

    this.#send = new Http2Client({
      origin: override?.sendOrigin ?? sendOriginFor(options.environment),
      idleTimeoutMs,
      connect: override?.connect,
      sessionOptions: override?.sessionOptions,
    });
    this.#manage = new Http2Client({
      origin: override?.manageOrigin ?? manageOriginFor(options.environment),
      idleTimeoutMs,
      connect: override?.connect,
      sessionOptions: override?.sessionOptions,
    });
  }

  /**
   * Send a regular alert push. Snapshot must be `liveActivity`-kind.
   */
  async alert(
    deviceToken: string,
    snapshot: LiveSurfaceSnapshot,
    options: SendOptions = {},
  ): Promise<PushResult> {
    this.#assertOpen();
    const validated = validateSnapshot(snapshot);
    const live = snapshotMustBeLiveActivity(validated, "alert()");
    const payload = JSON.stringify(liveActivityAlertPayloadFromSnapshot(live));
    return this.#sendDevice({
      operation: "alert",
      snapshotId: live.id,
      token: deviceToken,
      payload,
      pushType: "alert",
      defaultPriority: 10,
      apnsTopic: this.#options.bundleId,
      options,
    });
  }

  /**
   * Send an ActivityKit content-state update to an existing Live Activity.
   * Snapshot must be `liveActivity`-kind.
   */
  async update(
    activityToken: string,
    snapshot: LiveSurfaceSnapshot,
    options: SendOptions = {},
  ): Promise<PushResult> {
    this.#assertOpen();
    const validated = validateSnapshot(snapshot);
    const live = snapshotMustBeLiveActivity(validated, "update()");
    const payload = JSON.stringify(
      this.#buildActivityPayload(live, "update", undefined, options),
    );
    return this.#sendDevice({
      operation: "update",
      snapshotId: live.id,
      token: activityToken,
      payload,
      pushType: "liveactivity",
      defaultPriority: 5,
      apnsTopic: `${this.#options.bundleId}.push-type.liveactivity`,
      options,
    });
  }

  /**
   * iOS 17.2+ remote start via push-to-start token. Snapshot must be
   * `liveActivity`-kind and `attributes` must include the fields your
   * `ActivityAttributes` type expects.
   */
  async start(
    pushToStartToken: string,
    snapshot: LiveSurfaceSnapshot,
    attributes: Record<string, unknown>,
    options: LiveActivityStartOptions = {},
  ): Promise<PushResult> {
    this.#assertOpen();
    const validated = validateSnapshot(snapshot);
    const live = snapshotMustBeLiveActivity(validated, "start()");
    const attributesType = options.attributesType ?? "MobileSurfacesActivityAttributes";
    const payload = JSON.stringify(
      this.#buildActivityPayload(live, "start", { attributesType, attributes }, options),
    );
    return this.#sendDevice({
      operation: "start",
      snapshotId: live.id,
      token: pushToStartToken,
      payload,
      pushType: "liveactivity",
      defaultPriority: 5,
      apnsTopic: `${this.#options.bundleId}.push-type.liveactivity`,
      options,
    });
  }

  /**
   * End a Live Activity. Snapshot must be `liveActivity`-kind. If
   * `dismissalDateSeconds` is omitted, the SDK sets it to now (matching
   * scripts/send-apns.mjs behavior).
   */
  async end(
    activityToken: string,
    snapshot: LiveSurfaceSnapshot,
    options: SendOptions = {},
  ): Promise<PushResult> {
    this.#assertOpen();
    const validated = validateSnapshot(snapshot);
    const live = snapshotMustBeLiveActivity(validated, "end()");
    const dismissalSeconds = options.dismissalDateSeconds ?? nowSec();
    const payload = JSON.stringify(
      this.#buildActivityPayload(live, "end", undefined, {
        ...options,
        dismissalDateSeconds: dismissalSeconds,
      }),
    );
    return this.#sendDevice({
      operation: "end",
      snapshotId: live.id,
      token: activityToken,
      payload,
      pushType: "liveactivity",
      defaultPriority: 5,
      apnsTopic: `${this.#options.bundleId}.push-type.liveactivity`,
      options,
    });
  }

  /**
   * Broadcast push on an iOS 18 channel. No `apns-topic`; routing is by
   * bundle id in the path + apns-channel-id header.
   */
  async broadcast(
    channelId: string,
    snapshot: LiveSurfaceSnapshot,
    options: BroadcastOptions = {},
  ): Promise<PushResult> {
    this.#assertOpen();
    const validated = validateSnapshot(snapshot);
    const live = snapshotMustBeLiveActivity(validated, "broadcast()");
    const payload = JSON.stringify(
      this.#buildActivityPayload(live, "update", undefined, options),
    );
    assertPayloadWithinLimit(payload, "broadcast");
    const apnsId = options.apnsId ?? genApnsId();
    const priority = options.priority ?? 5;
    const headers: Record<string, string> = {
      ":method": "POST",
      ":path": `/4/broadcasts/apps/${this.#options.bundleId}`,
      authorization: `bearer ${this.#jwt.get()}`,
      "apns-channel-id": channelId,
      "apns-push-type": "liveactivity",
      "apns-priority": String(priority),
      "apns-id": apnsId,
      "apns-expiration": "0",
      "content-type": "application/json",
    };
    return this.#performWithRetry(this.#send, headers, payload, apnsId, {
      operation: "broadcast",
      snapshotId: live.id,
      token: channelId,
      priority,
    });
  }

  /**
   * Create a new broadcast channel. Apple returns the channel-id in the
   * `apns-channel-id` response header.
   */
  async createChannel(options: { storagePolicy?: "no-storage" | "most-recent-message" } = {}): Promise<ChannelInfo> {
    this.#assertOpen();
    const storagePolicy = options.storagePolicy ?? "no-storage";
    const body = JSON.stringify({
      "message-storage-policy": storagePolicy === "most-recent-message" ? 1 : 0,
      "push-type": "LiveActivity",
    });
    const headers: Record<string, string> = {
      ":method": "POST",
      ":path": `/1/apps/${this.#options.bundleId}/channels`,
      authorization: `bearer ${this.#jwt.get()}`,
      "content-type": "application/json",
    };
    const res = await this.#performManage(headers, body, {
      operation: "createChannel",
    });
    const channelId =
      pickHeader(res.headers, "apns-channel-id") ??
      tryParseChannelIdFromBody(res.body);
    if (!channelId) {
      throw new Error(
        `createChannel: APNs returned ${res.status} but no apns-channel-id was found in headers or body.`,
      );
    }
    return { channelId, storagePolicy, raw: tryParseJson(res.body) };
  }

  /**
   * List all broadcast channels for this bundle id (in this environment).
   * Apple returns a JSON body with a `channels` array.
   */
  async listChannels(): Promise<ChannelInfo[]> {
    this.#assertOpen();
    const headers: Record<string, string> = {
      ":method": "GET",
      ":path": `/1/apps/${this.#options.bundleId}/all-channels`,
      authorization: `bearer ${this.#jwt.get()}`,
    };
    const res = await this.#performManage(headers, undefined, {
      operation: "listChannels",
    });
    const parsed = tryParseJson(res.body);
    const channels = extractChannelList(parsed);
    return channels.map((entry) => normalizeChannelEntry(entry));
  }

  /**
   * Delete a broadcast channel by id. Apple's documented shape: the channel
   * id travels in the `apns-channel-id` header, NOT as a path parameter.
   */
  async deleteChannel(channelId: string): Promise<void> {
    this.#assertOpen();
    const headers: Record<string, string> = {
      ":method": "DELETE",
      ":path": `/1/apps/${this.#options.bundleId}/channels`,
      authorization: `bearer ${this.#jwt.get()}`,
      "apns-channel-id": channelId,
    };
    await this.#performManage(headers, undefined, {
      operation: "deleteChannel",
      token: channelId,
    });
  }

  /**
   * Side-effect-free preflight: returns the request the matching `send()`
   * call would issue (method, path, headers, payload, byte size) without
   * contacting APNs or minting a JWT. Useful for:
   * - `send-apns.mjs --describe` plumbing
   * - MS011 ceiling enforcement before a costly attempt
   * - diff'ing two payload constructions during refactors
   *
   * Validates the snapshot and the operation-vs-kind constraint just like a
   * real send; throws `InvalidSnapshotError` on either failure so callers
   * cannot ship a payload through CI that the runtime would reject. Does
   * NOT throw on payload-over-limit — that surfaces as `withinLimit: false`
   * so describers can summarize the failure without losing the byte count.
   */
  describeSend(input: DescribeSendInput): SendDescription {
    this.#assertOpen();
    const validated = validateSnapshot(input.snapshot);
    const live = snapshotMustBeLiveActivity(validated, "describeSend()");
    const apnsId = input.options?.apnsId ?? genApnsId();
    const expirationSeconds =
      input.options?.expirationSeconds ?? nowSec() + 3600;
    const bundleId = this.#options.bundleId;
    switch (input.operation) {
      case "alert": {
        const payload = liveActivityAlertPayloadFromSnapshot(live);
        return this.#finishDescription({
          operation: "alert",
          path: `/3/device/${input.deviceToken}`,
          pushType: "alert",
          topic: bundleId,
          priority: input.options?.priority ?? 10,
          apnsId,
          expirationSeconds,
          target: input.deviceToken,
          snapshotId: live.id,
          payload,
          limitKind: "alert",
        });
      }
      case "update": {
        const payload = this.#buildActivityPayload(
          live,
          "update",
          undefined,
          input.options ?? {},
        );
        return this.#finishDescription({
          operation: "update",
          path: `/3/device/${input.activityToken}`,
          pushType: "liveactivity",
          topic: `${bundleId}.push-type.liveactivity`,
          priority: input.options?.priority ?? 5,
          apnsId,
          expirationSeconds,
          target: input.activityToken,
          snapshotId: live.id,
          staleDateSeconds: input.options?.staleDateSeconds,
          payload,
          limitKind: "update",
        });
      }
      case "start": {
        const attributesType =
          input.options?.attributesType ?? "MobileSurfacesActivityAttributes";
        const payload = this.#buildActivityPayload(
          live,
          "start",
          { attributesType, attributes: input.attributes },
          input.options ?? {},
        );
        return this.#finishDescription({
          operation: "start",
          path: `/3/device/${input.pushToStartToken}`,
          pushType: "liveactivity",
          topic: `${bundleId}.push-type.liveactivity`,
          priority: input.options?.priority ?? 5,
          apnsId,
          expirationSeconds,
          attributesType,
          target: input.pushToStartToken,
          snapshotId: live.id,
          staleDateSeconds: input.options?.staleDateSeconds,
          payload,
          limitKind: "start",
        });
      }
      case "end": {
        const dismissalDateSeconds =
          input.options?.dismissalDateSeconds ?? nowSec();
        const payload = this.#buildActivityPayload(
          live,
          "end",
          undefined,
          { ...(input.options ?? {}), dismissalDateSeconds },
        );
        return this.#finishDescription({
          operation: "end",
          path: `/3/device/${input.activityToken}`,
          pushType: "liveactivity",
          topic: `${bundleId}.push-type.liveactivity`,
          priority: input.options?.priority ?? 5,
          apnsId,
          expirationSeconds,
          target: input.activityToken,
          snapshotId: live.id,
          staleDateSeconds: input.options?.staleDateSeconds,
          dismissalDateSeconds,
          payload,
          limitKind: "end",
        });
      }
      case "broadcast": {
        const payload = this.#buildActivityPayload(
          live,
          "update",
          undefined,
          input.options ?? {},
        );
        return this.#finishDescription({
          operation: "broadcast",
          path: `/4/broadcasts/apps/${bundleId}`,
          pushType: "liveactivity",
          topic: null,
          priority: input.options?.priority ?? 5,
          apnsId,
          expirationSeconds: 0,
          channelId: input.channelId,
          target: input.channelId,
          snapshotId: live.id,
          payload,
          limitKind: "broadcast",
        });
      }
    }
  }

  /**
   * Close the underlying HTTP/2 sessions. After this resolves, every method
   * on this client throws `ClientClosedError`.
   */
  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all([this.#send.close(), this.#manage.close()]);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  #assertOpen(): void {
    if (this.#closed) {
      throw new ClientClosedError();
    }
  }

  #finishDescription(args: {
    operation: SendDescription["operation"];
    path: string;
    pushType: "alert" | "liveactivity";
    topic: string | null;
    priority: 5 | 10;
    apnsId: string;
    expirationSeconds: number;
    staleDateSeconds?: number;
    dismissalDateSeconds?: number;
    attributesType?: string;
    channelId?: string;
    target: string;
    snapshotId: string;
    payload: Record<string, unknown>;
    limitKind: PayloadKind;
  }): SendDescription {
    const payloadJson = JSON.stringify(args.payload);
    const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
    const payloadLimitBytes =
      args.limitKind === "broadcast"
        ? MAX_PAYLOAD_BYTES_BROADCAST
        : MAX_PAYLOAD_BYTES_DEFAULT;
    return {
      operation: args.operation,
      method: "POST",
      path: args.path,
      pushType: args.pushType,
      topic: args.topic,
      priority: args.priority,
      apnsId: args.apnsId,
      expirationSeconds: args.expirationSeconds,
      ...(args.staleDateSeconds !== undefined
        ? { staleDateSeconds: args.staleDateSeconds }
        : {}),
      ...(args.dismissalDateSeconds !== undefined
        ? { dismissalDateSeconds: args.dismissalDateSeconds }
        : {}),
      ...(args.attributesType !== undefined
        ? { attributesType: args.attributesType }
        : {}),
      ...(args.channelId !== undefined ? { channelId: args.channelId } : {}),
      target: args.target,
      snapshotId: args.snapshotId,
      snapshotKind: "liveActivity",
      payload: args.payload,
      payloadJson,
      payloadBytes,
      payloadLimitBytes,
      withinLimit: payloadBytes <= payloadLimitBytes,
    };
  }

  #buildActivityPayload(
    live: LiveSurfaceSnapshotLiveActivity,
    event: "start" | "update" | "end",
    startMeta:
      | { attributesType: string; attributes: Record<string, unknown> }
      | undefined,
    options: SendOptions,
  ): { aps: Record<string, unknown> } {
    const contentState = toLiveActivityContentState(live);
    const aps: Record<string, unknown> = {
      timestamp: nowSec(),
      event,
      "content-state": contentState,
    };
    if (event === "start" && startMeta) {
      aps["attributes-type"] = startMeta.attributesType;
      aps.attributes = startMeta.attributes;
    }
    if (options.staleDateSeconds !== undefined) {
      aps["stale-date"] = options.staleDateSeconds;
    }
    if (options.dismissalDateSeconds !== undefined) {
      aps["dismissal-date"] = options.dismissalDateSeconds;
    }
    return { aps };
  }

  async #sendDevice(args: {
    operation: PushHookOperation;
    snapshotId: string;
    token: string;
    payload: string;
    pushType: "alert" | "liveactivity";
    defaultPriority: 5 | 10;
    apnsTopic: string;
    options: SendOptions;
  }): Promise<PushResult> {
    assertPayloadWithinLimit(args.payload, args.operation as PayloadKind);
    const apnsId = args.options.apnsId ?? genApnsId();
    const priority = args.options.priority ?? args.defaultPriority;
    const expiration = String(args.options.expirationSeconds ?? nowSec() + 3600);
    const headers: Record<string, string> = {
      ":method": "POST",
      ":path": `/3/device/${args.token}`,
      authorization: `bearer ${this.#jwt.get()}`,
      "apns-topic": args.apnsTopic,
      "apns-push-type": args.pushType,
      "apns-priority": String(priority),
      "apns-id": apnsId,
      "apns-expiration": expiration,
      "content-type": "application/json",
    };
    return this.#performWithRetry(this.#send, headers, args.payload, apnsId, {
      operation: args.operation,
      snapshotId: args.snapshotId,
      token: args.token,
      priority,
    });
  }

  // Shared retry loop for both device sends and channel-management requests.
  // The two previously had near-identical loops differing only in the success
  // return shape and which hook fields are populated; `mapSuccess` handles
  // the success-shape difference and `hookMeta` carries the per-operation
  // hook fields. JWT refresh on retry covers ExpiredProviderToken; transport-
  // error retry uses the policy's backoff without consulting Retry-After
  // (no response yet to honor).
  async #executeWithRetry<TSuccess>(
    transport: Http2Client,
    headers: Record<string, string>,
    body: string | undefined,
    hookMeta: {
      operation: PushHookOperation;
      snapshotId?: string;
      token?: string;
      /** apns-id known up-front (device sends generate it client-side). */
      apnsId?: string;
      /**
       * Priority of this send. Drives the priority-aware retry stretch in
       * effectiveRetryPolicy(). Channel-management ops omit this and default
       * to 5, which leaves the base policy unmodified.
       */
      priority?: 5 | 10;
    },
    mapSuccess: (
      res: {
        status: number;
        headers: Record<string, string | string[] | undefined>;
        body: string;
      },
      meta: RetryMeta,
    ) => TSuccess,
  ): Promise<TSuccess> {
    const overallStart = Date.now();
    const retried: RetryAttempt[] = [];
    const policy = effectiveRetryPolicy(this.#retryPolicy, hookMeta.priority ?? 5);
    let attempt = 0;
    while (true) {
      this.#assertOpen();
      const startedAt = Date.now();
      try {
        const res = await transport.request({
          headers,
          body,
          timeoutMs: this.#requestTimeoutMs,
        });
        const durationMs = Date.now() - startedAt;
        // For management ops the apns-id is only known after response;
        // device sends know it up-front and pass it via hookMeta.
        const apnsId = hookMeta.apnsId ?? pickHeader(res.headers, "apns-id");
        if (res.status >= 200 && res.status < 300) {
          this.#fireResponseHook({
            ...hookMeta,
            attempt,
            isFinalAttempt: true,
            apnsId,
            status: res.status,
            durationMs,
          });
          return mapSuccess(res, {
            attempts: attempt + 1,
            latencyMs: Date.now() - overallStart,
            retried,
            trapHits: distinctTrapHits(retried),
          });
        }
        const apnsError = this.#errorFromResponse(res);
        const willRetry =
          this.#shouldRetry(apnsError, policy) &&
          attempt < policy.maxRetries;
        this.#fireErrorHook(apnsError, {
          ...hookMeta,
          attempt,
          isFinalAttempt: !willRetry,
          apnsId,
          status: res.status,
          durationMs,
        });
        if (willRetry) {
          const backoffMs = computeRetryBackoffMs(apnsError, attempt, policy);
          retried.push({
            reason: apnsError.reason,
            trapId: apnsError.trapId,
            status: res.status,
            backoffMs,
          });
          await sleep(backoffMs);
          attempt += 1;
          // Refresh JWT in case the rejection was provider-token-related.
          headers.authorization = `bearer ${this.#jwt.get()}`;
          continue;
        }
        throw apnsError;
      } catch (err) {
        if (err instanceof ApnsError) {
          throw err;
        }
        const willRetry =
          isTransportError(err) && attempt < policy.maxRetries;
        this.#fireErrorHook(err, {
          ...hookMeta,
          attempt,
          isFinalAttempt: !willRetry,
          apnsId: hookMeta.apnsId,
          durationMs: Date.now() - startedAt,
        });
        if (willRetry) {
          const backoffMs = computeBackoffMs(attempt, policy);
          retried.push({
            reason: transportErrorReason(err),
            backoffMs,
          });
          await sleep(backoffMs);
          attempt += 1;
          continue;
        }
        throw err;
      }
    }
  }

  #performManage(
    headers: Record<string, string>,
    body: string | undefined,
    hookMeta: { operation: PushHookOperation; token?: string },
  ): Promise<ChannelManageResponse> {
    // Channel-management callers don't read PushResult metadata today; drop
    // it on the floor to keep the ChannelInfo shape stable. If we ever
    // surface retry stats on management ops we'll thread `meta` into a new
    // field on ChannelInfo rather than changing this signature.
    return this.#executeWithRetry(this.#manage, headers, body, hookMeta, (res) => ({
      status: res.status,
      headers: res.headers,
      body: res.body,
    }));
  }

  #performWithRetry(
    transport: Http2Client,
    headers: Record<string, string>,
    body: string,
    apnsId: string,
    hookMeta: {
      operation: PushHookOperation;
      snapshotId?: string;
      token?: string;
      priority?: 5 | 10;
    },
  ): Promise<PushResult> {
    return this.#executeWithRetry(
      transport,
      headers,
      body,
      { ...hookMeta, apnsId },
      (res, meta) => ({
        apnsId,
        status: res.status,
        timestamp: new Date(),
        attempts: meta.attempts,
        latencyMs: meta.latencyMs,
        retried: meta.retried,
        trapHits: meta.trapHits,
      }),
    );
  }

  #fireResponseHook(context: PushHookContext): void {
    safeInvokeHook(this.#hooks.onResponse, context);
  }

  #fireErrorHook(error: unknown, context: PushHookContext): void {
    safeInvokeHook(this.#hooks.onError, error, context);
  }

  #errorFromResponse(res: { status: number; headers: Record<string, string | string[] | undefined>; body: string }): ApnsError {
    const apnsId = pickHeader(res.headers, "apns-id");
    const parsed = parseApnsErrorBody(res.body);
    const reason = parsed?.reason ?? "Unknown";
    const retryAfter = parseRetryAfterSeconds(pickHeader(res.headers, "retry-after"));
    return reasonToError(reason, {
      status: res.status,
      apnsId,
      timestamp: parsed?.timestamp,
      retryAfterSeconds: retryAfter,
    });
  }

  #shouldRetry(err: ApnsError, policy: RetryPolicy): boolean {
    // Terminal reasons are denied first so a caller-customized
    // retryableReasons set cannot accidentally re-enable retries for
    // permanently-broken tokens (BadDeviceToken, Unregistered, etc.).
    if (TERMINAL_REASONS.has(err.reason)) return false;
    if (err instanceof TooManyRequestsError) return true;
    return policy.retryableReasons.has(err.reason);
  }
}

function computeRetryBackoffMs(
  err: ApnsError,
  attempt: number,
  policy: RetryPolicy,
): number {
  let retryAfterMs: number | undefined;
  if (err instanceof TooManyRequestsError && err.retryAfterSeconds !== undefined) {
    retryAfterMs = err.retryAfterSeconds * 1000;
  }
  return computeBackoffMs(attempt, policy, retryAfterMs);
}

// Distill the retry-attempts log into the set of distinct trap ids that
// surfaced before the eventual success. Returns a fresh tuple-typed array
// so RetryMeta.trapHits is safe to expose as `readonly`.
function distinctTrapHits(retried: readonly RetryAttempt[]): readonly string[] {
  const seen = new Set<string>();
  for (const r of retried) {
    if (r.trapId) seen.add(r.trapId);
  }
  return [...seen];
}

// Best-effort label for a transport-level failure. Falls back to a static
// string so `retried[].reason` is always populated; the precise classification
// already happened in isTransportError.
function transportErrorReason(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "TransportError";
}

/**
 * Construct a `PushClient` bound to a single APNs auth-key + environment.
 */
export function createPushClient(options: CreatePushClientOptions): PushClient {
  return new PushClient(options);
}
