// Shared identity validators. Single source of truth for both the
// create-mobile-surfaces CLI and scripts/rename-starter.mjs, so a regex
// tweak in one place can't drift away from the other.
//
// The CLI consumes via the bare specifier `@mobile-surfaces/validators`
// (workspace dep, post-install). scripts/rename-starter.mjs runs in the
// user's scaffolded project *before* pnpm install, so it imports this
// file via a relative path instead — both paths land on the same source.
//
// Each validator returns `undefined` on success and a human-readable error
// string on failure. Consumers wrap the string with their own emission
// policy (CLI prompts re-ask; rename-starter prints + exits).

// The project slug becomes the scaffolded project's directory name and its
// package.json `name`. npm caps package names at 214 characters; that is the
// binding constraint (tighter than any filesystem path limit), so it is the
// cap enforced here.
const PROJECT_SLUG_MAX = 214;

// Bundle identifiers are CFBundleIdentifier values. Apple documents a 155
// character maximum; longer ids are rejected at upload.
const BUNDLE_ID_MAX = 155;

// Reverse-DNS prefixes that belong to a platform vendor. Apple rejects an
// upload whose bundle id sits under com.apple.*; the others are not yours to
// publish under and signal a copied-template id the developer forgot to
// rename. com.example.* is handled separately below because its guidance is
// about placeholders, not vendor ownership.
const RESERVED_BUNDLE_PREFIXES = [
  "com.apple.",
  "com.google.",
  "com.amazon.",
  "com.microsoft.",
  "com.facebook.",
  "com.meta.",
  "org.reactjs.",
];

// Note on Unicode: every validator below restricts input to an ASCII subset
// via its regex (`[a-z0-9-]`, `[A-Za-z0-9-]`, `[A-Z0-9]`). JavaScript regex
// character classes are ASCII-only by default, so fullwidth digits, Cyrillic
// homoglyphs, and other confusable characters are already rejected. NFKC
// normalization would add no behavior the regexes do not already enforce, so
// it is deliberately not applied.

export function validateProjectSlug(s) {
  if (!s || s.length === 0) return "Project name is required.";
  if (s.length > PROJECT_SLUG_MAX) {
    return `Project name must be ${PROJECT_SLUG_MAX} characters or fewer (npm package-name limit).`;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) {
    return "Lowercase letters, digits, and dashes only. Must start with a letter or digit.";
  }
  return undefined;
}

export function validateScheme(s) {
  if (!s || s.length === 0) return "URL scheme is required.";
  if (!/^[a-z][a-z0-9]*$/.test(s)) {
    return "Lowercase letters and digits only. Must start with a letter.";
  }
  return undefined;
}

export function validateBundleId(s) {
  if (!s || s.length === 0) return "Bundle identifier is required.";
  if (s.length > BUNDLE_ID_MAX) {
    return `Bundle identifier must be ${BUNDLE_ID_MAX} characters or fewer (Apple's CFBundleIdentifier limit).`;
  }
  if (!/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+){1,}$/.test(s)) {
    return "Should be reverse-DNS (e.g. com.company.appname) with at least two segments.";
  }
  if (/^com\.example\./i.test(s)) {
    return "com.example.* is a placeholder Apple rejects on upload. Use your real reverse-DNS prefix (e.g. com.acme.myapp).";
  }
  const lowered = s.toLowerCase();
  const reserved = RESERVED_BUNDLE_PREFIXES.find((p) => lowered.startsWith(p));
  if (reserved) {
    return `${reserved}* is a reserved vendor prefix. Use your own reverse-DNS prefix (e.g. com.acme.myapp); a copied-template id under ${reserved}* will not be yours to publish.`;
  }
  return undefined;
}

// Optional at scaffold-time: users can create the project before they have
// an Apple Developer account and fill the Team ID in later via
// `pnpm surface:setup-apns`. APNs send-time presence is enforced separately
// (MS028: createPushClient throws if APNS_TEAM_ID is unset; scripts/setup-apns.mjs
// has its own stricter validator that rejects empty).
export function validateTeamId(s) {
  if (!s || s.length === 0) return undefined;
  if (!/^[A-Z0-9]{10}$/.test(s)) {
    return "Apple Team IDs are exactly 10 uppercase letters and digits.";
  }
  return undefined;
}

export function validateSwiftIdentifier(s) {
  if (!s || s.length === 0) return "Swift identifier is required.";
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(s)) {
    return "Must be an UpperCamelCase Swift identifier (letters, digits, underscore; start with an uppercase letter).";
  }
  return undefined;
}

export function toScheme(projectName) {
  return projectName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function toBundleId(projectName) {
  return `com.example.${projectName.toLowerCase().replace(/[^a-z0-9-]/g, "")}`;
}

export function toSwiftPrefix(projectName) {
  const camelCase = projectName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  // Swift identifiers cannot start with a digit. Strip leading digits so
  // "1password" -> "Password", "123-app" -> "App", "5-and-dime" -> "AndDime".
  // validateProjectSlug intentionally allows a leading digit (npm package
  // names like "1password" are legal); the Swift-side constraint is enforced
  // here so the slug can stay permissive.
  const stripped = camelCase.replace(/^[0-9]+/, "");
  if (stripped.length === 0) {
    throw new Error(
      `Cannot derive a Swift identifier from "${projectName}": the project name must contain at least one letter so the iOS bundle has a valid Swift type prefix.`,
    );
  }
  // After stripping the leading digits, the new first character was the
  // remainder of an interior segment (could be lowercase). Uppercase it so
  // the result is UpperCamelCase, matching validateSwiftIdentifier's contract.
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}
