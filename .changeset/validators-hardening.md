---
"@mobile-surfaces/validators": minor
---

`validateBundleId` and `validateProjectSlug` gain two classes of check:

- **Reserved vendor prefixes.** `validateBundleId` now rejects bundle identifiers under `com.apple.`, `com.google.`, `com.amazon.`, `com.microsoft.`, `com.facebook.`, `com.meta.`, and `org.reactjs.`. Apple rejects an upload whose id sits under `com.apple.*`; the others signal a copied-template id (the React Native default template ships `org.reactjs.native.example.*`) that the developer forgot to rename. The match is a case-insensitive prefix check, so `com.apples.foo` and `com.mycompany.google` are unaffected. The existing `com.example.*` placeholder rejection is unchanged.
- **Length caps.** `validateBundleId` rejects identifiers longer than 155 characters (Apple's CFBundleIdentifier limit). `validateProjectSlug` rejects slugs longer than 214 characters (npm's package-name limit, the binding constraint since the slug becomes the scaffolded project's `package.json` name).

NFKC normalization was considered and deliberately not added: every validator's regex is already ASCII-strict, so fullwidth digits, Cyrillic homoglyphs, and other confusable characters are already rejected. Normalization would add no behavior the regexes do not already enforce.
