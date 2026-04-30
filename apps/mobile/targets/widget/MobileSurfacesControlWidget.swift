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
        Label(
          isOn ? "On" : "Off",
          systemImage: isOn ? "bolt.circle.fill" : "bolt.circle"
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
    MobileSurfacesControlState(label: "Mobile Surface", isOn: false)
  }

  func currentValue(configuration: MobileSurfacesControlConfigurationIntent) async throws -> MobileSurfacesControlState {
    if let snapshot = MobileSurfacesSharedState.controlSnapshot() {
      return MobileSurfacesControlState(
        label: snapshot.label,
        isOn: snapshot.value ?? false
      )
    }
    return MobileSurfacesControlState(label: "Mobile Surface", isOn: false)
  }
}

struct MobileSurfacesControlState: Hashable {
  let label: String
  let isOn: Bool
}
