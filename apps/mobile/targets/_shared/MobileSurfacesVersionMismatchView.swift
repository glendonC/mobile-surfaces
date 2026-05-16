import SwiftUI
import WidgetKit

/// Rendered when a widget extension reads a snapshot whose `schemaVersion`
/// differs from `EXPECTED_SCHEMA_VERSION` (the literal the binary was compiled
/// against). MS041 makes this an explicit user-visible state rather than a
/// silent fallback to placeholder, so a user who upgraded the host without
/// re-installing the widget extension (or vice versa) sees "Update <surface>"
/// instead of stale-looking marketing copy.
///
/// The view is deliberately minimal: one SF Symbol, one caption-sized line.
/// All widget families render it the same way; the small footprint suits
/// `.accessoryCircular` and `.systemSmall` without family-specific layout.
public struct MobileSurfacesVersionMismatchView: View {
  public let kindLabel: String

  public init(kindLabel: String) {
    self.kindLabel = kindLabel
  }

  public var body: some View {
    VStack(spacing: 4) {
      Image(systemName: "arrow.triangle.2.circlepath")
        .font(.title3)
      Text("Update " + kindLabel)
        .font(.caption)
        .multilineTextAlignment(.center)
        .lineLimit(2)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .containerBackground(.fill.tertiary, for: .widget)
  }
}
