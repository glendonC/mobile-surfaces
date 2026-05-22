import { ExtensionStorage } from "@bacons/apple-targets";
import {
  toControlValueProvider,
  toLockAccessoryEntry,
  toStandbyEntry,
  toWidgetTimelineEntry,
  type LiveSurfaceSnapshotControl,
  type LiveSurfaceSnapshotLockAccessory,
  type LiveSurfaceSnapshotStandby,
  type LiveSurfaceSnapshotWidget,
} from "@mobile-surfaces/surface-contracts";
import { APP_GROUP } from "../generated/appGroup";
import {
  coerceSnapshotValue,
  coerceWrittenAt,
  parseDecodeErrorBreadcrumb,
  type SurfaceDecodeErrorBreadcrumb,
} from "./parse";

// Re-exported so existing importers (`../surfaceStorage`) keep resolving the
// type from one place; the definition lives in the native-free parse module.
export type { SurfaceDecodeErrorBreadcrumb } from "./parse";

const WIDGET_KIND = "MobileSurfacesHomeWidget";
const CONTROL_KIND = "MobileSurfacesControlWidget";
const LOCK_ACCESSORY_KIND = "MobileSurfacesLockAccessoryWidget";
const STANDBY_KIND = "MobileSurfacesStandbyWidget";
const WIDGET_CURRENT_SURFACE_ID_KEY = "surface.widget.currentSurfaceId";
const CONTROL_CURRENT_SURFACE_ID_KEY = "surface.control.currentSurfaceId";
const LOCK_ACCESSORY_CURRENT_SURFACE_ID_KEY = "surface.lockAccessory.currentSurfaceId";
const STANDBY_CURRENT_SURFACE_ID_KEY = "surface.standby.currentSurfaceId";

const storage = new ExtensionStorage(APP_GROUP);

// Sibling key the widget extension reads to compute a staleness hint when the
// host process has been killed and the WidgetKit timeline (`policy: .never`)
// is pinned to the last write. Stored as Unix seconds (Number). Kept off the
// snapshot payload so MS036 (Swift struct ↔ Zod projection parity) stays
// clean: this is a transport-layer breadcrumb, not part of the contract.
function writtenAtKey(surfaceId: string) {
  return `surface.snapshot.${surfaceId}.writtenAt`;
}

function stampWrittenAt(surfaceId: string) {
  storage.set(writtenAtKey(surfaceId), Math.floor(Date.now() / 1000));
}

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

export async function refreshWidgetSurface(snapshot: LiveSurfaceSnapshotWidget) {
  const entry = toWidgetTimelineEntry(snapshot);
  try {
    storage.set(snapshotKey(entry.surfaceId), JSON.stringify(entry));
    storage.set(WIDGET_CURRENT_SURFACE_ID_KEY, entry.surfaceId);
    stampWrittenAt(entry.surfaceId);
    ExtensionStorage.reloadWidget(WIDGET_KIND);
  } catch (cause) {
    throw new SurfaceStorageError("refreshWidget", entry.surfaceId, cause);
  }
  return entry;
}

export async function toggleControlSurface(
  snapshot: LiveSurfaceSnapshotControl,
  nextValue: boolean,
) {
  const entry = {
    ...toControlValueProvider(snapshot),
    value: nextValue,
  };
  try {
    storage.set(snapshotKey(entry.surfaceId), JSON.stringify(entry));
    storage.set(CONTROL_CURRENT_SURFACE_ID_KEY, entry.surfaceId);
    stampWrittenAt(entry.surfaceId);
    ExtensionStorage.reloadControls(CONTROL_KIND);
  } catch (cause) {
    throw new SurfaceStorageError("toggleControl", entry.surfaceId, cause);
  }
  return entry;
}

export async function refreshLockAccessorySurface(snapshot: LiveSurfaceSnapshotLockAccessory) {
  const entry = toLockAccessoryEntry(snapshot);
  try {
    storage.set(snapshotKey(entry.surfaceId), JSON.stringify(entry));
    storage.set(LOCK_ACCESSORY_CURRENT_SURFACE_ID_KEY, entry.surfaceId);
    stampWrittenAt(entry.surfaceId);
    ExtensionStorage.reloadWidget(LOCK_ACCESSORY_KIND);
  } catch (cause) {
    throw new SurfaceStorageError("refreshLockAccessory", entry.surfaceId, cause);
  }
  return entry;
}

export async function refreshStandbySurface(snapshot: LiveSurfaceSnapshotStandby) {
  const entry = toStandbyEntry(snapshot);
  try {
    storage.set(snapshotKey(entry.surfaceId), JSON.stringify(entry));
    storage.set(STANDBY_CURRENT_SURFACE_ID_KEY, entry.surfaceId);
    stampWrittenAt(entry.surfaceId);
    ExtensionStorage.reloadWidget(STANDBY_KIND);
  } catch (cause) {
    throw new SurfaceStorageError("refreshStandby", entry.surfaceId, cause);
  }
  return entry;
}

function snapshotKey(surfaceId: string) {
  return `surface.snapshot.${surfaceId}`;
}

// Decode-error breadcrumbs are written from the Swift side when JSONDecoder
// fails to parse the snapshot payload (MS036's silent-fail mode). Stored
// under `surface.snapshot.<id>.decodeError` and cleared on the next
// successful decode. The breadcrumb's wire shape and parsing live in
// ./parse.ts (SurfaceDecodeErrorBreadcrumb, parseDecodeErrorBreadcrumb).
function decodeErrorKey(surfaceId: string) {
  return `surface.snapshot.${surfaceId}.decodeError`;
}

/**
 * Read the decode-error breadcrumb for a single surface. Returns null when
 * no breadcrumb is set (the common case — every successful decode clears
 * the key from the Swift side) or when the value is present but malformed.
 *
 * Malformed values intentionally surface as null rather than throwing: a
 * stale breadcrumb from an older app version is not actionable, and the
 * harness diagnostics row is a "warn" hint, not a hard failure.
 */
export function readSurfaceDecodeError(
  surfaceId: string,
): SurfaceDecodeErrorBreadcrumb | null {
  let raw: unknown;
  try {
    raw = storage.get(decodeErrorKey(surfaceId));
  } catch {
    return null;
  }
  return parseDecodeErrorBreadcrumb(surfaceId, raw);
}

/**
 * Read the raw snapshot payload the host last wrote into the App Group for
 * a single surface, alongside its writtenAt timestamp and any active
 * decode-error breadcrumb. Returns null when nothing has ever been written
 * for that surface id this session.
 *
 * Used by PayloadInspectorScreen's "Live App Group dump" section to render
 * the exact bytes the widget extension sees. Tolerates missing or
 * malformed values: the inspector is read-only and the caller is expected
 * to surface failures as displayable rows, not throws.
 */
export interface SurfaceAppGroupRecord {
  readonly surfaceId: string;
  readonly snapshot: unknown | null;
  readonly writtenAt: number | null;
  readonly decodeError: SurfaceDecodeErrorBreadcrumb | null;
}

export function readSurfaceAppGroupRecord(
  surfaceId: string,
): SurfaceAppGroupRecord {
  let rawSnapshot: unknown = null;
  try {
    rawSnapshot = coerceSnapshotValue(storage.get(snapshotKey(surfaceId)));
  } catch {
    rawSnapshot = null;
  }
  let writtenAt: number | null = null;
  try {
    writtenAt = coerceWrittenAt(storage.get(writtenAtKey(surfaceId)));
  } catch {
    writtenAt = null;
  }
  return {
    surfaceId,
    snapshot: rawSnapshot,
    writtenAt,
    decodeError: readSurfaceDecodeError(surfaceId),
  };
}
