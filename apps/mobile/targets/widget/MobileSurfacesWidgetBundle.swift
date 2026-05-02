import SwiftUI
import WidgetKit

@main
struct MobileSurfacesWidgetBundle: WidgetBundle {
  @WidgetBundleBuilder
  var body: some Widget {
    MobileSurfacesLiveActivity()
    // SURFACE-BEGIN: home-widget
    MobileSurfacesHomeWidget()
    // SURFACE-END: home-widget
    // SURFACE-BEGIN: control-widget
    if #available(iOS 18.0, *) {
      MobileSurfacesControlWidget()
    }
    // SURFACE-END: control-widget
  }
}
