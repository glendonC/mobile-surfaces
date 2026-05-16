import Foundation
import SwiftUI

// Display labels for the Live Activity Stage pill and any other surface
// that needs short, human-readable copy for an ActivityKit Stage value.
//
// The Zod contract names the cases for backend producers (prompted /
// inProgress / completing); those strings are accurate to the wire format
// but too long to fit in the Dynamic Island leading region at small
// dynamic-type sizes. The display labels here are the project's UI copy
// for the same value. Mapping lives in one place so future contributors
// changing the pill copy do not drift from the contract.
//
// Swift's exhaustive switch catches a new Zod stage case at compile time,
// AND the surface-check.mjs gate (check-activity-attributes) enforces
// case parity between Swift's Stage enum and the Zod liveSurfaceStage
// enum. Either side moving in isolation fails the build.

import WidgetKit

extension MobileSurfacesActivityAttributes.Stage {
  /// Short pill copy. Edit here, not at the StagePill view, so all
  /// stage-display surfaces in the widget target stay consistent.
  var displayLabel: String {
    switch self {
    case .prompted: return "READY"
    case .inProgress: return "LIVE"
    case .completing: return "WRAP"
    }
  }

  /// Pill tint for the stage. The previous StagePill ignored its `stage`
  /// argument and used `AccentColor` for every value, which made the pill
  /// indistinguishable across the prompted -> inProgress -> completing
  /// lifecycle. Tinting per case gives the Lock Screen a quick visual signal
  /// without changing the contract. Mapped in one place so any future change
  /// (e.g. new Stage case from Zod) is exhaustive at compile time, same as
  /// `displayLabel`.
  var tintColor: Color {
    switch self {
    case .prompted: return .orange
    case .inProgress: return Color("AccentColor")
    case .completing: return .green
    }
  }
}

// Display labels for the lifecycle state enum carried by every surface
// snapshot. Without this, the home/standby widgets render the raw enum
// value uppercased — which produces "BAD_TIMING" instead of a friendly
// label. The mapping is exhaustive over the Zod liveSurfaceState enum;
// adding a state to Zod requires updating this map (and the parity check
// scripts will catch any drift in the future).
enum MobileSurfacesLifecycleStateDisplay {
  static func displayLabel(for rawState: String) -> String {
    switch rawState {
    case "queued": return "QUEUED"
    case "active": return "ACTIVE"
    case "paused": return "PAUSED"
    case "attention": return "ATTENTION"
    case "bad_timing": return "WAITING"
    case "completed": return "DONE"
    // Forward-compat: any state the Zod source adds before the Swift
    // mapping is updated falls back to the raw value uppercased. The
    // ActivityKit attributes parity check (MS003/MS004) fires on the
    // next CI run so the gap closes fast.
    default: return rawState.uppercased()
    }
  }
}
