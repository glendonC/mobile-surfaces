const { swiftAssetColorMap } = require("../../../../packages/design-tokens/tokens.json");

/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "widget",
  name: "MobileSurfacesWidget",
  icon: "../../assets/icon.png",
  deploymentTarget: "17.2",
  frameworks: ["ActivityKit", "WidgetKit", "SwiftUI"],
  colors: {
    $accent: swiftAssetColorMap.AccentColor,
    $widgetBackground: swiftAssetColorMap.WidgetBackground,
  },
};
