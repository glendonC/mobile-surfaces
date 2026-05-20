---
"@mobile-surfaces/push": minor
---

`createPushClient` now rejects a `bundleId` that carries a trailing `.push-type.liveactivity` suffix, throwing a new `MalformedApnsConfigError` at construction.

The SDK appends `.push-type.liveactivity` to the `apns-topic` itself when it builds a Live Activity push. A `bundleId` that already carries the suffix produced a doubled topic and a 400 `TopicDisallowed` on every send. The guard turns that per-send runtime failure into one fast rejection at `createPushClient` time. This is the construction-time complement to MS018, which previously surfaced only as an APNs response error.

New public export: `MalformedApnsConfigError` (subclass of `MobileSurfacesError`, field `field: string`, bound to catalog rule MS018). It is the carrier for present-but-malformed config, distinct from `MissingApnsConfigError` which covers absent config.

The match is a case-insensitive suffix test, so a bundle id that merely contains the substring mid-string (`com.example.push-type.liveactivity.app`) is unaffected.
