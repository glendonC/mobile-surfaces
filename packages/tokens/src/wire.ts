// Wire schemas for @mobile-surfaces/tokens. The token-forwarder request
// body is Zod-validated on both ends (client emits via the forwarder; a
// backend handler safeParses the incoming body before persisting).
//
// `schemaVersion: "1"` is the tokens-wire version. It is intentionally
// independent of the surface-contracts schemaVersion: the token-store
// payload is a separate wire contract that can evolve at its own pace.
// Phase 4's charter codifies this independence; the literal here is the
// runtime hook a server uses to detect a client running ahead or behind.

import { z } from "zod";

export const tokenKindSchema = z.enum([
  "pushToStart",
  "perActivity",
  "apnsDevice",
]);
export type TokenKindWire = z.infer<typeof tokenKindSchema>;

export const tokenLifecycleSchema = z.enum(["active", "ending", "dead"]);
export type TokenLifecycleWire = z.infer<typeof tokenLifecycleSchema>;

export const tokenForwarderRequestSchema = z
  .object({
    kind: tokenKindSchema,
    token: z.string().min(1),
    activityId: z.string().optional(),
    environment: z.enum(["development", "production"]),
    recordedAt: z.iso.datetime(),
    lifecycle: tokenLifecycleSchema,
    idempotencyKey: z.string().min(1),
    schemaVersion: z.literal("1"),
  })
  .strict();
export type TokenForwarderRequest = z.infer<typeof tokenForwarderRequestSchema>;

/**
 * Array form. Persistence adapters (AsyncStorage, SecureStore) store
 * the full token table as a JSON array of forwarder-shaped records;
 * loading runs each element through `tokenForwarderRequestSchema`
 * individually so a single corrupt entry doesn't void the whole
 * store.
 */
export const tokenForwarderRequestArraySchema = z.array(
  tokenForwarderRequestSchema,
);
