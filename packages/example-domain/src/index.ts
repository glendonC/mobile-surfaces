// Reference domain for the DeliveryExampleScreen. A food-delivery order
// is the canonical "real app" shape this repository points to: a small
// domain type, one projection family, and every surface kind populated
// from the same source of record. The screen that consumes this module
// (apps/mobile/src/screens/DeliveryExampleScreen.tsx) demonstrates the
// wire-boundary parse pattern that's load-bearing for every Mobile
// Surfaces project: domain state → projection → safeParseSnapshot →
// adapter / App Group / APNs.
//
// Production code substitutes its own domain type and its own
// projection family. The shape below is opinionated only inasmuch as
// it covers every snapshot kind v5 ships — replace `DeliveryOrder`
// with `RideRequest`, `Build`, `MatchScore`, etc., and the rest of
// the surface plumbing stays the same.

import {
  assertSnapshot,
  type LiveSurfaceSnapshot,
  type LiveSurfaceSnapshotControl,
  type LiveSurfaceSnapshotLiveActivity,
  type LiveSurfaceSnapshotLockAccessory,
  type LiveSurfaceSnapshotNotification,
  type LiveSurfaceSnapshotStandby,
  type LiveSurfaceSnapshotWidget,
  type LiveSurfaceKind,
  type LiveSurfaceStage,
  type LiveSurfaceState,
} from "@mobile-surfaces/surface-contracts";

/**
 * Order lifecycle states. The wire-level liveSurfaceStage enum carries
 * three values (`prompted`, `inProgress`, `completing`); domain stages
 * fold into them via STAGE_MAP below.
 */
export type DeliveryStage =
  | "placed" // order received, awaiting kitchen
  | "preparing" // kitchen working on it
  | "out_for_delivery" // driver heading over
  | "delivered"; // complete

export interface DeliveryOrder {
  readonly id: string;
  readonly restaurant: string;
  readonly itemCount: number;
  readonly stage: DeliveryStage;
  /** ISO-8601, when the order was first placed. */
  readonly placedAt: string;
  /** Remaining minutes; absent once delivered. */
  readonly etaMinutes?: number;
  readonly driverName?: string;
  /** Open-order URL (deep link to the host app). */
  readonly deepLink: string;
  /** ISO-8601, monotonic — every state change bumps this. */
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Stage mappings. Domain → wire enums. Keep these tables explicit so a
// reader can see at a glance how every DeliveryStage projects.
// ---------------------------------------------------------------------------

const STAGE_TO_LIVE_STAGE: Record<DeliveryStage, LiveSurfaceStage> = {
  placed: "prompted",
  preparing: "inProgress",
  out_for_delivery: "inProgress",
  delivered: "completing",
};

const STAGE_TO_STATE: Record<DeliveryStage, LiveSurfaceState> = {
  placed: "queued",
  preparing: "active",
  out_for_delivery: "active",
  delivered: "completed",
};

const STAGE_TO_PROGRESS: Record<DeliveryStage, number> = {
  placed: 0,
  preparing: 1 / 3,
  out_for_delivery: 2 / 3,
  delivered: 1,
};

const STAGE_TO_HEADLINE: Record<DeliveryStage, string> = {
  placed: "Order received",
  preparing: "In the kitchen",
  out_for_delivery: "Driver on the way",
  delivered: "Delivered",
};

export function stageToLiveSurfaceStage(stage: DeliveryStage): LiveSurfaceStage {
  return STAGE_TO_LIVE_STAGE[stage];
}

export function stageToState(stage: DeliveryStage): LiveSurfaceState {
  return STAGE_TO_STATE[stage];
}

export function stageToProgress(stage: DeliveryStage): number {
  return STAGE_TO_PROGRESS[stage];
}

export function stageToHeadline(stage: DeliveryStage): string {
  return STAGE_TO_HEADLINE[stage];
}

function subtitleFor(order: DeliveryOrder): string {
  switch (order.stage) {
    case "placed":
      return `${order.itemCount} ${order.itemCount === 1 ? "item" : "items"} queued`;
    case "preparing":
      return `${order.restaurant} is preparing your order`;
    case "out_for_delivery":
      return order.driverName && order.etaMinutes !== undefined
        ? `${order.driverName} arriving in ${order.etaMinutes} min`
        : order.etaMinutes !== undefined
          ? `Arriving in ${order.etaMinutes} min`
          : "Driver on the way";
    case "delivered":
      return "Enjoy your meal";
  }
}

function snapshotId(order: DeliveryOrder): string {
  // Stable per (orderId, updatedAt) so the same logical state never
  // re-emits a fresh id. The `@<updatedAt>` suffix satisfies MS024's
  // "stable, idempotent snapshot identifier" requirement.
  return `${order.id}@${order.updatedAt}`;
}

function surfaceId(order: DeliveryOrder): string {
  // One surface per order. Maps to the App Group key
  // `surface.snapshot.delivery-<orderId>` for the widget / control /
  // accessory / standby families.
  return `delivery-${order.id}`;
}

function shortEta(order: DeliveryOrder): string {
  if (order.stage === "delivered") return "Done";
  if (order.etaMinutes === undefined) return "soon";
  return `${order.etaMinutes}m`;
}

// ---------------------------------------------------------------------------
// Per-kind projection. Each branch builds a snapshot with the right slice
// populated for that kind, then runs the result through assertSnapshot so
// the wire boundary is enforced inside the projection itself. This is the
// pattern production code should copy: never hand a producer-built object
// to the adapter without parsing first.
// ---------------------------------------------------------------------------

function toLiveActivity(order: DeliveryOrder): LiveSurfaceSnapshotLiveActivity {
  const subtitle = subtitleFor(order);
  return {
    schemaVersion: "5",
    id: snapshotId(order),
    surfaceId: surfaceId(order),
    kind: "liveActivity",
    updatedAt: order.updatedAt,
    state: stageToState(order.stage),
    liveActivity: {
      title: `${order.restaurant} order`,
      body: subtitle,
      progress: stageToProgress(order.stage),
      deepLink: order.deepLink,
      modeLabel: stageToHeadline(order.stage),
      contextLabel: shortEta(order),
      statusLine: `${stageToHeadline(order.stage)} — ${subtitle}`,
      stage: stageToLiveSurfaceStage(order.stage),
      estimatedSeconds:
        order.etaMinutes !== undefined ? order.etaMinutes * 60 : 0,
      morePartsCount: 0,
      ...(order.stage === "out_for_delivery"
        ? { actionLabel: "Track driver" }
        : order.stage === "delivered"
          ? { actionLabel: "Rate order" }
          : {}),
    },
  };
}

function toWidget(order: DeliveryOrder): LiveSurfaceSnapshotWidget {
  return {
    schemaVersion: "5",
    id: snapshotId(order),
    surfaceId: surfaceId(order),
    kind: "widget",
    updatedAt: order.updatedAt,
    state: stageToState(order.stage),
    widget: {
      title: `${order.restaurant} order`,
      body: subtitleFor(order),
      progress: stageToProgress(order.stage),
      deepLink: order.deepLink,
      family: "systemMedium",
      reloadPolicy: "manual",
    },
  };
}

function toControl(order: DeliveryOrder): LiveSurfaceSnapshotControl {
  // The control widget exposes a "Tip on delivery" toggle. The control
  // value rides on the same surface so a tap in Control Center round-
  // trips through the App Group container and back into the host. The
  // example seeds it to false; production code reads the value from
  // wherever the user's tip preference lives.
  return {
    schemaVersion: "5",
    id: snapshotId(order),
    surfaceId: surfaceId(order),
    kind: "control",
    updatedAt: order.updatedAt,
    state: stageToState(order.stage),
    control: {
      label: "Tip on delivery",
      deepLink: order.deepLink,
      controlKind: "toggle",
      state: false,
      intent: "ToggleDeliveryTipIntent",
    },
  };
}

function toNotification(order: DeliveryOrder): LiveSurfaceSnapshotNotification {
  const title =
    order.stage === "delivered"
      ? "Delivered"
      : order.stage === "out_for_delivery"
        ? "Out for delivery"
        : order.stage === "preparing"
          ? "Order in the kitchen"
          : "Order received";
  const body =
    order.stage === "delivered"
      ? `${order.restaurant} — enjoy your meal`
      : order.etaMinutes !== undefined
        ? `${order.restaurant} — arriving in ${order.etaMinutes} min`
        : `${order.restaurant} — ${subtitleFor(order)}`;
  return {
    schemaVersion: "5",
    id: snapshotId(order),
    surfaceId: surfaceId(order),
    kind: "notification",
    updatedAt: order.updatedAt,
    state: stageToState(order.stage),
    notification: {
      title,
      body,
      deepLink: order.deepLink,
      // `surface-update` is the zero-action category every project ships
      // by default. See packages/surface-contracts/src/notificationCategories.ts.
      category: "surface-update",
      ...(order.stage === "out_for_delivery" || order.stage === "delivered"
        ? { interruptionLevel: "timeSensitive" as const }
        : {}),
    },
  };
}

function toLockAccessory(
  order: DeliveryOrder,
): LiveSurfaceSnapshotLockAccessory {
  return {
    schemaVersion: "5",
    id: snapshotId(order),
    surfaceId: surfaceId(order),
    kind: "lockAccessory",
    updatedAt: order.updatedAt,
    state: stageToState(order.stage),
    lockAccessory: {
      title: `${order.restaurant} order`,
      deepLink: order.deepLink,
      family: "accessoryCircular",
      gaugeValue: stageToProgress(order.stage),
      shortText: shortEta(order),
    },
  };
}

function toStandby(order: DeliveryOrder): LiveSurfaceSnapshotStandby {
  return {
    schemaVersion: "5",
    id: snapshotId(order),
    surfaceId: surfaceId(order),
    kind: "standby",
    updatedAt: order.updatedAt,
    state: stageToState(order.stage),
    standby: {
      title: `${order.restaurant} order`,
      body: subtitleFor(order),
      progress: stageToProgress(order.stage),
      deepLink: order.deepLink,
      presentation: "card",
      tint: "default",
    },
  };
}

/**
 * Project a delivery order onto the snapshot shape for any given
 * surface kind. The output is parsed against the contract before
 * being returned — a malformed projection throws here, at the
 * producer boundary, rather than reaching the adapter and failing
 * silently on the device.
 */
export function deliveryToSnapshot(
  order: DeliveryOrder,
  kind: LiveSurfaceKind,
): LiveSurfaceSnapshot {
  const snapshot = (() => {
    switch (kind) {
      case "liveActivity":
        return toLiveActivity(order);
      case "widget":
        return toWidget(order);
      case "control":
        return toControl(order);
      case "notification":
        return toNotification(order);
      case "lockAccessory":
        return toLockAccessory(order);
      case "standby":
        return toStandby(order);
    }
  })();
  // assertSnapshot is the wire boundary. Demonstrates the pattern
  // inside the reference itself; consumers reading delivery.ts see
  // the parse happen on every projection, not as an afterthought
  // bolted on the screen.
  return assertSnapshot(snapshot);
}

/**
 * Advance an order to the next stage. Returns a fresh order with
 * `updatedAt` bumped to `now`. Stand-in for a backend webhook in
 * the example screen; production code emits the same shape from a
 * server through @mobile-surfaces/push.
 */
export function mockTickOrder(
  order: DeliveryOrder,
  next: DeliveryStage,
  now: Date = new Date(),
): DeliveryOrder {
  const etaForStage = (): number | undefined => {
    switch (next) {
      case "placed":
        return 25;
      case "preparing":
        return 18;
      case "out_for_delivery":
        return 8;
      case "delivered":
        return undefined;
    }
  };
  return {
    ...order,
    stage: next,
    etaMinutes: etaForStage(),
    updatedAt: now.toISOString(),
    ...(next === "out_for_delivery" && !order.driverName
      ? { driverName: "Alex" }
      : {}),
  };
}

/**
 * Seed for the example screen. A single order in the `placed` state.
 * Production code substitutes whatever the user actually has in flight.
 */
export function initialDeliveryOrder(now: Date = new Date()): DeliveryOrder {
  return {
    id: "order-001",
    restaurant: "Pinecrest Diner",
    itemCount: 3,
    stage: "placed",
    placedAt: now.toISOString(),
    etaMinutes: 25,
    deepLink: "mobilesurfaces://orders/order-001",
    updatedAt: now.toISOString(),
  };
}
