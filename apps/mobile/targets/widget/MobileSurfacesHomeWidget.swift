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
  // Sibling-breadcrumb wall clock for staleness rendering. See
  // MobileSurfacesSharedState.snapshotWrittenAt for context.
  let writtenAt: Date?
}

struct MobileSurfacesHomeProvider: TimelineProvider {
  func placeholder(in context: Context) -> MobileSurfacesHomeEntry {
    MobileSurfacesHomeEntry(date: Date(), snapshot: .placeholder, writtenAt: nil)
  }

  func getSnapshot(
    in context: Context,
    completion: @escaping (MobileSurfacesHomeEntry) -> Void
  ) {
    // App Store / widget gallery preview path: deterministic marketing entry,
    // never the live App Group state. Apple invokes this with `isPreview`
    // true when sampling for the gallery and screenshot pipeline.
    if context.isPreview {
      completion(MobileSurfacesHomeEntry(
        date: Date(),
        snapshot: .marketing,
        writtenAt: nil
      ))
      return
    }
    completion(MobileSurfacesHomeEntry(
      date: Date(),
      snapshot: currentSnapshot(),
      writtenAt: currentWrittenAt()
    ))
  }

  func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<MobileSurfacesHomeEntry>) -> Void
  ) {
    // `.never` is correct for external-snapshot widgets - the host calls
    // reloadTimelines when state changes. The view-layer staleness hint
    // covers the host-crash / killed-process case.
    completion(Timeline(entries: [
      MobileSurfacesHomeEntry(
        date: Date(),
        snapshot: currentSnapshot(),
        writtenAt: currentWrittenAt()
      )
    ], policy: .never))
  }

  private func currentSnapshot() -> MobileSurfacesWidgetSnapshot {
    MobileSurfacesSharedState.widgetSnapshot() ?? .placeholder
  }

  private func currentWrittenAt() -> Date? {
    MobileSurfacesSharedState.snapshotWrittenAt(
      currentSurfaceIdKey: MobileSurfacesSharedState.widgetCurrentSurfaceIdKey
    )
  }
}

private struct MobileSurfacesHomeWidgetView: View {
  let entry: MobileSurfacesHomeEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let snapshot = entry.snapshot ?? .placeholder
    let isStale = MobileSurfacesSharedState.isSnapshotStale(
      writtenAt: entry.writtenAt,
      threshold: MobileSurfacesSharedState.homeStaleAfter
    )
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(snapshot.state.uppercased())
          .font(.caption2.weight(.semibold))
          .foregroundStyle(.secondary)
        Spacer()
        // Leading dot is the staleness signal: subtle, not a banner. Reads
        // as "·  72%" when the host hasn't written in over a day.
        Text((isStale ? "· " : "") + "\(Int(snapshot.progress * 100))%")
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
    .opacity(isStale ? 0.7 : 1.0)
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

  // Curated marketing entry for the widget gallery / App Store screenshot
  // pipeline. Independent of whatever the device's App Group happens to
  // contain at preview time.
  static let marketing = MobileSurfacesWidgetSnapshot(
    kind: "widget",
    snapshotId: "marketing",
    surfaceId: "surface-marketing",
    state: "active",
    family: "systemMedium",
    reloadPolicy: "manual",
    headline: "Tour 42 to Mission Bay",
    subhead: "On time · arriving in 6 minutes",
    progress: 0.72,
    deepLink: "mobilesurfaces://surface/surface-marketing"
  )
}
