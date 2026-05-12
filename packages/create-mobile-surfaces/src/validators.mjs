// Re-export from the shared @mobile-surfaces/validators package. Single
// source of truth lives at packages/validators/src/index.mjs; this file
// only exists so CLI internals can continue importing from a local path.
export {
  validateProjectSlug,
  validateScheme,
  validateBundleId,
  validateTeamId,
  validateSwiftIdentifier,
  toScheme,
  toBundleId,
  toSwiftPrefix,
} from "@mobile-surfaces/validators";
