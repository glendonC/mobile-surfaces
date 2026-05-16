// Stable adapter surface for Live Activity operations. Importers should use
// this module instead of reaching into @mobile-surfaces/live-activity so a
// future swap (e.g. to expo-live-activity, expo-widgets, or a custom native
// module) is a one-file edit here plus a shim conforming to LiveActivityAdapter.
// The interface lives in @mobile-surfaces/live-activity and is what the local
// native module already implements; importing the runtime value through the
// adapter type is what makes drift a tsc error rather than a silent regression.
import liveActivityNative, {
  type LiveActivityAdapter,
} from "@mobile-surfaces/live-activity";

export const liveActivityAdapter: LiveActivityAdapter = liveActivityNative;

export type {
  LiveActivityAdapter,
  LiveActivityChannelStartResult,
  LiveActivityContentState,
  LiveActivityEvents,
  LiveActivitySnapshot,
  LiveActivityStage,
} from "@mobile-surfaces/live-activity";
