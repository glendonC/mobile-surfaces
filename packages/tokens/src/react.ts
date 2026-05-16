// React hook for @mobile-surfaces/tokens. Wires the adapter's token
// events (onPushToken, onPushToStartToken, onActivityStateChange) into
// a TokenStore at mount, tears down at unmount, and re-renders the
// host on every store mutation.
//
// The store itself is created once via useRef so a re-render does not
// rebuild it. Adapter listeners are also attached once per adapter
// identity. Consumers that swap adapters mid-session create a new
// store; that is intentional — adapter identity changing is a sign
// of an environment swap, which should reset the lifecycle anyway.
//
// MS020: every emission re-upserts, latest-write-wins keyed by
// idempotencyKey.
// MS021: terminal ActivityKit lifecycle states (`ended`, `dismissed`)
// flip every perActivity record matching activityId to dead via
// store.markDead.

import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveActivityAdapter } from "@mobile-surfaces/live-activity";
import { createTokenStore } from "./index.ts";
import type {
  TokenEnvironment,
  TokenKind,
  TokenRecord,
  TokenStorage,
  TokenStore,
} from "./index.ts";
import type { TokenForwarder } from "./forwarder.ts";

export interface UseTokenStoreOptions {
  adapter: LiveActivityAdapter;
  environment: TokenEnvironment;
  storage?: TokenStorage;
  persistKinds?: ReadonlyArray<TokenKind>;
  /** Optional forwarder; on every upsert, the record is forwarded. */
  forwarder?: TokenForwarder;
  /** Forwarder failures land here. Throws are swallowed otherwise. */
  onForwardError?: (err: unknown, record: TokenRecord) => void;
}

export function useTokenStore(opts: UseTokenStoreOptions): TokenStore {
  const {
    adapter,
    environment,
    storage,
    persistKinds,
    forwarder,
    onForwardError,
  } = opts;

  // Single store across renders. The deps for createTokenStore (storage,
  // persistKinds, clock) are captured once; consumers who genuinely
  // need to swap should remount.
  const storeRef = useRef<TokenStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createTokenStore({ storage, persistKinds });
  }
  const store = storeRef.current;

  // Keep a stable ref to options that the listener closures need so we
  // don't re-subscribe on every option-only change.
  const environmentRef = useRef(environment);
  environmentRef.current = environment;
  const forwarderRef = useRef<TokenForwarder | undefined>(forwarder);
  forwarderRef.current = forwarder;
  const onForwardErrorRef = useRef<typeof onForwardError>(onForwardError);
  onForwardErrorRef.current = onForwardError;

  // Bump on every store mutation so React re-renders with the new
  // snapshot. The store itself is the source of truth; this counter is
  // just the re-render trigger.
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsub = store.subscribe(() => setTick((t: number) => (t + 1) % 1_000_000));
    return unsub;
  }, [store]);

  // Subscribe to adapter token events. Listener identity is stable
  // because we keep the latest environment / forwarder in refs.
  useEffect(() => {
    async function upsertAndForward(
      input: Parameters<TokenStore["upsert"]>[0],
    ): Promise<void> {
      const record = await store.upsert(input);
      const f = forwarderRef.current;
      if (!f) return;
      try {
        const result = await f.forward(record);
        if (result.kind === "error" && onForwardErrorRef.current) {
          onForwardErrorRef.current(new Error(result.message), record);
        }
      } catch (err) {
        if (onForwardErrorRef.current) {
          onForwardErrorRef.current(err, record);
        }
      }
    }

    const subs: Array<{ remove(): void }> = [];

    subs.push(
      adapter.addListener("onPushToken", (payload) => {
        void upsertAndForward({
          kind: "perActivity",
          token: payload.token,
          activityId: payload.activityId,
          environment: environmentRef.current,
        });
      }),
    );

    subs.push(
      adapter.addListener("onPushToStartToken", (payload) => {
        void upsertAndForward({
          kind: "pushToStart",
          token: payload.token,
          environment: environmentRef.current,
        });
      }),
    );

    subs.push(
      adapter.addListener("onActivityStateChange", (payload) => {
        if (payload.state === "ended" || payload.state === "dismissed") {
          void store.markDead(payload.activityId);
        } else if (payload.state === "stale") {
          // Stale is informational; MS021 only fires on terminal
          // states. We flip per-activity records to "ending" so the
          // host can render a "winding down" affordance if it cares.
          void store.markEnding(payload.activityId);
        }
      }),
    );

    return () => {
      for (const s of subs) {
        try {
          s.remove();
        } catch {
          /* ignore */
        }
      }
    };
  }, [adapter, store]);

  // Memoize the returned object so React equality on consumers stays
  // sane even though `store` itself is a stable reference. The
  // returned `tokens` getter on the store snapshots on every read;
  // consumers can rely on the latest re-render seeing the latest
  // array.
  return useMemo(() => store, [store]);
}
