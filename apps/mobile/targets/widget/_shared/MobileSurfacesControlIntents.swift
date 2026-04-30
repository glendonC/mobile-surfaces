import AppIntents
import WidgetKit

@available(iOS 18.0, *)
struct MobileSurfacesControlConfigurationIntent: ControlConfigurationIntent {
  static let title: LocalizedStringResource = "Mobile Surface"
  static let description = IntentDescription("Selects the Mobile Surfaces control state.")

  func perform() async throws -> some IntentResult {
    .result()
  }
}

@available(iOS 18.0, *)
struct MobileSurfacesToggleControlIntent: SetValueIntent {
  static let title: LocalizedStringResource = "Toggle Surface"
  static let description = IntentDescription("Updates the shared Mobile Surfaces control value.")

  @Parameter(title: "Enabled")
  var value: Bool

  init() {}

  func perform() async throws -> some IntentResult {
    MobileSurfacesSharedState.writeControlValue(value)
    WidgetCenter.shared.reloadTimelines(ofKind: MobileSurfacesSharedState.homeWidgetKind)
    ControlCenter.shared.reloadControls(ofKind: MobileSurfacesSharedState.controlWidgetKind)
    return .result()
  }
}
