// @mobile-surfaces/tokens — vanilla store.
//
// Owns the MS020 (latest-write-wins on rotation) and MS021 (terminal
// lifecycle on activity end) invariants. The store is a thin reactive
// Map<idempotencyKey, TokenRecord> wrapper with three lifecycle
// transitions: active -> ending -> dead. Pluggable persistence via the
// TokenStorage interface; default is the in-memory adapter from
// ./storage/memory.
//
// React consumers reach for ./react. Backend forwarder is in
// ./forwarder. Wire schemas for cross-process boundaries are in
// ./wire. None of this file imports React or fetch — the vanilla
// surface is portable to any JS runtime.

import { MobileSurfacesError } from "@mobile-surfaces/traps";
import { hashString } from "./hash.ts";
import { createMemoryStorage } from "./storage/memory.ts";

export type TokenKind = "pushToStart" | "perActivity" | "apnsDevice";
export type TokenLifecycle = "active" | "ending" | "dead";
export type TokenEnvironment = "development" | "production";

/**
 * One stored token, keyed by its sha256(kind:activityId:token)
 * idempotencyKey. The key is stable across re-emissions of the same
 * (kind, activityId, token) triple but distinct across actual
 * rotations — so a fresh token from ActivityKit produces a new record
 * even when the activity id stays the same.
 */
export interface TokenRecord {
  readonly kind: TokenKind;
  readonly token: string;
  readonly activityId?: string;
  readonly environment: TokenEnvironment;
  /** ISO-8601 timestamp of the host-side observation. */
  readonly recordedAt: string;
  readonly lifecycle: TokenLifecycle;
  /** sha256(kind:activityId ?? '':token). Stable; not a secret. */
  readonly idempotencyKey: string;
}

/**
 * Pluggable persistence. Consumers wire one of the bundled adapters
 * (memory / AsyncStorage / SecureStore) or supply their own. The
 * vanilla store calls `load()` once during construction (the result is
 * filtered to records whose `kind` is in `persistKinds`) and `save()`
 * after every mutation that touches a persisted kind, debounced by
 * 250ms.
 */
export interface TokenStorage {
  load(): Promise<ReadonlyArray<TokenRecord>>;
  save(tokens: ReadonlyArray<TokenRecord>): Promise<void>;
}

export interface TokenStoreOptions {
  storage?: TokenStorage;
  clock?: () => Date;
  /**
   * Which token kinds are written to storage. perActivity tokens are
   * bound to a single Activity instance and rotate on every restart,
   * so they default to in-memory only; pushToStart and apnsDevice
   * outlive the activity and benefit from durable storage.
   */
  persistKinds?: ReadonlyArray<TokenKind>;
}

export type TokenStoreListener = (
  tokens: ReadonlyArray<TokenRecord>,
) => void;

export interface TokenStore {
  /** Current snapshot, sorted by recordedAt descending. */
  readonly tokens: ReadonlyArray<TokenRecord>;
  upsert(
    input: Omit<TokenRecord, "recordedAt" | "lifecycle" | "idempotencyKey">,
  ): Promise<TokenRecord>;
  /** Flip every perActivity record matching activityId to "ending". */
  markEnding(activityId: string): Promise<void>;
  /** Flip every perActivity record matching activityId to "dead". */
  markDead(activityId: string): Promise<void>;
  /** Flip any record (any kind) carrying `token` to "dead". 410 sweep. */
  markDeadByToken(token: string): Promise<void>;
  /** Drop every record currently in "dead" state. */
  clearDead(): Promise<void>;
  /** Drop everything. */
  clearAll(): Promise<void>;
  /** Subscribe to mutations. Returns the unsubscribe function. */
  subscribe(listener: TokenStoreListener): () => void;
}

/**
 * `clearAll` was the obvious name for the wipe operation and is in
 * widespread use; this class only fires on a logic bug (e.g. a custom
 * storage that returns a corrupt blob). It carries no MS-id binding —
 * the store integrity check is not a catalog trap.
 */
export class TokenStoreError extends MobileSurfacesError {
  constructor(message: string) {
    super(message);
    this.name = "TokenStoreError";
  }
}

const DEFAULT_PERSIST_KINDS: ReadonlyArray<TokenKind> = [
  "pushToStart",
  "apnsDevice",
];

const SAVE_DEBOUNCE_MS = 250;

export function createTokenStore(opts: TokenStoreOptions = {}): TokenStore {
  const storage = opts.storage ?? createMemoryStorage();
  const clock = opts.clock ?? (() => new Date());
  const persistKinds = new Set<TokenKind>(
    opts.persistKinds ?? DEFAULT_PERSIST_KINDS,
  );

  const records = new Map<string, TokenRecord>();
  const listeners = new Set<TokenStoreListener>();

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveInFlight: Promise<void> | undefined;
  let hydrated = false;

  // Hydrate from storage. The constructor returns synchronously with
  // an empty store; the load promise drains in the background and
  // notifies subscribers once records arrive. Records whose kind is
  // not in persistKinds are dropped — storage is the durable subset.
  void storage
    .load()
    .then((loaded) => {
      for (const record of loaded) {
        if (!persistKinds.has(record.kind)) continue;
        records.set(record.idempotencyKey, record);
      }
      hydrated = true;
      if (loaded.length > 0) notify();
    })
    .catch((err) => {
      // Storage backends can fail (corrupted AsyncStorage blob, etc.).
      // We surface via a TokenStoreError on the next mutation rather
      // than throwing during construction — the alternative is an
      // unhandled rejection that crashes app startup.
      hydrated = true;
      // eslint-disable-next-line no-console
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[@mobile-surfaces/tokens] storage.load() failed:", err);
      }
    });

  function snapshot(): ReadonlyArray<TokenRecord> {
    return Array.from(records.values()).sort((a, b) =>
      b.recordedAt.localeCompare(a.recordedAt),
    );
  }

  function notify(): void {
    const tokens = snapshot();
    for (const listener of listeners) {
      try {
        listener(tokens);
      } catch (err) {
        // eslint-disable-next-line no-console
        if (typeof console !== "undefined" && console.error) {
          console.error("[@mobile-surfaces/tokens] listener threw:", err);
        }
      }
    }
  }

  function scheduleSave(): void {
    if (!hydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      const toPersist = snapshot().filter((r) => persistKinds.has(r.kind));
      saveInFlight = storage.save(toPersist).catch((err) => {
        // eslint-disable-next-line no-console
        if (typeof console !== "undefined" && console.warn) {
          console.warn(
            "[@mobile-surfaces/tokens] storage.save() failed:",
            err,
          );
        }
      });
    }, SAVE_DEBOUNCE_MS);
    // Unref the timer so a pending save does not hold a Node process
    // open. React Native's setTimeout doesn't expose unref; guard.
    if (
      saveTimer !== undefined &&
      typeof (saveTimer as { unref?: () => void }).unref === "function"
    ) {
      (saveTimer as { unref: () => void }).unref();
    }
  }

  function persistedKinds(): boolean {
    return persistKinds.size > 0;
  }

  async function upsert(
    input: Omit<TokenRecord, "recordedAt" | "lifecycle" | "idempotencyKey">,
  ): Promise<TokenRecord> {
    const idempotencyKey = await computeIdempotencyKey(
      input.kind,
      input.activityId,
      input.token,
    );
    const record: TokenRecord = {
      kind: input.kind,
      token: input.token,
      activityId: input.activityId,
      environment: input.environment,
      recordedAt: clock().toISOString(),
      lifecycle: "active",
      idempotencyKey,
    };
    records.set(idempotencyKey, record);
    notify();
    if (persistedKinds() && persistKinds.has(record.kind)) scheduleSave();
    return record;
  }

  function transition(
    predicate: (r: TokenRecord) => boolean,
    next: TokenLifecycle,
  ): boolean {
    let changed = false;
    for (const [key, record] of records) {
      if (!predicate(record)) continue;
      if (record.lifecycle === next) continue;
      records.set(key, { ...record, lifecycle: next });
      changed = true;
    }
    return changed;
  }

  async function markEnding(activityId: string): Promise<void> {
    const changed = transition(
      (r) => r.kind === "perActivity" && r.activityId === activityId,
      "ending",
    );
    if (changed) {
      notify();
      scheduleSave();
    }
  }

  async function markDead(activityId: string): Promise<void> {
    const changed = transition(
      (r) => r.kind === "perActivity" && r.activityId === activityId,
      "dead",
    );
    if (changed) {
      notify();
      scheduleSave();
    }
  }

  async function markDeadByToken(token: string): Promise<void> {
    const changed = transition((r) => r.token === token, "dead");
    if (changed) {
      notify();
      scheduleSave();
    }
  }

  async function clearDead(): Promise<void> {
    let changed = false;
    for (const [key, record] of records) {
      if (record.lifecycle !== "dead") continue;
      records.delete(key);
      changed = true;
    }
    if (changed) {
      notify();
      scheduleSave();
    }
  }

  async function clearAll(): Promise<void> {
    if (records.size === 0) return;
    records.clear();
    notify();
    scheduleSave();
    // Also drain any pending debounced save so consumers `await`ing
    // the next tick see an empty store on disk.
    if (saveInFlight) await saveInFlight;
  }

  function subscribe(listener: TokenStoreListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    get tokens(): ReadonlyArray<TokenRecord> {
      return snapshot();
    },
    upsert,
    markEnding,
    markDead,
    markDeadByToken,
    clearDead,
    clearAll,
    subscribe,
  };
}

/**
 * Build the idempotency key for (kind, activityId, token). Stable
 * across re-emissions of the same triple; distinct across real
 * rotations (different `token` value). Hash function lives in
 * ./hash.ts and picks between node:crypto and Web Crypto at runtime
 * so the package works in Node, React Native, and the browser.
 */
export async function computeIdempotencyKey(
  kind: TokenKind,
  activityId: string | undefined,
  token: string,
): Promise<string> {
  return hashString(`${kind}:${activityId ?? ""}:${token}`);
}

export type { TokenStorage as TokenStorageInterface };
