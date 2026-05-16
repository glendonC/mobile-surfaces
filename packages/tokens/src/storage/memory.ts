// In-memory storage adapter. The default when createTokenStore is
// called without a storage option. The closure holds a single
// ReadonlyArray<TokenRecord> snapshot; load resolves to whatever the
// most recent save wrote (empty array on first load). Cleared on
// process restart; no persistence across reloads.

import type { TokenRecord, TokenStorage } from "../index.ts";

export function createMemoryStorage(): TokenStorage {
  let snapshot: ReadonlyArray<TokenRecord> = [];
  return {
    async load(): Promise<ReadonlyArray<TokenRecord>> {
      return snapshot;
    },
    async save(tokens: ReadonlyArray<TokenRecord>): Promise<void> {
      snapshot = tokens;
    },
  };
}
