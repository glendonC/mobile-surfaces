---
"@mobile-surfaces/surface-contracts": minor
"@mobile-surfaces/design-tokens": minor
"@mobile-surfaces/live-activity": minor
"@mobile-surfaces/push": minor
"create-mobile-surfaces": minor
---

Add `@mobile-surfaces/push`, the canonical Node SDK for sending Mobile Surfaces snapshots to APNs.

- New package `@mobile-surfaces/push@0.1.0` ships `createPushClient` with `alert` / `update` / `start` / `end` / `broadcast` / `createChannel` / `listChannels` / `deleteChannel`. Drives the existing `LiveSurfaceSnapshot` projection helpers from `@mobile-surfaces/surface-contracts` at the wire layer.
- Long-lived HTTP/2 session per `PushClient`, JWT cached with a 50-minute refresh window (10-minute safety buffer below Apple's 60-minute cap), retry policy with exponential backoff + jitter that honors `Retry-After` for 429s.
- Full APNs error taxonomy (`BadDeviceTokenError`, `TooManyRequestsError`, `ChannelNotRegisteredError`, … 17 subclasses + `UnknownApnsError` fallback) plus `InvalidSnapshotError` and `ClientClosedError`. All carry `apnsId`, `status`, `reason`, `timestamp`.
- Channel management routed to the documented split host/port: `api-manage-broadcast.sandbox.push.apple.com:2195` (development) and `api-manage-broadcast.push.apple.com:2196` (production).
- Zero npm runtime deps — only the workspace `@mobile-surfaces/surface-contracts`. JWT signing is hand-rolled `node:crypto` ES256 (matching the proven `scripts/send-apns.mjs` implementation) for auditability.
- `pnpm test:push` added to root, wired into CI and publish workflows.

The new package is added to the linked release group so it versions in lockstep with the rest of `@mobile-surfaces/*` and `create-mobile-surfaces`.
