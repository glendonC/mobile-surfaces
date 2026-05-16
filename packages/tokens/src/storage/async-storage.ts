// AsyncStorage adapter. Requires the consumer to add
// `@react-native-async-storage/async-storage` to their own
// dependencies; we declare it as an optional peer dep so installing
// @mobile-surfaces/tokens in a Node environment does not pull
// AsyncStorage into a project that will never load it.
//
// Persisted shape is the array form of the forwarder-request wire
// schema (see ../wire.ts). On load each element is run through the
// schema individually; failures are dropped with a console warning
// rather than voiding the whole table. The single storage key is
// "mobile-surfaces.tokens.v1" — bumping the trailing version is the
// migration hook should the wire shape ever evolve.

import type { TokenRecord, TokenStorage } from "../index.ts";
import { tokenForwarderRequestSchema } from "../wire.ts";

const STORAGE_KEY = "mobile-surfaces.tokens.v1";

interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

let cachedModule: AsyncStorageLike | undefined;

async function loadAsyncStorage(): Promise<AsyncStorageLike> {
  if (cachedModule) return cachedModule;
  // Dynamic import keeps Node consumers from a hard import failure;
  // consumers that wire this adapter add the peer dep themselves.
  const mod = (await import(
    "@react-native-async-storage/async-storage"
  )) as { default: AsyncStorageLike } | AsyncStorageLike;
  const resolved =
    "default" in (mod as { default?: unknown }) && (mod as { default?: unknown }).default
      ? (mod as { default: AsyncStorageLike }).default
      : (mod as AsyncStorageLike);
  cachedModule = resolved;
  return resolved;
}

function toRecords(raw: string | null): ReadonlyArray<TokenRecord> {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[@mobile-surfaces/tokens] async-storage: JSON parse failed:",
        err,
      );
    }
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: TokenRecord[] = [];
  for (const candidate of parsed) {
    const result = tokenForwarderRequestSchema.safeParse(candidate);
    if (!result.success) continue;
    out.push({
      kind: result.data.kind,
      token: result.data.token,
      activityId: result.data.activityId,
      environment: result.data.environment,
      recordedAt: result.data.recordedAt,
      lifecycle: result.data.lifecycle,
      idempotencyKey: result.data.idempotencyKey,
    });
  }
  return out;
}

function toJson(tokens: ReadonlyArray<TokenRecord>): string {
  // Stamp schemaVersion on every record so the persisted shape matches
  // the forwarder wire contract. Cheap; readable; cheap to migrate.
  const records = tokens.map((t) => ({
    kind: t.kind,
    token: t.token,
    ...(t.activityId !== undefined ? { activityId: t.activityId } : {}),
    environment: t.environment,
    recordedAt: t.recordedAt,
    lifecycle: t.lifecycle,
    idempotencyKey: t.idempotencyKey,
    schemaVersion: "1",
  }));
  return JSON.stringify(records);
}

export function createAsyncStorageStorage(): TokenStorage {
  return {
    async load(): Promise<ReadonlyArray<TokenRecord>> {
      const mod = await loadAsyncStorage();
      const raw = await mod.getItem(STORAGE_KEY);
      return toRecords(raw);
    },
    async save(tokens: ReadonlyArray<TokenRecord>): Promise<void> {
      const mod = await loadAsyncStorage();
      if (tokens.length === 0) {
        await mod.removeItem(STORAGE_KEY);
        return;
      }
      await mod.setItem(STORAGE_KEY, toJson(tokens));
    },
  };
}
