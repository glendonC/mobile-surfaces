---
"@mobile-surfaces/push": patch
---

Add `LiveActivityStartOptions.alert` and write `aps.alert` on push-to-start. On current iOS a push-started Live Activity is only presented when the start payload carries an alert; without it `liveactivitiesd` logs "Received start without an alert configuration" and silently drops the presentation. `update`/`end` never carry it, so subsequent pushes stay silent.
