// Stable adapter surface for Live Activity operations. Importers should use
// this module instead of reaching into @mobile-surfaces/live-activity so a
// future swap (e.g. to expo-live-activity or expo-widgets) is a one-file edit.
export { default as liveActivityAdapter } from "@mobile-surfaces/live-activity";
export type {
  LiveActivityContentState,
  LiveActivityEvents,
  LiveActivitySnapshot,
  LiveActivityStage,
} from "@mobile-surfaces/live-activity";
