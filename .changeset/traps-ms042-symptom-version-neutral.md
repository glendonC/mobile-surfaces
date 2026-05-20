---
"@mobile-surfaces/traps": patch
---

Reword the MS042 `symptom` prose. It used `schema-v4.ts` and `safeParseAnyVersion` as a concrete example; both were removed when the v4 codec was dropped at 9.0, so the example named a file that no longer exists. The symptom now describes the failure mode in version-neutral terms. No change to the rule, its severity, or its enforcement.
