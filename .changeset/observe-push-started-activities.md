---
"@mobile-surfaces/live-activity": patch
---

Observe push-started activities via `Activity.activityUpdates` in `OnStartObserving`, so a Live Activity created by push-to-start is picked up and forwards its per-activity push token (enabling remote update/end). Previously only locally-started and pre-existing activities were observed (landed on main in #144 without a changeset; this releases it).
