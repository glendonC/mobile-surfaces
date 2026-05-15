// Reference implementation of the MS020 / MS021 invariants in a single
// hook. Demonstrates the right shape for:
//
//   - MS020: treat the latest token event as authoritative. Every emission
//     overwrites the prior entry for the same (kind, activityId?) key —
//     never appends a duplicate.
//   - MS021: discard per-activity tokens when the activity ends. The
//     harness's onActivityStateChange listener calls removeForActivity
//     on terminal states so the store doesn't accumulate dead tokens.
//
// Storage is module-level for the demo — this hook survives a React
// re-render but NOT a process restart. A production app should persist
// each upsert. The shape is deliberately compatible with
// @react-native-async-storage/async-storage's getItem / setItem so the
// swap is a one-paragraph change in the JSON read/write closures below.
// AsyncStorage isn't in the demo's runtime deps because adding it would
// require a fresh `expo prebuild --clean`, which the harness explicitly
// tries to avoid.

import { useEffect, useState, useCallback } from "react";

export type TokenKind = "pushToStart" | "perActivity" | "apnsDevice";

export interface StoredToken {
  readonly kind: TokenKind;
  readonly token: string;
  readonly activityId?: string;
  readonly environment: "development" | "production";
  /** ISO-8601 timestamp of the emission the host observed. */
  readonly recordedAt: string;
}

export interface TokenStore {
  /** Current set of tokens, latest-first by `recordedAt`. */
  readonly tokens: ReadonlyArray<StoredToken>;
  /**
   * Upsert keyed by (kind, activityId ?? null). Latest write wins (MS020).
   * Returns the inserted record so callers can chain a network forward.
   */
  upsert(t: StoredToken): Promise<StoredToken>;
  /**
   * Remove every token for a single activity (MS021: terminal state means
   * the per-activity token is dead).
   */
  removeForActivity(activityId: string): Promise<void>;
  /** Wipe the entire store. */
  clearAll(): Promise<void>;
}

// Module-level cache. A production app would back this with AsyncStorage
// (see file header). The shape stays the same so the swap is mechanical.
let cache: StoredToken[] = [];
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) fn();
}

function keyOf(t: { kind: TokenKind; activityId?: string }): string {
  return `${t.kind}:${t.activityId ?? ""}`;
}

function upsertImpl(t: StoredToken): StoredToken {
  // MS020: dedupe by (kind, activityId?). The newest record wins.
  const target = keyOf(t);
  cache = [t, ...cache.filter((existing) => keyOf(existing) !== target)];
  notify();
  return t;
}

function removeForActivityImpl(activityId: string): void {
  cache = cache.filter((t) => t.activityId !== activityId);
  notify();
}

function clearAllImpl(): void {
  cache = [];
  notify();
}

export function useTokenStore(): TokenStore {
  const [, force] = useState({});
  useEffect(() => {
    const rerender = () => force({});
    subscribers.add(rerender);
    return () => {
      subscribers.delete(rerender);
    };
  }, []);

  const upsert = useCallback(async (t: StoredToken) => upsertImpl(t), []);
  const removeForActivity = useCallback(
    async (activityId: string) => removeForActivityImpl(activityId),
    [],
  );
  const clearAll = useCallback(async () => clearAllImpl(), []);

  return { tokens: cache, upsert, removeForActivity, clearAll };
}
