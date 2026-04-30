import { ExtensionStorage } from "@bacons/apple-targets";
import {
  toControlValueProvider,
  toWidgetTimelineEntry,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

const APP_GROUP = "group.com.example.mobilesurfaces";
const WIDGET_KIND = "MobileSurfacesHomeWidget";
const CONTROL_KIND = "MobileSurfacesControlWidget";
const WIDGET_CURRENT_SURFACE_ID_KEY = "surface.widget.currentSurfaceId";
const CONTROL_CURRENT_SURFACE_ID_KEY = "surface.control.currentSurfaceId";

const storage = new ExtensionStorage(APP_GROUP);

export async function refreshWidgetSurface(snapshot: LiveSurfaceSnapshot) {
  const entry = toWidgetTimelineEntry(snapshot);
  storage.set(snapshotKey(entry.surfaceId), JSON.stringify(entry));
  storage.set(WIDGET_CURRENT_SURFACE_ID_KEY, entry.surfaceId);
  ExtensionStorage.reloadWidget(WIDGET_KIND);
  return entry;
}

export async function toggleControlSurface(
  snapshot: LiveSurfaceSnapshot,
  nextValue: boolean,
) {
  const entry = {
    ...toControlValueProvider(snapshot),
    value: nextValue,
  };
  storage.set(snapshotKey(entry.surfaceId), JSON.stringify(entry));
  storage.set(CONTROL_CURRENT_SURFACE_ID_KEY, entry.surfaceId);
  ExtensionStorage.reloadControls(CONTROL_KIND);
  return entry;
}

function snapshotKey(surfaceId: string) {
  return `surface.snapshot.${surfaceId}`;
}
