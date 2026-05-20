---
"@mobile-surfaces/traps": major
---

Demote five doc-only rules from error or warning severity to info advisory: MS016, MS020, MS021, MS023, MS034. The rules remain in the catalog with their prose intact, but their severity now matches what the repo actually enforces. None of these rules has a static gate, an SDK pre-flight, or a runtime throw, so the prior error/warning severity over-promised enforcement. The MS-ids stay reserved per the monotonic-forever policy in CONTRIBUTING.md.

Retire MS027 as a deprecated alias of MS012. Both rules fired the same iOS 17.2 deployment-target check on the same file; the catalog now counts the constraint once. MS027's id remains reserved and the catalog summary points at MS012.

Public-surface impact for @mobile-surfaces/traps consumers: filtering by severity returns four fewer error rules and two fewer warning rules; reading MS027 receives a deprecated entry pointing at MS012. Headline catalog counts become 39 live rules (31 error, 2 warning, 6 info) with 4 retired ids reserved.
