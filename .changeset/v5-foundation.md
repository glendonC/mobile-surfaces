---
"@mobile-surfaces/surface-contracts": major
"@mobile-surfaces/push": major
"create-mobile-surfaces": major
"@mobile-surfaces/live-activity": major
"@mobile-surfaces/validators": major
---

v5.0.0: schema base-shape split, per-kind rendering slices, App Group codegen,
LLM-ready descriptions, App Group SSOT. Breaking: schemaVersion "4", rendering
fields move into per-kind slices, notification renames primaryText/secondaryText
to title/body, toApnsAlertPayload renamed from liveActivityAlertPayloadFromSnapshot,
schemaVersion required (no default), v2 codec dropped (use @4.x to migrate),
IncompleteProjectionError and shadow TS interfaces removed.
