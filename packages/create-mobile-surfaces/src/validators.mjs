// Identity validators. Mirrored from scripts/rename-starter.mjs in the
// template — keep in sync. The CLI ships independently of the rename script,
// so both copies are necessary; CI should compare them on every release.

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
    return "Should look like com.acme.myapp — at least two reverse-DNS segments.";
  }
  if (/^com\.example\./i.test(s)) {
    return "com.example.* is a placeholder Apple rejects on upload. Use your real reverse-DNS prefix (e.g. com.acme.myapp).";
  }
  return undefined;
}

export function validateTeamId(s) {
  if (!s || s.length === 0) return undefined; // skipping is allowed
  if (!/^[A-Z0-9]{10}$/.test(s)) {
    return "Apple Team IDs are exactly 10 uppercase letters and digits.";
  }
  return undefined;
}

// Default-derivation helpers. The CLI uses these to suggest sensible values
// from the project name so most users press Enter through the flow.

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
