// Single source of truth for the wire-format generation literal.
//
// `SCHEMA_VERSION` is the value carried in `schemaVersion: "<n>"` on every
// snapshot and projection-output envelope. It is bumped together with the
// surface-contracts package major when the schema's discriminator shape
// changes. Every other site that needs the value derives it from here:
//
//   - schema.ts             every `z.literal(SCHEMA_VERSION)` in the contract
//   - index.ts              every projection helper that stamps the envelope
//   - scripts/lib/schema-url.mjs   re-exported as CANONICAL_SCHEMA_VERSION
//   - the Swift constant    MobileSurfacesSchemaVersion.swift is generated
//                           from this value (scripts/generate-schema-version.mjs)
//
// This module deliberately has no imports so it is cheap to pull in from a
// build script without dragging Zod along.
export const SCHEMA_VERSION = "5";
