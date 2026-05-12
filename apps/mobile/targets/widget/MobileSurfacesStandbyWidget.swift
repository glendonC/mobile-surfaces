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
}

struct MobileSurfacesStandbyProvider: TimelineProvider {
  func placeholder(in context: Context) -> MobileSurfacesStandbyEntry {
    MobileSurfacesStandbyEntry(date: Date(), snapshot: .placeholder)
  }

  func getSnapshot(
    in context: Context,
    completion: @escaping (MobileSurfacesStandbyEntry) -> Void
  ) {
    completion(MobileSurfacesStandbyEntry(date: Date(), snapshot: currentSnapshot()))
  }

  func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<MobileSurfacesStandbyEntry>) -> Void
  ) {
    completion(Timeline(entries: [
      MobileSurfacesStandbyEntry(date: Date(), snapshot: currentSnapshot())
    ], policy: .never))
  }

  private func currentSnapshot() -> MobileSurfacesStandbySnapshot {
    MobileSurfacesSharedState.standbySnapshot() ?? .placeholder
  }
}

private struct MobileSurfacesStandbyView: View {
  let entry: MobileSurfacesStandbyEntry

  var body: some View {
    let snapshot = entry.snapshot ?? .placeholder
    let isMonochrome = snapshot.tint == "monochrome"
    VStack(alignment: .leading, spacing: 6) {
      Text(snapshot.state.uppercased())
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
}
