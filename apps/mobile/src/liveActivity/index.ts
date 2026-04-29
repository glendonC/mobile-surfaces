// Stable adapter surface for Live Activity operations. Importers should use
// this module instead of reaching into apps/mobile/modules/live-activity so a
// future swap (e.g. to expo-live-activity or expo-widgets) is a one-file edit.
export { default as liveActivityAdapter } from "../../modules/live-activity";
export type {
  LiveActivityContentState,
  LiveActivityEvents,
  LiveActivitySnapshot,
  LiveActivityStage,
} from "../../modules/live-activity";
