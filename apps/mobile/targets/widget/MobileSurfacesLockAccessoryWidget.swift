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
  // Wall-clock instant at which the host wrote this snapshot to the App Group
  // (Unix seconds). Surfaced into the view layer so we can draw a subtle
  // staleness hint when the host process has been killed and the timeline is
  // pinned to `.never`. `nil` means "no breadcrumb yet" - treat as fresh.
  let writtenAt: Date?
}

struct MobileSurfacesLockAccessoryProvider: TimelineProvider {
  func placeholder(in context: Context) -> MobileSurfacesLockAccessoryEntry {
    MobileSurfacesLockAccessoryEntry(date: Date(), snapshot: .placeholder, writtenAt: nil)
  }

  func getSnapshot(
    in context: Context,
    completion: @escaping (MobileSurfacesLockAccessoryEntry) -> Void
  ) {
    // Marketing preview path: App Store / widget gallery requests a
    // deterministic snapshot, never the live App Group state.
    if context.isPreview {
      completion(MobileSurfacesLockAccessoryEntry(
        date: Date(),
        snapshot: .marketing,
        writtenAt: nil
      ))
      return
    }
    completion(MobileSurfacesLockAccessoryEntry(
      date: Date(),
      snapshot: currentSnapshot(),
      writtenAt: currentWrittenAt()
    ))
  }

  func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<MobileSurfacesLockAccessoryEntry>) -> Void
  ) {
    // `.never` is the right policy for external-snapshot widgets - WidgetKit
    // refreshes only when the host calls reloadTimelines. The staleness hint
    // in the view layer covers the "host killed, snapshot never updated" case
    // so the lock screen does not show pinned-forever data without signal.
    completion(Timeline(entries: [
      MobileSurfacesLockAccessoryEntry(
        date: Date(),
        snapshot: currentSnapshot(),
        writtenAt: currentWrittenAt()
      )
    ], policy: .never))
  }

  private func currentSnapshot() -> MobileSurfacesLockAccessorySnapshot {
    MobileSurfacesSharedState.lockAccessorySnapshot() ?? .placeholder
  }

  private func currentWrittenAt() -> Date? {
    MobileSurfacesSharedState.snapshotWrittenAt(
      currentSurfaceIdKey: MobileSurfacesSharedState.lockAccessoryCurrentSurfaceIdKey
    )
  }
}

private struct MobileSurfacesLockAccessoryView: View {
  let entry: MobileSurfacesLockAccessoryEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let snapshot = entry.snapshot ?? .placeholder
    let isStale = MobileSurfacesSharedState.isSnapshotStale(
      writtenAt: entry.writtenAt,
      threshold: MobileSurfacesSharedState.lockAccessoryStaleAfter
    )
    switch family {
    case .accessoryCircular:
      // Gauge ring + tight numeric label. accessoryCircular is ~24pt, so the
      // shortText must already be terse - the schema caps it at 20 chars.
      // Missing gaugeValue means the projection chose not to surface a ring
      // for this state; render the headline only rather than a fake zero.
      Group {
        if let gauge = snapshot.gaugeValue {
          Gauge(value: gauge) {
            if let text = snapshot.shortText {
              Text(text)
                .font(.caption2)
            }
          }
          .gaugeStyle(.accessoryCircularCapacity)
        } else if let text = snapshot.shortText {
          Text(text)
            .font(.caption2)
        } else {
          Text(snapshot.headline)
            .font(.caption2)
            .lineLimit(1)
        }
      }
      .opacity(isStale ? 0.55 : 1.0)
      .containerBackground(.fill.tertiary, for: .widget)
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text(snapshot.headline)
          .font(.headline)
          .lineLimit(1)
        if let gauge = snapshot.gaugeValue {
          ProgressView(value: gauge)
            .progressViewStyle(.linear)
        }
        if let text = snapshot.shortText {
          Text(text)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      .opacity(isStale ? 0.55 : 1.0)
      .containerBackground(.fill.tertiary, for: .widget)
    case .accessoryInline:
      // A single line. The system clips this aggressively. Render shortText if
      // present; fall back to headline so the row is never empty. The leading
      // dot indicates staleness without claiming a STALE banner.
      if let text = snapshot.shortText {
        Text(isStale ? "· \(text)" : text)
      } else {
        Text(isStale ? "· \(snapshot.headline)" : snapshot.headline)
      }
    default:
      Text(snapshot.shortText ?? snapshot.headline)
        .opacity(isStale ? 0.55 : 1.0)
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

  // Marketing copy used for App Store screenshots and the widget gallery
  // preview. Deterministic and curated rather than whatever the device's App
  // Group container happens to hold when Apple takes the screenshot.
  static let marketing = MobileSurfacesLockAccessorySnapshot(
    kind: "lockAccessory",
    snapshotId: "marketing",
    surfaceId: "surface-marketing",
    state: "active",
    family: "accessoryCircular",
    headline: "Tour 42",
    shortText: "72%",
    gaugeValue: 0.72,
    deepLink: "mobilesurfaces://surface/surface-marketing"
  )
}
