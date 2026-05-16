// Canonical $id / $schema URL for the published surface-contracts JSON Schema.
// Single source of truth so build-schema.mjs (writer) and
// validate-surface-fixtures.mjs (reader) cannot diverge.
//
// Channel rule: major.minor. A breaking bump moves consumers; a minor bump
// (additive variants) gets a fresh URL so older pinned references keep
// resolving to the schema they were authored against. Forks (any package name
// other than the upstream) get no URL because the tarball is not published.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const UPSTREAM_PACKAGE_NAME = "@mobile-surfaces/surface-contracts";

// Single source of truth for the wire-format generation literal that
// appears in `schemaVersion: "<n>"` across fixtures, docs, README snippets,
// and the CLI template tarball. Bumped together with the package major when
// the schema's discriminator literal changes.
export const CANONICAL_SCHEMA_VERSION = "5";

export function readSurfaceContractsPackageJson() {
  return JSON.parse(
    readFileSync(resolve("packages/surface-contracts/package.json"), "utf8"),
  );
}

export function canonicalSchemaUrl(pkg = readSurfaceContractsPackageJson()) {
  if (pkg.name !== UPSTREAM_PACKAGE_NAME) return null;
  const [major, minor] = pkg.version.split(".");
  return `https://unpkg.com/${UPSTREAM_PACKAGE_NAME}@${major}.${minor}/schema.json`;
}
