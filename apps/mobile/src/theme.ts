// Inline color palette for the mobile demo. Previously lived in
// @mobile-surfaces/design-tokens but that package was just a re-export of a
// JSON file with one local consumer (this app), so it was retired in 3.2.0.
// The widget target reads two hex values directly from
// apps/mobile/targets/widget/expo-target.config.js — keep this file and that
// one in sync if the brand palette changes.

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
