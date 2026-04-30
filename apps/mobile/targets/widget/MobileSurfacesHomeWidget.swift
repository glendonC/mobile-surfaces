import SwiftUI
import WidgetKit

struct MobileSurfacesHomeWidget: Widget {
  static let kind = MobileSurfacesSharedState.homeWidgetKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: MobileSurfacesHomeProvider()) { entry in
      MobileSurfacesHomeWidgetView(entry: entry)
        .containerBackground(Color("WidgetBackground"), for: .widget)
    }
    .configurationDisplayName("Mobile Surfaces")
    .description("Preview the latest shared surface snapshot.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

struct MobileSurfacesHomeEntry: TimelineEntry {
  let date: Date
  let snapshot: MobileSurfacesWidgetSnapshot?
}

struct MobileSurfacesHomeProvider: TimelineProvider {
  func placeholder(in context: Context) -> MobileSurfacesHomeEntry {
    MobileSurfacesHomeEntry(date: Date(), snapshot: .placeholder)
  }

  func getSnapshot(
    in context: Context,
    completion: @escaping (MobileSurfacesHomeEntry) -> Void
  ) {
    completion(MobileSurfacesHomeEntry(date: Date(), snapshot: currentSnapshot()))
  }

  func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<MobileSurfacesHomeEntry>) -> Void
  ) {
    completion(Timeline(entries: [
      MobileSurfacesHomeEntry(date: Date(), snapshot: currentSnapshot())
    ], policy: .never))
  }

  private func currentSnapshot() -> MobileSurfacesWidgetSnapshot {
    MobileSurfacesSharedState.widgetSnapshot() ?? .placeholder
  }
}

private struct MobileSurfacesHomeWidgetView: View {
  let entry: MobileSurfacesHomeEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let snapshot = entry.snapshot ?? .placeholder
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(snapshot.state.uppercased())
          .font(.caption2.weight(.semibold))
          .foregroundStyle(.secondary)
        Spacer()
        Text("\(Int(snapshot.progress * 100))%")
          .font(.caption2.weight(.medium))
          .monospacedDigit()
      }

      Text(snapshot.headline)
        .font(family == .systemSmall ? .headline : .title3.weight(.semibold))
        .lineLimit(family == .systemSmall ? 2 : 3)

      if family != .systemSmall {
        Text(snapshot.subhead)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }

      Spacer(minLength: 0)

      ProgressView(value: snapshot.progress)
        .tint(Color("AccentColor"))
    }
    .padding()
  }
}

private extension MobileSurfacesWidgetSnapshot {
  static let placeholder = MobileSurfacesWidgetSnapshot(
    kind: "widget",
    snapshotId: "placeholder",
    surfaceId: "surface-placeholder",
    state: "queued",
    family: "systemMedium",
    reloadPolicy: "manual",
    headline: "Mobile Surfaces",
    subhead: "Refresh a widget fixture from the harness.",
    progress: 0,
    deepLink: "mobilesurfaces://surface/surface-placeholder"
  )
}
