---
"@mobile-surfaces/push": patch
---

README accuracy fix. The "Install" section claimed "Surface contracts and push release together in the v5 linked group; pin to matching majors", but push has not been in the linked group since the v8 release: per `apps/site/src/content/docs/stability.md`, the linked group is `surface-contracts + validators + traps`, and push versions independently. The new prose says so and points at the explicit `peerDependencies` range.
