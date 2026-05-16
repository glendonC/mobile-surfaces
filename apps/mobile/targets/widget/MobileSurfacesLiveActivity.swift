import ActivityKit
import SwiftUI
import WidgetKit

struct MobileSurfacesLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: MobileSurfacesActivityAttributes.self) { context in
      LockScreenView(context: context)
        .activityBackgroundTint(Color("WidgetBackground"))
        .activitySystemActionForegroundColor(Color.primary)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text(context.attributes.modeLabel.uppercased())
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text("\(Int(context.state.progress * 100))%")
            .font(.caption.weight(.medium))
            .monospacedDigit()
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.state.headline)
            .font(.headline)
            .lineLimit(2)
        }
        DynamicIslandExpandedRegion(.bottom) {
          ProgressView(value: context.state.progress)
            .tint(Color("AccentColor"))
        }
      } compactLeading: {
        Image(systemName: "bolt.horizontal.circle")
          .foregroundStyle(Color("AccentColor"))
      } compactTrailing: {
        Text("\(Int(context.state.progress * 100))%")
          .font(.caption2.weight(.medium))
          .monospacedDigit()
      } minimal: {
        Image(systemName: "bolt.horizontal.circle")
          .foregroundStyle(Color("AccentColor"))
      }
    }
  }
}

private struct LockScreenView: View {
  let context: ActivityViewContext<MobileSurfacesActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(context.attributes.modeLabel.uppercased())
          .font(.caption2.weight(.semibold))
          .foregroundStyle(.secondary)
        Spacer()
        StagePill(stage: context.state.stage)
      }
      Text(context.state.headline)
        .font(.headline)
      Text(context.state.subhead)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .lineLimit(2)
      ProgressView(value: context.state.progress)
        .tint(Color("AccentColor"))
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }
}

private struct StagePill: View {
  let stage: MobileSurfacesActivityAttributes.Stage

  var body: some View {
    Text(label)
      .font(.caption2.weight(.medium))
      .padding(.horizontal, 8)
      .padding(.vertical, 2)
      .background(
        Capsule().fill(Color("AccentColor").opacity(0.15))
      )
      .foregroundStyle(Color("AccentColor"))
  }

  private var label: String { stage.displayLabel }
}
