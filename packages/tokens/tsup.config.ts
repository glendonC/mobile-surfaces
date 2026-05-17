import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/react.ts",
    "src/forwarder.ts",
    "src/wire.ts",
    "src/storage/memory.ts",
    "src/storage/async-storage.ts",
    "src/storage/secure-store.ts",
  ],
  format: ["esm"],
  target: "node20",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  tsconfig: "./tsconfig.build.json",
  external: [
    "react",
    "@react-native-async-storage/async-storage",
    "expo-secure-store",
    "@mobile-surfaces/surface-contracts",
    "@mobile-surfaces/live-activity",
    "@mobile-surfaces/traps",
  ],
});
