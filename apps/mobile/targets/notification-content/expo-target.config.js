// Notification-content extension target. Materialized by @bacons/apple-targets
// at prebuild time into the generated apps/mobile/ios/ Xcode project. Sibling
// of the widget/ target; do not consolidate them - WidgetKit (widget) and
// UserNotificationsUI (this target) are distinct Apple extension types with
// distinct NSExtensionPointIdentifiers.
//
// App Group entitlement is bound from the host config so MS013 stays in
// lockstep across host, widget, and this target. The plugin does not default
// App Group entitlements for type: "notification-content"; declare explicitly.

/** @type {import('@bacons/apple-targets').ConfigFunction} */
module.exports = (config) => ({
  type: "notification-content",
  name: "MobileSurfacesNotificationContent",
  deploymentTarget: "17.2",
  frameworks: ["UserNotifications", "UserNotificationsUI", "SwiftUI"],
  entitlements: {
    "com.apple.security.application-groups":
      config.ios?.entitlements?.["com.apple.security.application-groups"] ?? [],
  },
});
