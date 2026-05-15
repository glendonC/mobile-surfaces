// Generated from data/scenarios/*.json by scripts/generate-scenarios.mjs.
// Edit the JSON sources and run `pnpm surface:check` (or
// `node --experimental-strip-types scripts/generate-scenarios.mjs`) to
// regenerate. Demo-only: not re-exported from index.ts.

import type {
  LiveSurfaceSnapshotLiveActivity,
  LiveSurfaceSnapshotWidget,
  LiveSurfaceSnapshotControl,
  LiveSurfaceSnapshotLockAccessory,
  LiveSurfaceSnapshotStandby,
} from "./schema.ts";

export interface LiveSurfaceScenarioStep {
  readonly id: string;
  readonly label: string;
  readonly snapshots: {
    readonly liveActivity: LiveSurfaceSnapshotLiveActivity;
    readonly widget: LiveSurfaceSnapshotWidget;
    readonly control: LiveSurfaceSnapshotControl;
    readonly lockAccessory: LiveSurfaceSnapshotLockAccessory;
    readonly standby: LiveSurfaceSnapshotStandby;
  };
}

export interface LiveSurfaceScenario {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly steps: ReadonlyArray<LiveSurfaceScenarioStep>;
}

export const surfaceScenarios = {
  "delivery": {
    "id": "delivery",
    "title": "Package delivery",
    "summary": "Track a package from depot to doorstep across all five surfaces.",
    "steps": [
      {
        "id": "queued",
        "label": "1. Queued at depot",
        "snapshots": {
          "liveActivity": {
            "schemaVersion": "4",
            "kind": "liveActivity",
            "id": "scenario-delivery-queued-la",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:00:00.000Z",
            "state": "queued",
            "liveActivity": {
              "title": "Delivery queued",
              "body": "Your order is preparing for pickup at the depot.",
              "progress": 0,
              "deepLink": "mobilesurfaces://scenario/delivery",
              "modeLabel": "queued",
              "contextLabel": "depot",
              "statusLine": "queued - ETA 45 min",
              "actionLabel": "Track",
              "stage": "prompted",
              "estimatedSeconds": 2700,
              "morePartsCount": 0
            }
          },
          "widget": {
            "schemaVersion": "4",
            "kind": "widget",
            "id": "scenario-delivery-queued-w",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:00:00.000Z",
            "state": "queued",
            "widget": {
              "title": "Delivery queued",
              "body": "Preparing at depot.",
              "progress": 0,
              "deepLink": "mobilesurfaces://scenario/delivery",
              "family": "systemMedium",
              "reloadPolicy": "manual"
            }
          },
          "control": {
            "schemaVersion": "4",
            "kind": "control",
            "id": "scenario-delivery-queued-c",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:00:00.000Z",
            "state": "queued",
            "control": {
              "label": "Notify on arrival",
              "deepLink": "mobilesurfaces://scenario/delivery",
              "controlKind": "toggle",
              "state": true,
              "intent": "toggleDeliveryAlert"
            }
          },
          "lockAccessory": {
            "schemaVersion": "4",
            "kind": "lockAccessory",
            "id": "scenario-delivery-queued-la-acc",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:00:00.000Z",
            "state": "queued",
            "lockAccessory": {
              "title": "Queued",
              "deepLink": "mobilesurfaces://scenario/delivery",
              "family": "accessoryCircular",
              "gaugeValue": 0,
              "shortText": "0%"
            }
          },
          "standby": {
            "schemaVersion": "4",
            "kind": "standby",
            "id": "scenario-delivery-queued-sb",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:00:00.000Z",
            "state": "queued",
            "standby": {
              "title": "Delivery queued",
              "body": "Preparing at depot.",
              "progress": 0,
              "deepLink": "mobilesurfaces://scenario/delivery",
              "presentation": "card",
              "tint": "default"
            }
          }
        }
      },
      {
        "id": "out-for-delivery",
        "label": "2. Out for delivery",
        "snapshots": {
          "liveActivity": {
            "schemaVersion": "4",
            "kind": "liveActivity",
            "id": "scenario-delivery-out-la",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:25:00.000Z",
            "state": "active",
            "liveActivity": {
              "title": "Out for delivery",
              "body": "Driver is 8 stops away.",
              "progress": 0.55,
              "deepLink": "mobilesurfaces://scenario/delivery",
              "modeLabel": "in transit",
              "contextLabel": "8 stops away",
              "statusLine": "active - ETA 20 min",
              "actionLabel": "Track",
              "stage": "inProgress",
              "estimatedSeconds": 1200,
              "morePartsCount": 0
            }
          },
          "widget": {
            "schemaVersion": "4",
            "kind": "widget",
            "id": "scenario-delivery-out-w",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:25:00.000Z",
            "state": "active",
            "widget": {
              "title": "Out for delivery",
              "body": "8 stops away. ETA 20 min.",
              "progress": 0.55,
              "deepLink": "mobilesurfaces://scenario/delivery",
              "family": "systemMedium",
              "reloadPolicy": "manual"
            }
          },
          "control": {
            "schemaVersion": "4",
            "kind": "control",
            "id": "scenario-delivery-out-c",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:25:00.000Z",
            "state": "active",
            "control": {
              "label": "Notify on arrival",
              "deepLink": "mobilesurfaces://scenario/delivery",
              "controlKind": "toggle",
              "state": true,
              "intent": "toggleDeliveryAlert"
            }
          },
          "lockAccessory": {
            "schemaVersion": "4",
            "kind": "lockAccessory",
            "id": "scenario-delivery-out-la-acc",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:25:00.000Z",
            "state": "active",
            "lockAccessory": {
              "title": "In transit",
              "deepLink": "mobilesurfaces://scenario/delivery",
              "family": "accessoryCircular",
              "gaugeValue": 0.55,
              "shortText": "55%"
            }
          },
          "standby": {
            "schemaVersion": "4",
            "kind": "standby",
            "id": "scenario-delivery-out-sb",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:25:00.000Z",
            "state": "active",
            "standby": {
              "title": "Out for delivery",
              "body": "8 stops away.",
              "progress": 0.55,
              "deepLink": "mobilesurfaces://scenario/delivery",
              "presentation": "card",
              "tint": "default"
            }
          }
        }
      },
      {
        "id": "arrived",
        "label": "3. Arrived",
        "snapshots": {
          "liveActivity": {
            "schemaVersion": "4",
            "kind": "liveActivity",
            "id": "scenario-delivery-arrived-la",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:45:00.000Z",
            "state": "completed",
            "liveActivity": {
              "title": "Delivered",
              "body": "Left at front door.",
              "progress": 1,
              "deepLink": "mobilesurfaces://scenario/delivery",
              "modeLabel": "delivered",
              "contextLabel": "at doorstep",
              "statusLine": "completed - left at front door",
              "stage": "completing",
              "estimatedSeconds": 0,
              "morePartsCount": 0
            }
          },
          "widget": {
            "schemaVersion": "4",
            "kind": "widget",
            "id": "scenario-delivery-arrived-w",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:45:00.000Z",
            "state": "completed",
            "widget": {
              "title": "Delivered",
              "body": "Left at front door.",
              "progress": 1,
              "deepLink": "mobilesurfaces://scenario/delivery",
              "family": "systemMedium",
              "reloadPolicy": "manual"
            }
          },
          "control": {
            "schemaVersion": "4",
            "kind": "control",
            "id": "scenario-delivery-arrived-c",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:45:00.000Z",
            "state": "completed",
            "control": {
              "label": "Notify on arrival",
              "deepLink": "mobilesurfaces://scenario/delivery",
              "controlKind": "toggle",
              "state": false,
              "intent": "toggleDeliveryAlert"
            }
          },
          "lockAccessory": {
            "schemaVersion": "4",
            "kind": "lockAccessory",
            "id": "scenario-delivery-arrived-la-acc",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:45:00.000Z",
            "state": "completed",
            "lockAccessory": {
              "title": "Delivered",
              "deepLink": "mobilesurfaces://scenario/delivery",
              "family": "accessoryCircular",
              "gaugeValue": 1,
              "shortText": "100%"
            }
          },
          "standby": {
            "schemaVersion": "4",
            "kind": "standby",
            "id": "scenario-delivery-arrived-sb",
            "surfaceId": "scenario-delivery",
            "updatedAt": "2026-05-15T09:45:00.000Z",
            "state": "completed",
            "standby": {
              "title": "Delivered",
              "body": "Left at front door.",
              "progress": 1,
              "deepLink": "mobilesurfaces://scenario/delivery",
              "presentation": "card",
              "tint": "default"
            }
          }
        }
      }
    ]
  },
  "build": {
    "id": "build",
    "title": "CI build pipeline",
    "summary": "Watch a CI run move from running through a failing-tests attention state into green completion across every surface.",
    "steps": [
      {
        "id": "running",
        "label": "1. Tests running",
        "snapshots": {
          "liveActivity": {
            "schemaVersion": "4",
            "kind": "liveActivity",
            "id": "scenario-build-running-la",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:00:00.000Z",
            "state": "active",
            "liveActivity": {
              "title": "CI: build #2391",
              "body": "Running 1,204 tests on Linux + macOS.",
              "progress": 0.4,
              "deepLink": "mobilesurfaces://scenario/build",
              "modeLabel": "running",
              "contextLabel": "486 / 1204",
              "statusLine": "active - tests in progress",
              "actionLabel": "Open run",
              "stage": "inProgress",
              "estimatedSeconds": 320,
              "morePartsCount": 2
            }
          },
          "widget": {
            "schemaVersion": "4",
            "kind": "widget",
            "id": "scenario-build-running-w",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:00:00.000Z",
            "state": "active",
            "widget": {
              "title": "CI build #2391",
              "body": "486 / 1204 tests.",
              "progress": 0.4,
              "deepLink": "mobilesurfaces://scenario/build",
              "family": "systemMedium",
              "reloadPolicy": "manual"
            }
          },
          "control": {
            "schemaVersion": "4",
            "kind": "control",
            "id": "scenario-build-running-c",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:00:00.000Z",
            "state": "active",
            "control": {
              "label": "Pause CI worker",
              "deepLink": "mobilesurfaces://scenario/build",
              "controlKind": "toggle",
              "state": false,
              "intent": "toggleCiPause"
            }
          },
          "lockAccessory": {
            "schemaVersion": "4",
            "kind": "lockAccessory",
            "id": "scenario-build-running-la-acc",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:00:00.000Z",
            "state": "active",
            "lockAccessory": {
              "title": "Running",
              "deepLink": "mobilesurfaces://scenario/build",
              "family": "accessoryCircular",
              "gaugeValue": 0.4,
              "shortText": "40%"
            }
          },
          "standby": {
            "schemaVersion": "4",
            "kind": "standby",
            "id": "scenario-build-running-sb",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:00:00.000Z",
            "state": "active",
            "standby": {
              "title": "CI build #2391",
              "body": "486 / 1204 tests.",
              "progress": 0.4,
              "deepLink": "mobilesurfaces://scenario/build",
              "presentation": "card",
              "tint": "default"
            }
          }
        }
      },
      {
        "id": "failing",
        "label": "2. Tests failing",
        "snapshots": {
          "liveActivity": {
            "schemaVersion": "4",
            "kind": "liveActivity",
            "id": "scenario-build-failing-la",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:04:00.000Z",
            "state": "attention",
            "liveActivity": {
              "title": "CI: 3 failing",
              "body": "3 integration tests broke on the macOS row.",
              "progress": 0.62,
              "deepLink": "mobilesurfaces://scenario/build",
              "modeLabel": "attention",
              "contextLabel": "3 failing",
              "statusLine": "attention - rerun or open logs",
              "actionLabel": "View failures",
              "stage": "inProgress",
              "estimatedSeconds": 180,
              "morePartsCount": 3
            }
          },
          "widget": {
            "schemaVersion": "4",
            "kind": "widget",
            "id": "scenario-build-failing-w",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:04:00.000Z",
            "state": "attention",
            "widget": {
              "title": "CI: 3 failing",
              "body": "macOS integration row.",
              "progress": 0.62,
              "deepLink": "mobilesurfaces://scenario/build",
              "family": "systemMedium",
              "reloadPolicy": "manual"
            }
          },
          "control": {
            "schemaVersion": "4",
            "kind": "control",
            "id": "scenario-build-failing-c",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:04:00.000Z",
            "state": "attention",
            "control": {
              "label": "Pause CI worker",
              "deepLink": "mobilesurfaces://scenario/build",
              "controlKind": "toggle",
              "state": false,
              "intent": "toggleCiPause"
            }
          },
          "lockAccessory": {
            "schemaVersion": "4",
            "kind": "lockAccessory",
            "id": "scenario-build-failing-la-acc",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:04:00.000Z",
            "state": "attention",
            "lockAccessory": {
              "title": "3 failing",
              "deepLink": "mobilesurfaces://scenario/build",
              "family": "accessoryCircular",
              "gaugeValue": 0.62,
              "shortText": "fail"
            }
          },
          "standby": {
            "schemaVersion": "4",
            "kind": "standby",
            "id": "scenario-build-failing-sb",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:04:00.000Z",
            "state": "attention",
            "standby": {
              "title": "CI attention",
              "body": "3 failing on macOS row.",
              "progress": 0.62,
              "deepLink": "mobilesurfaces://scenario/build",
              "presentation": "card",
              "tint": "default"
            }
          }
        }
      },
      {
        "id": "green",
        "label": "3. All green",
        "snapshots": {
          "liveActivity": {
            "schemaVersion": "4",
            "kind": "liveActivity",
            "id": "scenario-build-green-la",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:09:00.000Z",
            "state": "completed",
            "liveActivity": {
              "title": "CI: passed",
              "body": "1204 / 1204 tests passed after a rerun.",
              "progress": 1,
              "deepLink": "mobilesurfaces://scenario/build",
              "modeLabel": "passed",
              "contextLabel": "1204 / 1204",
              "statusLine": "completed - all green",
              "stage": "completing",
              "estimatedSeconds": 0,
              "morePartsCount": 0
            }
          },
          "widget": {
            "schemaVersion": "4",
            "kind": "widget",
            "id": "scenario-build-green-w",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:09:00.000Z",
            "state": "completed",
            "widget": {
              "title": "CI passed",
              "body": "1204 / 1204 tests.",
              "progress": 1,
              "deepLink": "mobilesurfaces://scenario/build",
              "family": "systemMedium",
              "reloadPolicy": "manual"
            }
          },
          "control": {
            "schemaVersion": "4",
            "kind": "control",
            "id": "scenario-build-green-c",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:09:00.000Z",
            "state": "completed",
            "control": {
              "label": "Pause CI worker",
              "deepLink": "mobilesurfaces://scenario/build",
              "controlKind": "toggle",
              "state": false,
              "intent": "toggleCiPause"
            }
          },
          "lockAccessory": {
            "schemaVersion": "4",
            "kind": "lockAccessory",
            "id": "scenario-build-green-la-acc",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:09:00.000Z",
            "state": "completed",
            "lockAccessory": {
              "title": "Passed",
              "deepLink": "mobilesurfaces://scenario/build",
              "family": "accessoryCircular",
              "gaugeValue": 1,
              "shortText": "100%"
            }
          },
          "standby": {
            "schemaVersion": "4",
            "kind": "standby",
            "id": "scenario-build-green-sb",
            "surfaceId": "scenario-build",
            "updatedAt": "2026-05-15T11:09:00.000Z",
            "state": "completed",
            "standby": {
              "title": "CI passed",
              "body": "1204 / 1204 tests.",
              "progress": 1,
              "deepLink": "mobilesurfaces://scenario/build",
              "presentation": "card",
              "tint": "default"
            }
          }
        }
      }
    ]
  },
} as const satisfies Record<string, LiveSurfaceScenario>;

export type LiveSurfaceScenarioId = keyof typeof surfaceScenarios;
