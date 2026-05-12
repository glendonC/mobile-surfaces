// PushClient — the canonical entry point for sending Mobile Surfaces snapshots
// to APNs. One client per (auth-key, environment, bundleId) tuple; a single
// client multiplexes alert / Live-Activity / broadcast / channel-management
// requests over its session pool.

import crypto from "node:crypto";
import {
  liveSurfaceSnapshot,
  toAlertPayload,
  toLiveActivityContentState,
} from "@mobile-surfaces/surface-contracts";
import type {
  LiveSurfaceSnapshot,
  LiveSurfaceSnapshotLiveActivity,
} from "@mobile-surfaces/surface-contracts";

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
import { DEFAULT_RETRY_POLICY, computeBackoffMs, sleep } from "./retry.ts";
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

function payloadBudgetFor(kind: PayloadKind): number {
  return kind === "broadcast" ? MAX_PAYLOAD_BYTES_BROADCAST : MAX_PAYLOAD_BYTES_DEFAULT;
}

function assertPayloadWithinLimit(
  payload: string,
  kind: PayloadKind,
): void {
  const limit = payloadBudgetFor(kind);
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
   * @deprecated Use `_unsafeRetryOverride` if you really need to tune retries.
   * Kept as an alias for one minor version; emits a one-time deprecation
   * warning when set. Will be removed in v3.
   */
  retryPolicy?: Partial<RetryPolicy>;
  /**
   * Operational escape hatch for tests and SRE incident response. Named ugly
   * on purpose: AI consumers should never reach for this, and the prefix is
   * the marker that you're stepping outside the SDK's curated defaults.
   *
   * Use when:
   * - A test needs deterministic retry timing (`{ maxRetries: 0, jitter: false }`).
   * - You're draining traffic during an Apple-side incident.
   * - You're handling a multi-tenant rate-limit budget the SDK can't model.
   *
   * Don't use for: tuning your "normal" retries. The defaults are
   * priority-aware (priority-10 sends get a stricter profile automatically)
   * and honor Retry-After. There is essentially no daily-driver tuning case.
   *
   * Precedence (highest wins):
   *   1. MOBILE_SURFACES_PUSH_DISABLE_RETRY=1 (sets maxRetries=0)
   *   2. _unsafeRetryOverride
   *   3. retryPolicy (deprecated alias)
   *   4. DEFAULT_RETRY_POLICY
   */
  _unsafeRetryOverride?: Partial<RetryPolicy>;
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
 * One observed retry during a send. Emitted in order on `PushResult.retried`
 * so an agent can reconstruct what happened without subscribing to hooks.
 * `attempt` is 0-indexed and identifies the attempt that failed (attempt 0 is
 * the first try). `reason` is the APNs reason string for HTTP failures or the
 * Node error code (e.g. "ECONNRESET") for transport failures. `backoffMs` is
 * the actual sleep before the next attempt — equal to Retry-After when APNs
 * supplied it, otherwise the computed exponential backoff.
 */
export interface RetryEvent {
  attempt: number;
  reason: string;
  backoffMs: number;
  trapId?: string;
}

/**
 * Result of a successful send. Carries enough structured context that an AI
 * consumer can answer "did this work, how hard did the SDK try, did we trip
 * any traps along the way?" without parsing log lines or subscribing to
 * hooks. SendResponse is a backwards-compatible alias.
 */
export interface PushResult {
  /** APNs request id (echoed in the apns-id response header). */
  apnsId: string;
  /** HTTP status of the final, successful response (always 2xx). */
  status: number;
  /** Wall-clock timestamp of the successful response. */
  timestamp: Date;
  /** Total number of attempts made, including the successful one. >=1. */
  attempts: number;
  /** Cumulative wall-clock ms across all attempts (including backoff sleeps). */
  latencyMs: number;
  /** Ordered list of failed attempts preceding the success. Empty on first-try success. */
  retried: ReadonlyArray<RetryEvent>;
  /** Unique trap ids surfaced during retries. Empty when no trap-bound error fired. */
  trapHits: ReadonlyArray<string>;
}

/** @deprecated Use `PushResult`. Kept for backwards compatibility. */
export type SendResponse = PushResult;

/** Operations describeSend can plan. Mirrors the public send methods. */
export type DescribeSendOperation = "alert" | "update" | "start" | "end" | "broadcast";

/**
 * Side-effect-free description of what a send would do. Returned by
 * `client.describeSend(...)`; lets an AI consumer (or a test) verify the
 * envelope an APNs request would carry without making the network round-trip.
 *
 * Shares the same code path as the real send methods: payload construction,
 * priority resolution, topic computation, and the priority-aware retry
 * policy are all derived identically. The only thing describeSend skips is
 * the JWT-signed HTTP/2 dispatch.
 *
 * `withinBudget` is false when the serialized payload exceeds the MS011
 * ceiling (4 KB device / 5 KB broadcast). Unlike the live send, describeSend
 * never throws on oversize; it surfaces the overrun via this flag and
 * populates `trapHits` with "MS011" so an agent can fix the snapshot before
 * committing.
 */
export interface DescribedSend {
  operation: DescribeSendOperation;
  /** apns-push-type the SDK would send. */
  pushType: "alert" | "liveactivity";
  /** apns-topic the SDK would send. Undefined for broadcast (path-routed). */
  topic: string | undefined;
  /** apns-priority that would be applied (caller override wins; otherwise the per-op default). */
  priority: 5 | 10;
  /** Serialized JSON payload size in bytes. */
  payloadBytes: number;
  /** MS011 ceiling for this kind of send (4096 device, 5120 broadcast). */
  budgetLimit: number;
  /** True when payloadBytes <= budgetLimit. */
  withinBudget: boolean;
  /** Catalog trap ids this send would currently trip. Empty on a clean plan. */
  trapHits: ReadonlyArray<string>;
  /**
   * Retry policy that would apply on a TooManyRequests / transient failure.
   * Reflects the priority-aware adjustment (priority-10 sends get a stricter
   * profile) without exposing it as a knob.
   */
  effectiveRetryPolicy: RetryPolicy;
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

// Module-level latch so the deprecation warning fires once per process, not
// once per createPushClient call. Tests can reset this via the named export
// below; production code should never need to.
let retryPolicyDeprecationWarned = false;

/**
 * Reset the one-time `retryPolicy` deprecation-warning latch. Test-only; the
 * production path lets the warning fire once and stay quiet.
 */
export function __resetRetryPolicyDeprecationLatch(): void {
  retryPolicyDeprecationWarned = false;
}

function resolveRetryPolicy(options: CreatePushClientOptions): RetryPolicy {
  const fromDeprecated = options.retryPolicy;
  if (fromDeprecated && !retryPolicyDeprecationWarned) {
    retryPolicyDeprecationWarned = true;
    const warn = (globalThis as { console?: { warn?: (...args: unknown[]) => void } })
      .console?.warn;
    if (warn) {
      warn(
        "[@mobile-surfaces/push] createPushClient.retryPolicy is deprecated; " +
          "use _unsafeRetryOverride for the same effect. retryPolicy will be " +
          "removed in v3. See docs/push.md#retry-policy.",
      );
    }
  }
  const merged: RetryPolicy = {
    ...DEFAULT_RETRY_POLICY,
    ...(fromDeprecated ?? {}),
    ...(options._unsafeRetryOverride ?? {}),
  };
  // Env-var kill switch always wins. Use case: SRE drains traffic during an
  // APNs incident without redeploying. The value is intentionally coarse
  // (sets maxRetries=0) because finer tuning belongs in code, not env.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  if (env?.MOBILE_SURFACES_PUSH_DISABLE_RETRY === "1") {
    return { ...merged, maxRetries: 0 };
  }
  return merged;
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

    const keyPem = resolveKeyPem(options.keyPath);
    this.#jwt = new JwtCache({
      keyPem,
      keyId: options.keyId,
      teamId: options.teamId,
    });

    const idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
    const override = (options as unknown as Record<symbol, unknown>)[
      TEST_TRANSPORT_OVERRIDE
    ] as TestTransportOverride | undefined;
    this.#requestTimeoutMs = override?.requestTimeoutMs;

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
    const payload = JSON.stringify(toAlertPayload(validated));
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
    const priority = String(options.priority ?? 5);
    const headers: Record<string, string> = {
      ":method": "POST",
      ":path": `/4/broadcasts/apps/${this.#options.bundleId}`,
      authorization: `bearer ${this.#jwt.get()}`,
      "apns-channel-id": channelId,
      "apns-push-type": "liveactivity",
      "apns-priority": priority,
      "apns-id": apnsId,
      "apns-expiration": "0",
      "content-type": "application/json",
    };
    return this.#performWithRetry(this.#send, headers, payload, apnsId, {
      operation: "broadcast",
      snapshotId: live.id,
      token: channelId,
    });
  }

  /**
   * Side-effect-free plan of what a send would do. Returns the envelope the
   * SDK would put on the wire (push type, topic, priority, payload bytes)
   * plus the effective retry policy that would apply and any traps the send
   * would trip (e.g. MS011 if oversized).
   *
   * Never dispatches an HTTP request; never mints a JWT. Safe to call without
   * APNs credentials configured. Useful for AI consumers verifying a snapshot
   * before committing, and for tests that want to assert the envelope without
   * an APNs key.
   *
   * Throws `InvalidSnapshotError` only when the snapshot itself fails
   * validation (Zod schema or kind mismatch) — the same contract as the live
   * send. Oversized payloads surface via `withinBudget: false` + a "MS011"
   * trapHit rather than throwing.
   */
  describeSend(
    operation: DescribeSendOperation,
    snapshot: LiveSurfaceSnapshot,
    options: SendOptions | LiveActivityStartOptions | BroadcastOptions = {},
  ): DescribedSend {
    const validated = validateSnapshot(snapshot);
    const live = snapshotMustBeLiveActivity(validated, `describeSend(${operation})`);
    let pushType: "alert" | "liveactivity";
    let topic: string | undefined;
    let defaultPriority: 5 | 10;
    let payload: string;
    if (operation === "alert") {
      pushType = "alert";
      topic = this.#options.bundleId;
      defaultPriority = 10;
      payload = JSON.stringify(toAlertPayload(validated));
    } else if (operation === "broadcast") {
      pushType = "liveactivity";
      topic = undefined;
      defaultPriority = 5;
      payload = JSON.stringify(
        this.#buildActivityPayload(live, "update", undefined, options),
      );
    } else {
      pushType = "liveactivity";
      topic = `${this.#options.bundleId}.push-type.liveactivity`;
      defaultPriority = 5;
      if (operation === "start") {
        const startOptions = options as LiveActivityStartOptions;
        const attributesType = startOptions.attributesType ?? "MobileSurfacesActivityAttributes";
        payload = JSON.stringify(
          this.#buildActivityPayload(
            live,
            "start",
            { attributesType, attributes: {} },
            options,
          ),
        );
      } else if (operation === "end") {
        const dismissalSeconds = options.dismissalDateSeconds ?? nowSec();
        payload = JSON.stringify(
          this.#buildActivityPayload(live, "end", undefined, {
            ...options,
            dismissalDateSeconds: dismissalSeconds,
          }),
        );
      } else {
        payload = JSON.stringify(
          this.#buildActivityPayload(live, "update", undefined, options),
        );
      }
    }
    const priority: 5 | 10 = options.priority ?? defaultPriority;
    const payloadBytes = Buffer.byteLength(payload, "utf8");
    const budgetKind: PayloadKind = operation === "broadcast" ? "broadcast" : operation;
    const budgetLimit = payloadBudgetFor(budgetKind);
    const withinBudget = payloadBytes <= budgetLimit;
    const trapHits = withinBudget ? [] : ["MS011"];
    const effectiveRetryPolicy = this.#effectivePolicyFor({
      "apns-priority": String(priority),
    });
    return {
      operation,
      pushType,
      topic,
      priority,
      payloadBytes,
      budgetLimit,
      withinBudget,
      trapHits,
      effectiveRetryPolicy,
    };
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
    const priority = String(args.options.priority ?? args.defaultPriority);
    const expiration = String(args.options.expirationSeconds ?? nowSec() + 3600);
    const headers: Record<string, string> = {
      ":method": "POST",
      ":path": `/3/device/${args.token}`,
      authorization: `bearer ${this.#jwt.get()}`,
      "apns-topic": args.apnsTopic,
      "apns-push-type": args.pushType,
      "apns-priority": priority,
      "apns-id": apnsId,
      "apns-expiration": expiration,
      "content-type": "application/json",
    };
    return this.#performWithRetry(this.#send, headers, args.payload, apnsId, {
      operation: args.operation,
      snapshotId: args.snapshotId,
      token: args.token,
    });
  }

  // Shared retry loop for both device sends and channel-management requests.
  // The two previously had near-identical loops differing only in the success
  // return shape and which hook fields are populated; `mapSuccess` handles
  // the success-shape difference and `hookMeta` carries the per-operation
  // hook fields. JWT refresh on retry covers ExpiredProviderToken; transport-
  // error retry uses the policy's backoff without consulting Retry-After
  // (no response yet to honor).
  //
  // The retry tracker (retried[], cumulative latency, unique trap hits) is
  // accumulated across attempts and handed to mapSuccess so device sends can
  // surface it on PushResult. Management ops can ignore it.
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
    },
    mapSuccess: (
      res: {
        status: number;
        headers: Record<string, string | string[] | undefined>;
        body: string;
      },
      tracker: { attempts: number; latencyMs: number; retried: RetryEvent[]; trapHits: string[] },
    ) => TSuccess,
  ): Promise<TSuccess> {
    let attempt = 0;
    const retried: RetryEvent[] = [];
    const trapHitsSet = new Set<string>();
    let cumulativeLatencyMs = 0;
    // Priority 10 sends are budgeted aggressively by iOS (MS015); throttle
    // recovery there should back off harder and give up sooner than priority
    // 5 (which has more headroom). The differentiation is fixed internal
    // behavior — no knob — so AI consumers never have to choose. Retry-After
    // from APNs still wins when present (computeBackoffMs honors it).
    const effectivePolicy = this.#effectivePolicyFor(headers);
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
        cumulativeLatencyMs += durationMs;
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
            latencyMs: cumulativeLatencyMs,
            retried,
            trapHits: [...trapHitsSet],
          });
        }
        const apnsError = this.#errorFromResponse(res);
        const willRetry =
          this.#shouldRetry(apnsError, attempt) &&
          attempt < effectivePolicy.maxRetries;
        this.#fireErrorHook(apnsError, {
          ...hookMeta,
          attempt,
          isFinalAttempt: !willRetry,
          apnsId,
          status: res.status,
          durationMs,
        });
        if (willRetry) {
          const backoffMs = await this.#waitForRetry(apnsError, attempt, effectivePolicy);
          cumulativeLatencyMs += backoffMs;
          retried.push({
            attempt,
            reason: apnsError.reason,
            backoffMs,
            ...(apnsError.trapId ? { trapId: apnsError.trapId } : {}),
          });
          if (apnsError.trapId) trapHitsSet.add(apnsError.trapId);
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
          isTransportError(err) && attempt < this.#retryPolicy.maxRetries;
        const durationMs = Date.now() - startedAt;
        cumulativeLatencyMs += durationMs;
        this.#fireErrorHook(err, {
          ...hookMeta,
          attempt,
          isFinalAttempt: !willRetry,
          apnsId: hookMeta.apnsId,
          durationMs,
        });
        if (willRetry) {
          const backoffMs = computeBackoffMs(attempt, effectivePolicy);
          await sleep(backoffMs);
          cumulativeLatencyMs += backoffMs;
          retried.push({
            attempt,
            reason: transportErrorCode(err) ?? "TransportError",
            backoffMs,
          });
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
    // Management ops don't expose a PushResult, so the tracker is dropped.
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
    },
  ): Promise<PushResult> {
    return this.#executeWithRetry(
      transport,
      headers,
      body,
      { ...hookMeta, apnsId },
      (res, tracker) => ({
        apnsId,
        status: res.status,
        timestamp: new Date(),
        attempts: tracker.attempts,
        latencyMs: tracker.latencyMs,
        retried: tracker.retried,
        trapHits: tracker.trapHits,
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

  #shouldRetry(err: ApnsError, _attempt: number): boolean {
    // Terminal reasons are denied first so a caller-customized
    // retryableReasons set cannot accidentally re-enable retries for
    // permanently-broken tokens (BadDeviceToken, Unregistered, etc.).
    if (TERMINAL_REASONS.has(err.reason)) return false;
    if (err instanceof TooManyRequestsError) return true;
    return this.#retryPolicy.retryableReasons.has(err.reason);
  }

  async #waitForRetry(
    err: ApnsError,
    attempt: number,
    policy: RetryPolicy,
  ): Promise<number> {
    let retryAfterMs: number | undefined;
    if (err instanceof TooManyRequestsError && err.retryAfterSeconds !== undefined) {
      retryAfterMs = err.retryAfterSeconds * 1000;
    }
    const backoffMs = computeBackoffMs(attempt, policy, retryAfterMs);
    await sleep(backoffMs);
    return backoffMs;
  }

  // Per-request retry policy adjusted for priority. Priority 10 (alerts, state
  // transitions the user must see) gets a stricter profile: tighter retry
  // count, harder backoff floor and cap. This is fixed internal behavior —
  // not a constructor knob — because picking the right policy here is not
  // something a calling agent should have to reason about. The base policy
  // (possibly overridden via _unsafeRetryOverride for tests/SRE escape hatch)
  // is the floor that priority-10 multiplies from.
  //
  // Apple does not publish exact rate-limit numbers, so the chosen multipliers
  // are conservative: 2x base/cap, maxRetries clamped to 2. Retry-After from
  // APNs still wins when present (computeBackoffMs honors it).
  #effectivePolicyFor(headers: Record<string, string>): RetryPolicy {
    const priority = headers["apns-priority"];
    if (priority !== "10") return this.#retryPolicy;
    return {
      ...this.#retryPolicy,
      maxRetries: Math.min(this.#retryPolicy.maxRetries, 2),
      baseDelayMs: this.#retryPolicy.baseDelayMs * 2,
      maxDelayMs: this.#retryPolicy.maxDelayMs * 2,
    };
  }
}

// Try to recover a Node error code from a transport error so retry-tracking
// can record something meaningful (ECONNRESET, ETIMEDOUT, etc.) rather than a
// generic "TransportError" string.
function transportErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Construct a `PushClient` bound to a single APNs auth-key + environment.
 */
export function createPushClient(options: CreatePushClientOptions): PushClient {
  return new PushClient(options);
}
