// Widget asset-catalog colors. Inlined here (rather than imported from a
// shared design-tokens package) because @bacons/apple-targets reads this
// file at prebuild time and CJS interop with workspace TS sources is
// fragile. Keep these two values in sync with apps/mobile/src/theme.ts
// if the brand palette changes.
const COLORS = {
  AccentColor: "#7BA591",
  WidgetBackground: "#F7F5F0",
};

/** @type {import('@bacons/apple-targets').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "MobileSurfacesWidget",
  icon: "../../assets/icon.png",
  deploymentTarget: "17.2",
  frameworks: ["ActivityKit", "AppIntents", "WidgetKit", "SwiftUI"],
  entitlements: {
    "com.apple.security.application-groups":
      config.ios?.entitlements?.["com.apple.security.application-groups"] ?? [],
  },
  colors: {
    $accent: COLORS.AccentColor,
    $widgetBackground: COLORS.WidgetBackground,
  },
});
