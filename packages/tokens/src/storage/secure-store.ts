// expo-secure-store adapter. Same wire shape as the AsyncStorage
// adapter; the difference is that SecureStore writes to the iOS
// Keychain (encrypted at rest, survives backup-and-restore), which is
// the right home for device tokens that authenticate against APNs.
// expo-secure-store is declared as an optional peer dep so consumers
// that prefer AsyncStorage or a custom backend do not pull it in.

import type { TokenRecord, TokenStorage } from "../index.ts";
import { tokenForwarderRequestSchema } from "../wire.ts";

const STORAGE_KEY = "mobile-surfaces.tokens.v1";

interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

let cachedModule: SecureStoreLike | undefined;

async function loadSecureStore(): Promise<SecureStoreLike> {
  if (cachedModule) return cachedModule;
  const mod = (await import("expo-secure-store")) as SecureStoreLike & {
    default?: SecureStoreLike;
  };
  cachedModule = mod.default ?? mod;
  return cachedModule;
}

function toRecords(raw: string | null): ReadonlyArray<TokenRecord> {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[@mobile-surfaces/tokens] secure-store: JSON parse failed:",
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

export function createSecureStoreStorage(): TokenStorage {
  return {
    async load(): Promise<ReadonlyArray<TokenRecord>> {
      const mod = await loadSecureStore();
      const raw = await mod.getItemAsync(STORAGE_KEY);
      return toRecords(raw);
    },
    async save(tokens: ReadonlyArray<TokenRecord>): Promise<void> {
      const mod = await loadSecureStore();
      if (tokens.length === 0) {
        await mod.deleteItemAsync(STORAGE_KEY);
        return;
      }
      await mod.setItemAsync(STORAGE_KEY, toJson(tokens));
    },
  };
}
