import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  loader: { ".json": "json" },
  external: [
    "expo",
    "expo-modules-core",
    "react",
    "react-native",
    "@mobile-surfaces/surface-contracts",
  ],
});
