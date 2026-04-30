import SwiftUI
import WidgetKit

@main
struct MobileSurfacesWidgetBundle: WidgetBundle {
  @WidgetBundleBuilder
  var body: some Widget {
    MobileSurfacesLiveActivity()
    MobileSurfacesHomeWidget()
    if #available(iOS 18.0, *) {
      MobileSurfacesControlWidget()
    }
  }
}
