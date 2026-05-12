import { ExtensionStorage } from "@bacons/apple-targets";
import {
  toControlValueProvider,
  toLockAccessoryEntry,
  toStandbyEntry,
  toWidgetTimelineEntry,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

const APP_GROUP = "group.com.example.mobilesurfaces";
const WIDGET_KIND = "MobileSurfacesHomeWidget";
const CONTROL_KIND = "MobileSurfacesControlWidget";
const LOCK_ACCESSORY_KIND = "MobileSurfacesLockAccessoryWidget";
const STANDBY_KIND = "MobileSurfacesStandbyWidget";
const WIDGET_CURRENT_SURFACE_ID_KEY = "surface.widget.currentSurfaceId";
const CONTROL_CURRENT_SURFACE_ID_KEY = "surface.control.currentSurfaceId";
const LOCK_ACCESSORY_CURRENT_SURFACE_ID_KEY = "surface.lockAccessory.currentSurfaceId";
const STANDBY_CURRENT_SURFACE_ID_KEY = "surface.standby.currentSurfaceId";

const storage = new ExtensionStorage(APP_GROUP);

// Failures here usually mean the App Group entitlement is missing on the host
// app or the widget extension, or the App Group identifier drifted. Surface
// that to the harness rather than letting it manifest as an unexplained
// placeholder render later.
export class SurfaceStorageError extends Error {
  readonly operation: string;
  readonly surfaceId: string;
  readonly cause: unknown;

  constructor(operation: string, surfaceId: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `Surface storage ${operation} failed for "${surfaceId}": ${causeMessage}. ` +
        `Verify the App Group "${APP_GROUP}" is declared on both the app and ` +
        `widget extension entitlements.`,
    );
    this.name = "SurfaceStorageError";
    this.operation = operation;
    this.surfaceId = surfaceId;
    this.cause = cause;
  }
}

export async function refreshWidgetSurface(snapshot: LiveSurfaceSnapshot) {
  const entry = toWidgetTimelineEntry(snapshot);
  try {
    storage.set(snapshotKey(entry.surfaceId), JSON.stringify(entry));
    storage.set(WIDGET_CURRENT_SURFACE_ID_KEY, entry.surfaceId);
    ExtensionStorage.reloadWidget(WIDGET_KIND);
  } catch (cause) {
    throw new SurfaceStorageError("refreshWidget", entry.surfaceId, cause);
  }
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
  try {
    storage.set(snapshotKey(entry.surfaceId), JSON.stringify(entry));
    storage.set(CONTROL_CURRENT_SURFACE_ID_KEY, entry.surfaceId);
    ExtensionStorage.reloadControls(CONTROL_KIND);
  } catch (cause) {
    throw new SurfaceStorageError("toggleControl", entry.surfaceId, cause);
  }
  return entry;
}

export async function refreshLockAccessorySurface(snapshot: LiveSurfaceSnapshot) {
  const entry = toLockAccessoryEntry(snapshot);
  try {
    storage.set(snapshotKey(entry.surfaceId), JSON.stringify(entry));
    storage.set(LOCK_ACCESSORY_CURRENT_SURFACE_ID_KEY, entry.surfaceId);
    ExtensionStorage.reloadWidget(LOCK_ACCESSORY_KIND);
  } catch (cause) {
    throw new SurfaceStorageError("refreshLockAccessory", entry.surfaceId, cause);
  }
  return entry;
}

export async function refreshStandbySurface(snapshot: LiveSurfaceSnapshot) {
  const entry = toStandbyEntry(snapshot);
  try {
    storage.set(snapshotKey(entry.surfaceId), JSON.stringify(entry));
    storage.set(STANDBY_CURRENT_SURFACE_ID_KEY, entry.surfaceId);
    ExtensionStorage.reloadWidget(STANDBY_KIND);
  } catch (cause) {
    throw new SurfaceStorageError("refreshStandby", entry.surfaceId, cause);
  }
  return entry;
}

function snapshotKey(surfaceId: string) {
  return `surface.snapshot.${surfaceId}`;
}
