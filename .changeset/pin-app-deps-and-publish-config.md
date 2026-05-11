---
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
"create-mobile-surfaces": patch
---

Pin eas-cli and typescript to exact versions in apps/mobile devDependencies (were ^16.25.1 and ^5.0.0). Matches the external-pin discipline already in place for @bacons/apple-targets and the workspace packages, so contributors no longer pick up transitive majors at install time.

Add an explicit publishConfig.access "public" to create-mobile-surfaces so the publish workflow does not rely solely on the files allow-list. Matches the publishConfig block already present on the four runtime packages and makes a future maintainer's intent unambiguous.
