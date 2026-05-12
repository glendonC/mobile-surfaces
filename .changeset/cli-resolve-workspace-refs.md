---
"create-mobile-surfaces": patch
---

Resolve `@mobile-surfaces/*` workspace refs to concrete published versions during template-manifest computation. Previously the existing-Expo apply phase emitted `workspace:*` specs for foreign installs, which the install step then marked as "skipped" with a "ships in next release" follow-up — wrong, since the linked release group keeps all five packages versioned in lockstep. `resolvePublishedMobileSurfacesVersion` now reads the version from `packages/<short-name>/package.json` and pins the install to that exact version. Non-`@mobile-surfaces` local refs (`file:`, foreign `workspace:*`) still get the skip marker. The skipped-package follow-up copy is also reworded so a user who sees it now understands the actual cause ("local-only refs") instead of an outdated "not on npm yet" message.
