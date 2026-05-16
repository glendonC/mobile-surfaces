// GENERATED - DO NOT EDIT. Source: packages/surface-contracts/src/notificationCategories.ts.
// Regenerate: pnpm surface:codegen

import Foundation

/// Mirror of NOTIFICATION_CATEGORIES from the canonical TS source.
/// The notification-content extension's Info.plist declares the same
/// identifier strings under NSExtensionAttributes.UNNotificationExtensionCategory;
/// Swift code that switches on a category id reads from this enum
/// rather than hard-coding a literal so a rename via the canonical
/// source propagates without drift.
enum MobileSurfacesNotificationCategories {
  static let surfaceUpdate = "surface-update"

  /// Flat ordered list. Mirrors the JSON array shape that the
  /// extension Info.plist UNNotificationExtensionCategory key holds.
  static let all: [String] = [
    surfaceUpdate,
  ]
}
