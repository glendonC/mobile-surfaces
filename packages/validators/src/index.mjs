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

export function validateProjectSlug(s) {
  if (!s || s.length === 0) return "Project name is required.";
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
  if (!/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+){1,}$/.test(s)) {
    return "Should be reverse-DNS (e.g. com.company.appname) with at least two segments.";
  }
  if (/^com\.example\./i.test(s)) {
    return "com.example.* is a placeholder Apple rejects on upload. Use your real reverse-DNS prefix (e.g. com.acme.myapp).";
  }
  return undefined;
}

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
  return projectName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}
