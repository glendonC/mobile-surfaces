import type { LiveSurfaceSnapshot } from "./index";

// Generated from data/surface-fixtures by scripts/generate-surface-fixtures.mjs.
// Edit the JSON fixtures, then run pnpm surface:check.
export const surfaceFixtureSnapshots = {
  "queued": {
    "schemaVersion": "2",
    "kind": "liveActivity",
    "id": "fixture-queued",
    "surfaceId": "surface-queued",
    "updatedAt": "2026-05-12T18:30:00.000Z",
    "state": "queued",
    "modeLabel": "queued",
    "contextLabel": "starter",
    "statusLine": "queued · ready to start",
    "primaryText": "Surface queued",
    "secondaryText": "Use this as the initial state before a Live Activity starts changing.",
    "actionLabel": "Open surface",
    "progress": 0,
    "deepLink": "mobilesurfaces://surface/surface-queued",
    "liveActivity": {
      "stage": "prompted",
      "estimatedSeconds": 900,
      "morePartsCount": 0
    }
  },
  "attention": {
    "schemaVersion": "2",
    "kind": "liveActivity",
    "id": "fixture-attention",
    "surfaceId": "surface-attention",
    "updatedAt": "2026-05-12T18:30:30.000Z",
    "state": "attention",
    "modeLabel": "attention",
    "contextLabel": "urgent",
    "statusLine": "attention · user-visible update",
    "primaryText": "Attention needed",
    "secondaryText": "Use this state for alert-worthy pushes or prominent ActivityKit updates.",
    "actionLabel": "Review",
    "progress": 0.15,
    "deepLink": "mobilesurfaces://surface/surface-attention",
    "liveActivity": {
      "stage": "prompted",
      "estimatedSeconds": 120,
      "morePartsCount": 1
    }
  },
  "activeProgress": {
    "schemaVersion": "2",
    "kind": "liveActivity",
    "id": "fixture-active-progress",
    "surfaceId": "surface-active-progress",
    "updatedAt": "2026-05-12T18:31:00.000Z",
    "state": "active",
    "modeLabel": "active",
    "contextLabel": "progress",
    "statusLine": "active · 50%",
    "primaryText": "Surface in progress",
    "secondaryText": "The same snapshot feeds the app view and ActivityKit content state.",
    "actionLabel": "View progress",
    "progress": 0.5,
    "deepLink": "mobilesurfaces://surface/surface-active-progress",
    "liveActivity": {
      "stage": "inProgress",
      "estimatedSeconds": 360,
      "morePartsCount": 0
    }
  },
  "activeCountdown": {
    "schemaVersion": "2",
    "kind": "liveActivity",
    "id": "fixture-active-countdown",
    "surfaceId": "surface-active-countdown",
    "updatedAt": "2026-05-12T18:31:30.000Z",
    "state": "active",
    "modeLabel": "countdown",
    "contextLabel": "timer",
    "statusLine": "active · 30s remaining",
    "primaryText": "Countdown in progress",
    "secondaryText": "Preview time-sensitive progress changes without connecting a backend.",
    "actionLabel": "Continue",
    "progress": 0.35,
    "deepLink": "mobilesurfaces://surface/surface-active-countdown",
    "liveActivity": {
      "stage": "inProgress",
      "estimatedSeconds": 30,
      "morePartsCount": 0
    }
  },
  "paused": {
    "schemaVersion": "2",
    "kind": "liveActivity",
    "id": "fixture-paused",
    "surfaceId": "surface-paused",
    "updatedAt": "2026-05-12T18:32:00.000Z",
    "state": "paused",
    "modeLabel": "paused",
    "contextLabel": "waiting",
    "statusLine": "paused · no update needed",
    "primaryText": "Surface paused",
    "secondaryText": "A paused surface can stay visible without noisy updates.",
    "actionLabel": "Open surface",
    "progress": 0.4,
    "deepLink": "mobilesurfaces://surface/surface-paused",
    "liveActivity": {
      "stage": "prompted",
      "estimatedSeconds": 1800,
      "morePartsCount": 0
    }
  },
  "badTiming": {
    "schemaVersion": "2",
    "kind": "liveActivity",
    "id": "fixture-bad-timing",
    "surfaceId": "surface-none-bad-timing",
    "updatedAt": "2026-05-12T18:32:30.000Z",
    "state": "bad_timing",
    "modeLabel": "bad timing",
    "contextLabel": "suppressed",
    "statusLine": "suppressed · not now",
    "primaryText": "Surface suppressed",
    "secondaryText": "Use this state when the app decides not to interrupt the user.",
    "actionLabel": "Snooze",
    "progress": 0,
    "deepLink": "mobilesurfaces://today",
    "liveActivity": {
      "stage": "completing",
      "estimatedSeconds": 0,
      "morePartsCount": 0
    }
  },
  "completed": {
    "schemaVersion": "2",
    "kind": "liveActivity",
    "id": "fixture-completed",
    "surfaceId": "surface-completed",
    "updatedAt": "2026-05-12T18:33:00.000Z",
    "state": "completed",
    "modeLabel": "completed",
    "contextLabel": "finished",
    "statusLine": "completed · ready to end",
    "primaryText": "Surface completed",
    "secondaryText": "End the activity locally or with an ActivityKit push.",
    "actionLabel": "Done",
    "progress": 1,
    "deepLink": "mobilesurfaces://surface/surface-completed",
    "liveActivity": {
      "stage": "completing",
      "estimatedSeconds": 0,
      "morePartsCount": 0
    }
  },
  "activeDetails": {
    "schemaVersion": "2",
    "kind": "liveActivity",
    "id": "fixture-active-details",
    "surfaceId": "surface-active-details",
    "updatedAt": "2026-05-12T18:33:30.000Z",
    "state": "active",
    "modeLabel": "details",
    "contextLabel": "expanded",
    "statusLine": "active · more detail available",
    "primaryText": "Surface has more detail",
    "secondaryText": "Use morePartsCount when a surface has additional detail in the app.",
    "actionLabel": "View details",
    "progress": 0.75,
    "deepLink": "mobilesurfaces://surface/surface-active-details",
    "liveActivity": {
      "stage": "inProgress",
      "estimatedSeconds": 420,
      "morePartsCount": 2
    }
  },
  "widgetDashboard": {
    "schemaVersion": "2",
    "kind": "widget",
    "id": "fixture-widget-dashboard",
    "surfaceId": "surface-widget-dashboard",
    "updatedAt": "2026-05-12T18:34:00.000Z",
    "state": "active",
    "modeLabel": "widget",
    "contextLabel": "home",
    "statusLine": "widget · shared state",
    "primaryText": "Widget surface synced",
    "secondaryText": "This snapshot is written through the App Group and rendered by the home-screen widget.",
    "actionLabel": "Open surface",
    "progress": 0.62,
    "deepLink": "mobilesurfaces://surface/surface-widget-dashboard",
    "widget": {
      "family": "systemMedium",
      "reloadPolicy": "manual"
    }
  },
  "controlToggle": {
    "schemaVersion": "2",
    "kind": "control",
    "id": "fixture-control-toggle",
    "surfaceId": "surface-control-toggle",
    "updatedAt": "2026-05-12T18:34:30.000Z",
    "state": "active",
    "modeLabel": "control",
    "contextLabel": "toggle",
    "statusLine": "control · ready",
    "primaryText": "Control surface",
    "secondaryText": "This snapshot backs the iOS 18 control widget toggle.",
    "actionLabel": "Surface toggle",
    "progress": 1,
    "deepLink": "mobilesurfaces://surface/surface-control-toggle",
    "control": {
      "kind": "toggle",
      "state": false,
      "intent": "toggleSurface"
    }
  },
  "lockAccessoryCircular": {
    "schemaVersion": "2",
    "kind": "lockAccessory",
    "id": "fixture-lock-accessory-circular",
    "surfaceId": "surface-lock-accessory-circular",
    "updatedAt": "2026-05-12T18:35:00.000Z",
    "state": "active",
    "modeLabel": "lock accessory",
    "contextLabel": "ring",
    "statusLine": "lock screen · gauge",
    "primaryText": "Surface 62%",
    "secondaryText": "Lock screen accessory mirrors the active surface progress.",
    "actionLabel": "Open surface",
    "progress": 0.62,
    "deepLink": "mobilesurfaces://surface/surface-lock-accessory-circular",
    "lockAccessory": {
      "family": "accessoryCircular",
      "gaugeValue": 0.62,
      "shortText": "62%"
    }
  },
  "standbyCard": {
    "schemaVersion": "2",
    "kind": "standby",
    "id": "fixture-standby-card",
    "surfaceId": "surface-standby-card",
    "updatedAt": "2026-05-12T18:35:30.000Z",
    "state": "active",
    "modeLabel": "standby",
    "contextLabel": "charging",
    "statusLine": "standby · 45% complete",
    "primaryText": "Surface in StandBy",
    "secondaryText": "Visible while the device is charging on its side.",
    "actionLabel": "Open surface",
    "progress": 0.45,
    "deepLink": "mobilesurfaces://surface/surface-standby-card",
    "standby": {
      "presentation": "card",
      "tint": "default"
    }
  }
} as const satisfies Record<string, LiveSurfaceSnapshot>;
