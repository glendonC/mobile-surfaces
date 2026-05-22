// Inline color palette for the mobile demo. Previously lived in
// @mobile-surfaces/design-tokens but that package was just a re-export of a
// JSON file with one local consumer (this app), so it was retired in 3.2.0.
// This file is the single source of truth for the brand palette: the widget
// target's two asset-catalog colors are generated from `primary` and
// `surface` here by scripts/generate-widget-colors.mjs (pnpm surface:codegen)
// into apps/mobile/targets/widget/colors.generated.cjs, drift-gated in CI.

export const surfaceColors = {
  surface: "#F7F5F0",
  surfaceElevated: "#FFFFFF",
  primary: "#7BA591",
  accent: "#C97B63",
  inkPrimary: "#1F1B16",
  inkSecondary: "#6B6359",
  success: "#6E9F7E",
  warning: "#D4A24C",
  dangerSurface: "#FDE2DD",
  dangerText: "#7A2922",
  disabled: "#CFCEC9",
  onPrimary: "#FFFFFF",
} as const;

export type SurfaceColorToken = keyof typeof surfaceColors;
