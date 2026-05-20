---
"@mobile-surfaces/traps": patch
---

Correct the MS041 prose. The rule's `summary` and `fix` described schemaVersion as needing to be the *first* property of every projection-output schema and called that ordering "load-bearing." The enforcement check stopped requiring property order in v9 (Swift Codable decodes by key name, so source order never reached the wire); the literal-type check is the load-bearing part. The catalog text now matches the shipped gate.
