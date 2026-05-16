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
    // Reload every surface that may observe the shared control value. The
    // home widget reads the control snapshot inline; lock accessory and
    // StandBy can be configured to mirror it. Reloading is cheap (WidgetKit
    // throttles), missing a reload silently strands the surface on stale
    // state - bias toward over-reload.
    WidgetCenter.shared.reloadTimelines(ofKind: MobileSurfacesSharedState.homeWidgetKind)
    WidgetCenter.shared.reloadTimelines(ofKind: MobileSurfacesSharedState.lockAccessoryWidgetKind)
    WidgetCenter.shared.reloadTimelines(ofKind: MobileSurfacesSharedState.standbyWidgetKind)
    ControlCenter.shared.reloadControls(ofKind: MobileSurfacesSharedState.controlWidgetKind)
    return .result()
  }
}
