import SwiftUI
import UIKit
import UserNotifications
import UserNotificationsUI

/// Principal class for the Mobile Surfaces UNNotificationContentExtension.
/// Renders the expanded notification view iOS shows when the user long-presses
/// (or pulls down on) a notification whose `aps.category` matches one of the
/// values in this target's Info.plist `UNNotificationExtensionCategory` array.
///
/// Rendering source-of-truth: the push payload only. Specifically the
/// `liveSurface` sidecar emitted by `toNotificationContentPayload`
/// (`packages/surface-contracts/src/index.ts`) plus the standard
/// `aps.alert.{title, subtitle, body}` strings that iOS already surfaces via
/// `notification.request.content`. We deliberately do NOT read from the App
/// Group container here: the host app is the only writer to that container,
/// and the host may not have run recently enough for any enrichment row to
/// exist when the notification arrives. App-Group enrichment is the
/// canonical Apple pattern when paired with a `UNNotificationServiceExtension`
/// that writes before delivery; that target is deferred to a follow-up (see
/// the roadmap's "Deferred - notification service extension" section).
///
/// The default system chrome (title + body) renders above this view because
/// the Info.plist omits `UNNotificationExtensionDefaultContentHidden`, so a
/// decode failure in our SwiftUI body never strips the user-visible
/// notification copy.
final class MobileSurfacesNotificationViewController: UIViewController, UNNotificationContentExtension {
  private var hostingController: UIHostingController<MobileSurfacesNotificationContentView>?
  private let viewModel = NotificationContentViewModel()

  override func viewDidLoad() {
    super.viewDidLoad()
    let host = UIHostingController(
      rootView: MobileSurfacesNotificationContentView(viewModel: viewModel),
    )
    addChild(host)
    host.view.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      host.view.topAnchor.constraint(equalTo: view.topAnchor),
      host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    host.didMove(toParent: self)
    hostingController = host
  }

  /// Called by iOS once per notification while the extension is on screen.
  /// May fire more than once if the system updates the visible notification
  /// (e.g. a follow-up push with the same `apns-id`).
  func didReceive(_ notification: UNNotification) {
    let content = notification.request.content
    let sidecar = decodeLiveSurfaceSidecar(from: content.userInfo)
    viewModel.update(
      title: content.title,
      subtitle: content.subtitle.isEmpty ? nil : content.subtitle,
      body: content.body,
      sidecar: sidecar,
    )
  }

  /// Decode the `liveSurface` block from the notification's userInfo. iOS
  /// deserializes the wire JSON into NSDictionary at delivery time, so the
  /// canonical Swift round-trip is: cast to `[String: Any]`, re-serialize via
  /// JSONSerialization, then JSONDecoder into our Codable struct. Returns
  /// nil on any decode failure rather than crashing the extension.
  private func decodeLiveSurfaceSidecar(
    from userInfo: [AnyHashable: Any],
  ) -> MobileSurfacesNotificationContentEntry? {
    guard let liveSurface = userInfo["liveSurface"] as? [String: Any] else {
      return nil
    }
    do {
      let data = try JSONSerialization.data(withJSONObject: liveSurface)
      return try JSONDecoder().decode(MobileSurfacesNotificationContentEntry.self, from: data)
    } catch {
      // Surface the decode failure to host-side diagnostics through the same
      // App Group breadcrumb the widget extensions use (MS036 pattern).
      // Distinct key (`surface.notification.decodeError`) so a stale-snapshot
      // breadcrumb from the widget side does not mask a fresh-extension
      // failure here.
      if let defaults = UserDefaults(suiteName: MobileSurfacesAppGroup.identifier) {
        let payload: [String: Any] = [
          "at": ISO8601DateFormatter().string(from: Date()),
          "error": String(describing: error),
          "type": "notification-content-extension-decode",
        ]
        if let bytes = try? JSONSerialization.data(withJSONObject: payload),
           let raw = String(data: bytes, encoding: .utf8) {
          defaults.set(raw, forKey: "surface.notification.decodeError")
        }
      }
      return nil
    }
  }
}

/// Codable mirror of `liveSurfaceNotificationContentEntry` from the Zod source
/// of truth. MS036's check-surface-snapshots gate verifies field/type/optionality
/// parity against the schema; never hand-edit the field set in isolation.
struct MobileSurfacesNotificationContentEntry: Codable, Hashable {
  let schemaVersion: String
  let kind: String
  let snapshotId: String
  let surfaceId: String
  let state: String
  let deepLink: String
  let category: String?
}

/// SwiftUI body the extension renders. Plain text-stacked layout that
/// gracefully handles a missing sidecar; the system alert chrome renders
/// above it regardless.
private struct MobileSurfacesNotificationContentView: View {
  @ObservedObject var viewModel: NotificationContentViewModel

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let subtitle = viewModel.subtitle {
        Text(subtitle)
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      if !viewModel.body.isEmpty {
        Text(viewModel.body)
          .font(.body)
      }
      if let sidecar = viewModel.sidecar {
        HStack(spacing: 6) {
          Image(systemName: "circle.fill")
            .imageScale(.small)
            .foregroundStyle(stateTint(sidecar.state))
          Text(sidecar.state.uppercased())
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
          Spacer()
          if let category = sidecar.category {
            Text(category)
              .font(.caption2)
              .foregroundStyle(.tertiary)
          }
        }
        .padding(.top, 4)
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func stateTint(_ state: String) -> Color {
    switch state {
    case "attention":
      return .orange
    case "completed":
      return .green
    case "paused", "bad_timing":
      return .gray
    default:
      return .blue
    }
  }
}

/// Bindable view-model fed by `didReceive(_:)`. ObservableObject so a
/// follow-up notification (same `apns-id`, updated content) refreshes the
/// rendered view without recreating the UIHostingController.
final class NotificationContentViewModel: ObservableObject {
  @Published var title: String = ""
  @Published var subtitle: String? = nil
  @Published var body: String = ""
  @Published var sidecar: MobileSurfacesNotificationContentEntry? = nil

  func update(
    title: String,
    subtitle: String?,
    body: String,
    sidecar: MobileSurfacesNotificationContentEntry?,
  ) {
    self.title = title
    self.subtitle = subtitle
    self.body = body
    self.sidecar = sidecar
  }
}
