---
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
"create-mobile-surfaces": patch
---

Pin all dependencies to exact versions across packages and root devDependencies. Replaces caret/tilde ranges on zod, @inquirer/ansi, @inquirer/core, @inquirer/prompts, ora, picocolors, @types/node, and tsup so consumers no longer pick up transitive majors at install time.

CLI improvements: the existing-expo and existing-monorepo plan recaps now echo the user's surface selections (live activity, home widget, control widget) before "Apply these changes?" so toggled-off surfaces are visible at confirmation. The existing-expo "What we found" recap leads with Config and Bundle id, demoting Expo version, ios/ folder, and plugins below the actionable fields. The bundle identifier validator now hints at reverse-DNS format ("Should be reverse-DNS (e.g. com.company.appname) with at least two segments"), and the Apple Team ID prompt points to developer.apple.com/account.
