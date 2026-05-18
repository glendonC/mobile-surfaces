// Unit tests for the vanilla token store. Exercises:
//   - upsert idempotency (same triple -> same key; rotation -> new key)
//   - markEnding / markDead semantics scoped to perActivity by activityId
//   - markDeadByToken across kinds
//   - clearDead drops only dead records
//   - subscribe fires on mutation and unsubscribe cleans up

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createTokenStore,
  computeIdempotencyKey,
  type TokenRecord,
} from "../src/index.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";

const ENV = "development" as const;

test("upsert keys identical triples to the same record", async () => {
  const store = createTokenStore();
  const a = await store.upsert({
    kind: "perActivity",
    token: "tok-1",
    activityId: "act-1",
    environment: ENV,
  });
  const b = await store.upsert({
    kind: "perActivity",
    token: "tok-1",
    activityId: "act-1",
    environment: ENV,
  });
  assert.equal(a.idempotencyKey, b.idempotencyKey);
  assert.equal(store.tokens.length, 1);
});

test("upsert with rotated token creates a fresh record", async () => {
  const store = createTokenStore();
  await store.upsert({
    kind: "perActivity",
    token: "tok-1",
    activityId: "act-1",
    environment: ENV,
  });
  await store.upsert({
    kind: "perActivity",
    token: "tok-2",
    activityId: "act-1",
    environment: ENV,
  });
  assert.equal(store.tokens.length, 2);
  const tokens = store.tokens.map((r) => r.token).sort();
  assert.deepEqual(tokens, ["tok-1", "tok-2"]);
});

test("markDead flips only perActivity records matching the activityId", async () => {
  const store = createTokenStore();
  await store.upsert({
    kind: "perActivity",
    token: "tok-a",
    activityId: "act-a",
    environment: ENV,
  });
  await store.upsert({
    kind: "perActivity",
    token: "tok-b",
    activityId: "act-b",
    environment: ENV,
  });
  await store.upsert({
    kind: "pushToStart",
    token: "p2s",
    environment: ENV,
  });
  await store.markDead("act-a");
  const byToken = new Map(store.tokens.map((r) => [r.token, r]));
  assert.equal(byToken.get("tok-a")?.lifecycle, "dead");
  assert.equal(byToken.get("tok-b")?.lifecycle, "active");
  assert.equal(byToken.get("p2s")?.lifecycle, "active");
});

test("markEnding flips matching perActivity records to ending", async () => {
  const store = createTokenStore();
  await store.upsert({
    kind: "perActivity",
    token: "tok",
    activityId: "act-1",
    environment: ENV,
  });
  await store.markEnding("act-1");
  assert.equal(store.tokens[0]?.lifecycle, "ending");
});

test("markDeadByToken flips any record matching the token", async () => {
  const store = createTokenStore();
  await store.upsert({
    kind: "apnsDevice",
    token: "dev-1",
    environment: ENV,
  });
  await store.markDeadByToken("dev-1");
  assert.equal(store.tokens[0]?.lifecycle, "dead");
});

test("clearDead drops dead records and leaves the rest", async () => {
  const store = createTokenStore();
  await store.upsert({
    kind: "perActivity",
    token: "tok-a",
    activityId: "act-a",
    environment: ENV,
  });
  await store.upsert({
    kind: "perActivity",
    token: "tok-b",
    activityId: "act-b",
    environment: ENV,
  });
  await store.markDead("act-a");
  await store.clearDead();
  assert.equal(store.tokens.length, 1);
  assert.equal(store.tokens[0]?.token, "tok-b");
});

test("clearAll empties the store", async () => {
  const store = createTokenStore();
  await store.upsert({
    kind: "pushToStart",
    token: "x",
    environment: ENV,
  });
  await store.clearAll();
  assert.equal(store.tokens.length, 0);
});

test("subscribe fires on mutation; unsubscribe stops it", async () => {
  const store = createTokenStore();
  let received: ReadonlyArray<TokenRecord> | undefined;
  const unsub = store.subscribe((tokens) => {
    received = tokens;
  });
  await store.upsert({
    kind: "pushToStart",
    token: "x",
    environment: ENV,
  });
  assert.equal(received?.length, 1);
  unsub();
  await store.upsert({
    kind: "pushToStart",
    token: "y",
    environment: ENV,
  });
  // received reference should still hold the snapshot from the first
  // emission (we unsubscribed before the second upsert).
  assert.equal(received?.length, 1);
});

test("tokens snapshot is sorted by recordedAt descending", async () => {
  let now = new Date("2026-01-01T00:00:00.000Z").getTime();
  const store = createTokenStore({
    clock: () => new Date((now += 1000)),
  });
  await store.upsert({
    kind: "pushToStart",
    token: "first",
    environment: ENV,
  });
  await store.upsert({
    kind: "apnsDevice",
    token: "second",
    environment: ENV,
  });
  assert.equal(store.tokens[0]?.token, "second");
  assert.equal(store.tokens[1]?.token, "first");
});

test("computeIdempotencyKey is deterministic for the same triple", async () => {
  const a = await computeIdempotencyKey("perActivity", "act-1", "tok-1");
  const b = await computeIdempotencyKey("perActivity", "act-1", "tok-1");
  assert.equal(a, b);
  const c = await computeIdempotencyKey("perActivity", "act-1", "tok-2");
  assert.notEqual(a, c);
});

test("memory storage round-trips the snapshot for the next store", async () => {
  const storage = createMemoryStorage();
  const first = createTokenStore({ storage });
  await first.upsert({
    kind: "pushToStart",
    token: "persist-me",
    environment: ENV,
  });
  // Wait for the debounce + persistence cycle to drain.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const second = createTokenStore({ storage });
  // load is async; give the in-band drain a tick.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const tokens = second.tokens;
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]?.token, "persist-me");
});

test("upsert during the hydration window still reaches storage", async () => {
  // Storage with a load() that blocks until we resolve it manually,
  // and a save() that records every call. Without the hydration flush
  // the upsert below lands in the in-memory Map but its scheduleSave
  // is silently dropped, and storage.save is never invoked until the
  // next mutation.
  let releaseLoad: () => void = () => {};
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  const savedSnapshots: ReadonlyArray<TokenRecord>[] = [];
  const storage = {
    async load() {
      await loadGate;
      return [];
    },
    async save(tokens: ReadonlyArray<TokenRecord>) {
      savedSnapshots.push(tokens);
    },
  };

  const store = createTokenStore({ storage });
  // Upsert before load() resolves. This is the race window.
  await store.upsert({
    kind: "pushToStart",
    token: "queued-during-hydration",
    environment: ENV,
  });
  // Storage hasn't been hit yet; hydration is still pending.
  assert.equal(savedSnapshots.length, 0);

  releaseLoad();
  // Let the .then() and the queued scheduleSave debounce drain.
  await new Promise((resolve) => setTimeout(resolve, 400));

  assert.equal(savedSnapshots.length, 1);
  assert.equal(savedSnapshots[0]?.length, 1);
  assert.equal(savedSnapshots[0]?.[0]?.token, "queued-during-hydration");
});

test("upsert during hydration wins over a loaded record with the same key", async () => {
  // Same triple (kind/activityId/token) produces the same idempotency
  // key. If the live emission and a stale persisted record collide on
  // load, the live one must win; overwriting it with disk state
  // would defeat MS020 (latest-write-wins on rotation).
  let releaseLoad: () => void = () => {};
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  const sameKey = await computeIdempotencyKey(
    "pushToStart",
    undefined,
    "shared-token",
  );
  const stale: TokenRecord = {
    kind: "pushToStart",
    token: "shared-token",
    environment: ENV,
    recordedAt: "2020-01-01T00:00:00.000Z",
    lifecycle: "active",
    idempotencyKey: sameKey,
  };
  const storage = {
    async load() {
      await loadGate;
      return [stale];
    },
    async save() {},
  };

  const store = createTokenStore({ storage });
  const live = await store.upsert({
    kind: "pushToStart",
    token: "shared-token",
    environment: ENV,
  });
  releaseLoad();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(store.tokens.length, 1);
  assert.equal(store.tokens[0]?.recordedAt, live.recordedAt);
  assert.notEqual(store.tokens[0]?.recordedAt, stale.recordedAt);
});

test("upsert during hydration still saves when load() rejects", async () => {
  // If storage.load() fails the in-memory write must still reach
  // storage so the next process boot can recover it. The alternative
  // is silent data loss when the cause of the load failure was a
  // transient read error.
  let rejectLoad: (err: Error) => void = () => {};
  const loadGate = new Promise<ReadonlyArray<TokenRecord>>((_, reject) => {
    rejectLoad = reject;
  });
  const savedSnapshots: ReadonlyArray<TokenRecord>[] = [];
  const storage = {
    async load() {
      return loadGate;
    },
    async save(tokens: ReadonlyArray<TokenRecord>) {
      savedSnapshots.push(tokens);
    },
  };
  // Suppress the expected console.warn from the catch path.
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const store = createTokenStore({ storage });
    await store.upsert({
      kind: "pushToStart",
      token: "queued-during-failed-hydration",
      environment: ENV,
    });
    rejectLoad(new Error("simulated storage failure"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(savedSnapshots.length, 1);
    assert.equal(savedSnapshots[0]?.[0]?.token, "queued-during-failed-hydration");
  } finally {
    console.warn = originalWarn;
  }
});
