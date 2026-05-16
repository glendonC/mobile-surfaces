import AppIntents
import SwiftUI
import WidgetKit

@available(iOS 18.0, *)
struct MobileSurfacesControlWidget: ControlWidget {
  static let kind = MobileSurfacesSharedState.controlWidgetKind

  var body: some ControlWidgetConfiguration {
    AppIntentControlConfiguration(
      kind: Self.kind,
      provider: MobileSurfacesControlProvider()
    ) { state in
      ControlWidgetToggle(
        state.label,
        isOn: state.isOn,
        action: MobileSurfacesToggleControlIntent()
      ) { isOn in
        // Distinguish the three states visually in Control Center:
        //   - .live + on    → filled bolt
        //   - .live + off   → outlined bolt (user toggled off; system OK)
        //   - .placeholder  → questionmark (no snapshot / decode failed;
        //                      host-side diagnose can read the breadcrumb)
        //   - .marketing    → widget-gallery preview
        Label(
          state.controlCenterLabel(isOn: isOn),
          systemImage: state.controlCenterSymbol(isOn: isOn)
        )
      }
    }
    .displayName("Mobile Surface")
    .description("Toggle the shared Mobile Surfaces control state.")
  }
}

@available(iOS 18.0, *)
struct MobileSurfacesControlProvider: AppIntentControlValueProvider {
  func previewValue(configuration: MobileSurfacesControlConfigurationIntent) -> MobileSurfacesControlState {
    // Widget-gallery preview: curated marketing copy, never the live App
    // Group. Distinct .marketing status so the rendering side picks a
    // representative on-state without implying anything about the user's
    // real toggle.
    MobileSurfacesControlState(label: "Mobile Surface", isOn: true, status: .marketing)
  }

  func currentValue(configuration: MobileSurfacesControlConfigurationIntent) async throws -> MobileSurfacesControlState {
    if let snapshot = MobileSurfacesSharedState.controlSnapshot() {
      return MobileSurfacesControlState(
        label: snapshot.label,
        isOn: snapshot.value ?? false,
        status: .live
      )
    }
    // No snapshot in the App Group (or the decode failed and was already
    // breadcrumbed by MobileSurfacesSharedState). Render a visually
    // distinct placeholder so an operator opening Control Center sees the
    // surface is unconfigured rather than mistakenly reading it as
    // "user toggled off".
    return MobileSurfacesControlState(
      label: "Mobile Surface — not configured",
      isOn: false,
      status: .placeholder
    )
  }
}

struct MobileSurfacesControlState: Hashable {
  let label: String
  let isOn: Bool
  let status: Status

  enum Status: Hashable {
    case live
    case placeholder
    case marketing
  }

  func controlCenterSymbol(isOn: Bool) -> String {
    switch status {
    case .placeholder:
      return "questionmark.circle"
    case .live, .marketing:
      return isOn ? "bolt.circle.fill" : "bolt.circle"
    }
  }

  func controlCenterLabel(isOn: Bool) -> String {
    switch status {
    case .placeholder:
      return "Not configured"
    case .live, .marketing:
      return isOn ? "On" : "Off"
    }
  }
}
