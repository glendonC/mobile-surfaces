---
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
"create-mobile-surfaces": patch
---

@mobile-surfaces/surface-contracts: bump JSON Schema $id from @1.2 to @2.0 so backends pinning the documented unpkg URL resolve to the actual released contract. scripts/build-schema.mjs now derives major.minor from packages/surface-contracts/package.json so the URL tracks the release train automatically; doc references in docs/architecture.md, docs/backend-integration.md, docs/roadmap.md, docs/schema-migration.md, and packages/surface-contracts/README.md are swept to match. Historical CHANGELOG entries are left at @1.2 for accuracy. Cross-references trap MS006.
