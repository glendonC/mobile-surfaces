import SwiftUI
import WidgetKit

// StandBy on iOS 17+ presents a `systemSmall` widget full-screen when the
// device is in landscape on a charger. Widgets opt in by supporting
// `systemSmall` and using `.containerBackground` so the system can lift the
// background in StandBy night mode. The `presentation` hint comes from the
// snapshot so the app can author distinct day/night looks against the same
// surface data.
struct MobileSurfacesStandbyWidget: Widget {
  static let kind = MobileSurfacesSharedState.standbyWidgetKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: MobileSurfacesStandbyProvider()) { entry in
      MobileSurfacesStandbyView(entry: entry)
        .containerBackground(for: .widget) {
          MobileSurfacesStandbyBackground(snapshot: entry.snapshot ?? .placeholder)
        }
    }
    .configurationDisplayName("Mobile Surfaces StandBy")
    .description("Show the active surface while the device is charging on its side.")
    .supportedFamilies([.systemSmall])
  }
}

struct MobileSurfacesStandbyEntry: TimelineEntry {
  let date: Date
  let snapshot: MobileSurfacesStandbySnapshot?
  let writtenAt: Date?
}

struct MobileSurfacesStandbyProvider: TimelineProvider {
  func placeholder(in context: Context) -> MobileSurfacesStandbyEntry {
    MobileSurfacesStandbyEntry(date: Date(), snapshot: .placeholder, writtenAt: nil)
  }

  func getSnapshot(
    in context: Context,
    completion: @escaping (MobileSurfacesStandbyEntry) -> Void
  ) {
    if context.isPreview {
      completion(MobileSurfacesStandbyEntry(
        date: Date(),
        snapshot: .marketing,
        writtenAt: nil
      ))
      return
    }
    completion(MobileSurfacesStandbyEntry(
      date: Date(),
      snapshot: currentSnapshot(),
      writtenAt: currentWrittenAt()
    ))
  }

  func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<MobileSurfacesStandbyEntry>) -> Void
  ) {
    completion(Timeline(entries: [
      MobileSurfacesStandbyEntry(
        date: Date(),
        snapshot: currentSnapshot(),
        writtenAt: currentWrittenAt()
      )
    ], policy: .never))
  }

  private func currentSnapshot() -> MobileSurfacesStandbySnapshot {
    MobileSurfacesSharedState.standbySnapshot() ?? .placeholder
  }

  private func currentWrittenAt() -> Date? {
    MobileSurfacesSharedState.snapshotWrittenAt(
      currentSurfaceIdKey: MobileSurfacesSharedState.standbyCurrentSurfaceIdKey
    )
  }
}

private struct MobileSurfacesStandbyView: View {
  let entry: MobileSurfacesStandbyEntry

  var body: some View {
    let snapshot = entry.snapshot ?? .placeholder
    let isStale = MobileSurfacesSharedState.isSnapshotStale(
      writtenAt: entry.writtenAt,
      threshold: MobileSurfacesSharedState.standbyStaleAfter
    )
    let isMonochrome = snapshot.tint == "monochrome"
    VStack(alignment: .leading, spacing: 6) {
      Text((isStale ? "· " : "") + MobileSurfacesLifecycleStateDisplay.displayLabel(for: snapshot.state))
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
      Text(snapshot.headline)
        .font(.title3.weight(.semibold))
        .lineLimit(2)
      Text(snapshot.subhead)
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(2)
      Spacer(minLength: 0)
      ProgressView(value: snapshot.progress)
        .tint(isMonochrome ? Color.primary : Color("AccentColor"))
    }
    .padding()
    .opacity(isStale ? 0.7 : 1.0)
  }
}

private struct MobileSurfacesStandbyBackground: View {
  let snapshot: MobileSurfacesStandbySnapshot

  var body: some View {
    if snapshot.presentation == "night" {
      Color.black
    } else {
      Color("WidgetBackground")
    }
  }
}

private extension MobileSurfacesStandbySnapshot {
  static let placeholder = MobileSurfacesStandbySnapshot(
    kind: "standby",
    snapshotId: "placeholder",
    surfaceId: "surface-placeholder",
    state: "queued",
    presentation: "card",
    tint: nil,
    headline: "Mobile Surfaces",
    subhead: "Refresh a StandBy fixture from the harness.",
    progress: 0,
    deepLink: "mobilesurfaces://surface/surface-placeholder"
  )

  static let marketing = MobileSurfacesStandbySnapshot(
    kind: "standby",
    snapshotId: "marketing",
    surfaceId: "surface-marketing",
    state: "active",
    presentation: "card",
    tint: "default",
    headline: "Tour 42",
    subhead: "Charging · 72% to next stop",
    progress: 0.72,
    deepLink: "mobilesurfaces://surface/surface-marketing"
  )
}
