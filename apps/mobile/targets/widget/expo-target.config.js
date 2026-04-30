const { swiftAssetColorMap } = require("../../../../packages/design-tokens/tokens.json");

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
    $accent: swiftAssetColorMap.AccentColor,
    $widgetBackground: swiftAssetColorMap.WidgetBackground,
  },
});
