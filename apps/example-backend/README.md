# Mobile Surfaces example backend

A single-file Node server that demonstrates the production shape of a Mobile Surfaces backend: receive a token from the mobile app via `@mobile-surfaces/tokens/forwarder`, hold domain state, accept a domain event over HTTP, project it to a `LiveSurfaceSnapshot` via `@mobile-surfaces/example-domain`, and drive APNs via `@mobile-surfaces/push`.

Paired with [`apps/mobile/src/screens/DeliveryExampleScreen.tsx`](../mobile/src/screens/DeliveryExampleScreen.tsx); together they close the loop end-to-end.

## What this is, what it isn't

**Is:** a reference for the wire-boundary parse pattern. Every shape that crosses a process boundary — the token forwarder payload, the snapshot before send — goes through a Zod safe-parse before it is persisted or dispatched. That discipline is the entire point of the `@mobile-surfaces/*` contract surface; skip a parse, ship a bug.

**Isn't:** a deployable. There is no Dockerfile, no Fly config, no auth, no persistence layer. The token store and the order store are both in-memory `Map`s that drop on restart on purpose. Production substitutes its own storage (Postgres, DynamoDB, your existing user-data store) and brings its own auth surface. The projection family is the part that ports to production unchanged.

The docs site formalizes this in [`docs/push.md`](https://mobile-surfaces.com/docs/push) under "Anti-goals."

## Run

```bash
# No APNs creds: token + domain event flow works; dispatch returns
# { skipped: "no APNs credentials configured" }.
pnpm --filter mobile-surfaces-example-backend start

# With APNs creds: full domain -> projection -> APNs path. The same env
# vars work for scripts/send-apns.mjs.
APNS_KEY_PATH=./keys/AuthKey_ABCDEF1234.p8 \
APNS_KEY_ID=ABCDEF1234 \
APNS_TEAM_ID=TEAM123456 \
APNS_BUNDLE_ID=com.example.mobilesurfaces \
APNS_ENV=development \
PORT=3000 \
pnpm --filter mobile-surfaces-example-backend start
```

Point the mobile screen's token forwarder at `http://localhost:3000/tokens` (the `createTokenForwarder` URL prop on `useTokenStore`) and drive the order forward with the curl commands below.

## Endpoints

### `POST /tokens`

The mobile token forwarder posts here on every `onPushToken` / `onPushToStartToken` / `onActivityStateChange` emission. The body matches `tokenForwarderRequestSchema` from `@mobile-surfaces/tokens/wire`:

```json
{
  "kind": "perActivity",
  "token": "abc123…",
  "activityId": "ord-123",
  "environment": "development",
  "recordedAt": "2026-05-16T20:00:00.000Z",
  "lifecycle": "active",
  "idempotencyKey": "perActivity:ord-123:abc123…",
  "schemaVersion": "1"
}
```

Idempotent on `idempotencyKey`: a re-send with a `recordedAt` no later than the stored copy is a no-op. A later `recordedAt` overwrites (MS020: latest-write-wins on rotation).

### `POST /delivery/:orderId/advance`

Drive the domain forward. Body is `{ stage: "placed" | "preparing" | "out_for_delivery" | "delivered" }`. The server transitions order state via `mockTickOrder`, projects to a `LiveSurfaceSnapshot` via `deliveryToSnapshot`, and dispatches the matching push.

```bash
curl -X POST http://localhost:3000/delivery/ord-123/advance \
  -H 'content-type: application/json' \
  -d '{"stage":"out_for_delivery"}'
```

The dispatch result reports which surface the server pushed against:

- `{ dispatched: "liveActivity", contentState }` — a per-activity token was on file; the server sent a Live Activity update.
- `{ dispatched: "notification", payload }` — `stage === "delivered"` and a device token was on file but no Live Activity token; the server sent a regular notification with the delivered milestone.
- `{ skipped: "no usable token for this stage" }` — no token of the matching kind was on file. The mobile app needs to start a Live Activity (which mints the per-activity token and forwards it).

### `GET /tokens`, `GET /orders/:id`

Read-only inspectors for debugging. Production drops these.

## Wire-boundary discipline

The pattern in [`src/server.mjs`](./src/server.mjs) is the entire point:

1. **Inbound shape, before persistence.** Every `POST /tokens` body goes through `tokenForwarderRequestSchema.safeParse` before `tokens.set(...)`. A malformed payload returns 400 with the Zod issues; the store never sees an off-shape record.
2. **Outbound shape, before send.** Every snapshot the server dispatches goes through `assertSnapshot` (which `deliveryToSnapshot` already runs internally, but the explicit call documents the contract). The SDK's `pushClient.update` / `pushClient.sendNotification` then takes a typed `LiveSurfaceSnapshot`, projects it to the APNs payload, and writes the wire bytes.

Both parses are load-bearing. The Mobile Surfaces trap catalog (`MS008`, `MS011`, `MS032`, etc.) exists to catch the failure modes that result from skipping one or the other.

## See also

- [`@mobile-surfaces/example-domain`](../../packages/example-domain) — the `DeliveryOrder` type and `deliveryToSnapshot` projection family this server consumes.
- [`@mobile-surfaces/push`](../../packages/push) — the APNs SDK. The default `maxConcurrentStreams: 900` and `JwtCacheLike` strategy interface are documented under "Operational notes" in its README.
- [`scripts/send-apns.mjs`](../../scripts/send-apns.mjs) — the self-contained CLI for poking APNs without the full server. Useful for verifying credentials before bringing this backend up.
