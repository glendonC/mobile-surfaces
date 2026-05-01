import { defineConfig } from "tsup";

// We emit additional internal entries (jwt, errors) so tests can import them
// directly. The package.json `exports` map only declares `.`, so these
// remain private to the package — consumers reach them only through the
// public index.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    jwt: "src/jwt.ts",
    errors: "src/errors.ts",
  },
  format: ["esm"],
  target: "node20",
  dts: { entry: ["src/index.ts"] },
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["@mobile-surfaces/surface-contracts"],
});
