import SwiftUI
import WidgetKit

struct MobileSurfacesLockAccessoryWidget: Widget {
  static let kind = MobileSurfacesSharedState.lockAccessoryWidgetKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: MobileSurfacesLockAccessoryProvider()) { entry in
      MobileSurfacesLockAccessoryView(entry: entry)
    }
    .configurationDisplayName("Mobile Surfaces Accessory")
    .description("Mirror the latest surface progress on the Lock Screen.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

struct MobileSurfacesLockAccessoryEntry: TimelineEntry {
  let date: Date
  let snapshot: MobileSurfacesLockAccessorySnapshot?
}

struct MobileSurfacesLockAccessoryProvider: TimelineProvider {
  func placeholder(in context: Context) -> MobileSurfacesLockAccessoryEntry {
    MobileSurfacesLockAccessoryEntry(date: Date(), snapshot: .placeholder)
  }

  func getSnapshot(
    in context: Context,
    completion: @escaping (MobileSurfacesLockAccessoryEntry) -> Void
  ) {
    completion(MobileSurfacesLockAccessoryEntry(date: Date(), snapshot: currentSnapshot()))
  }

  func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<MobileSurfacesLockAccessoryEntry>) -> Void
  ) {
    completion(Timeline(entries: [
      MobileSurfacesLockAccessoryEntry(date: Date(), snapshot: currentSnapshot())
    ], policy: .never))
  }

  private func currentSnapshot() -> MobileSurfacesLockAccessorySnapshot {
    MobileSurfacesSharedState.lockAccessorySnapshot() ?? .placeholder
  }
}

private struct MobileSurfacesLockAccessoryView: View {
  let entry: MobileSurfacesLockAccessoryEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let snapshot = entry.snapshot ?? .placeholder
    switch family {
    case .accessoryCircular:
      // Gauge ring + tight numeric label. accessoryCircular is ~24pt, so the
      // shortText must already be terse — the schema caps it at 20 chars.
      Gauge(value: snapshot.gaugeValue) {
        Text(snapshot.shortText)
          .font(.caption2)
      }
      .gaugeStyle(.accessoryCircularCapacity)
      .containerBackground(.fill.tertiary, for: .widget)
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text(snapshot.headline)
          .font(.headline)
          .lineLimit(1)
        ProgressView(value: snapshot.gaugeValue)
          .progressViewStyle(.linear)
        Text(snapshot.shortText)
          .font(.caption2)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      .containerBackground(.fill.tertiary, for: .widget)
    case .accessoryInline:
      // A single line. The system clips this aggressively, so render the
      // shortText only.
      Text(snapshot.shortText)
    default:
      Text(snapshot.shortText)
    }
  }
}

private extension MobileSurfacesLockAccessorySnapshot {
  static let placeholder = MobileSurfacesLockAccessorySnapshot(
    kind: "lockAccessory",
    snapshotId: "placeholder",
    surfaceId: "surface-placeholder",
    state: "queued",
    family: "accessoryCircular",
    headline: "Mobile Surfaces",
    shortText: "0%",
    gaugeValue: 0,
    deepLink: "mobilesurfaces://surface/surface-placeholder"
  )
}
