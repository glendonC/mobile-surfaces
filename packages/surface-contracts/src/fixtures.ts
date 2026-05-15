import type { LiveSurfaceSnapshot } from "./index";

// Generated from data/surface-fixtures by scripts/generate-surface-fixtures.mjs.
// Edit the JSON fixtures, then run pnpm surface:check.
export const surfaceFixtureSnapshots = {
  "queued": {
    "schemaVersion": "4",
    "kind": "liveActivity",
    "id": "fixture-queued",
    "surfaceId": "surface-queued",
    "updatedAt": "2026-05-12T18:30:00.000Z",
    "state": "queued",
    "liveActivity": {
      "title": "Surface queued",
      "body": "Use this as the initial state before a Live Activity starts changing.",
      "progress": 0,
      "deepLink": "mobilesurfaces://surface/surface-queued",
      "modeLabel": "queued",
      "contextLabel": "starter",
      "statusLine": "queued · ready to start",
      "actionLabel": "Open surface",
      "stage": "prompted",
      "estimatedSeconds": 900,
      "morePartsCount": 0
    }
  },
  "attention": {
    "schemaVersion": "4",
    "kind": "liveActivity",
    "id": "fixture-attention",
    "surfaceId": "surface-attention",
    "updatedAt": "2026-05-12T18:30:30.000Z",
    "state": "attention",
    "liveActivity": {
      "title": "Attention needed",
      "body": "Use this state for alert-worthy pushes or prominent ActivityKit updates.",
      "progress": 0.15,
      "deepLink": "mobilesurfaces://surface/surface-attention",
      "modeLabel": "attention",
      "contextLabel": "urgent",
      "statusLine": "attention · user-visible update",
      "actionLabel": "Review",
      "stage": "prompted",
      "estimatedSeconds": 120,
      "morePartsCount": 1
    }
  },
  "activeProgress": {
    "schemaVersion": "4",
    "kind": "liveActivity",
    "id": "fixture-active-progress",
    "surfaceId": "surface-active-progress",
    "updatedAt": "2026-05-12T18:31:00.000Z",
    "state": "active",
    "liveActivity": {
      "title": "Surface in progress",
      "body": "The same snapshot feeds the app view and ActivityKit content state.",
      "progress": 0.5,
      "deepLink": "mobilesurfaces://surface/surface-active-progress",
      "modeLabel": "active",
      "contextLabel": "progress",
      "statusLine": "active · 50%",
      "actionLabel": "View progress",
      "stage": "inProgress",
      "estimatedSeconds": 360,
      "morePartsCount": 0
    }
  },
  "activeCountdown": {
    "schemaVersion": "4",
    "kind": "liveActivity",
    "id": "fixture-active-countdown",
    "surfaceId": "surface-active-countdown",
    "updatedAt": "2026-05-12T18:31:30.000Z",
    "state": "active",
    "liveActivity": {
      "title": "Countdown in progress",
      "body": "Preview time-sensitive progress changes without connecting a backend.",
      "progress": 0.35,
      "deepLink": "mobilesurfaces://surface/surface-active-countdown",
      "modeLabel": "countdown",
      "contextLabel": "timer",
      "statusLine": "active · 30s remaining",
      "actionLabel": "Continue",
      "stage": "inProgress",
      "estimatedSeconds": 30,
      "morePartsCount": 0
    }
  },
  "paused": {
    "schemaVersion": "4",
    "kind": "liveActivity",
    "id": "fixture-paused",
    "surfaceId": "surface-paused",
    "updatedAt": "2026-05-12T18:32:00.000Z",
    "state": "paused",
    "liveActivity": {
      "title": "Surface paused",
      "body": "A paused surface can stay visible without noisy updates.",
      "progress": 0.4,
      "deepLink": "mobilesurfaces://surface/surface-paused",
      "modeLabel": "paused",
      "contextLabel": "waiting",
      "statusLine": "paused · no update needed",
      "actionLabel": "Open surface",
      "stage": "prompted",
      "estimatedSeconds": 1800,
      "morePartsCount": 0
    }
  },
  "badTiming": {
    "schemaVersion": "4",
    "kind": "liveActivity",
    "id": "fixture-bad-timing",
    "surfaceId": "surface-none-bad-timing",
    "updatedAt": "2026-05-12T18:32:30.000Z",
    "state": "bad_timing",
    "liveActivity": {
      "title": "Surface suppressed",
      "body": "Use this state when the app decides not to interrupt the user.",
      "progress": 0,
      "deepLink": "mobilesurfaces://today",
      "modeLabel": "bad timing",
      "contextLabel": "suppressed",
      "statusLine": "suppressed · not now",
      "actionLabel": "Snooze",
      "stage": "completing",
      "estimatedSeconds": 0,
      "morePartsCount": 0
    }
  },
  "completed": {
    "schemaVersion": "4",
    "kind": "liveActivity",
    "id": "fixture-completed",
    "surfaceId": "surface-completed",
    "updatedAt": "2026-05-12T18:33:00.000Z",
    "state": "completed",
    "liveActivity": {
      "title": "Surface completed",
      "body": "End the activity locally or with an ActivityKit push.",
      "progress": 1,
      "deepLink": "mobilesurfaces://surface/surface-completed",
      "modeLabel": "completed",
      "contextLabel": "finished",
      "statusLine": "completed · ready to end",
      "actionLabel": "Done",
      "stage": "completing",
      "estimatedSeconds": 0,
      "morePartsCount": 0
    }
  },
  "activeDetails": {
    "schemaVersion": "4",
    "kind": "liveActivity",
    "id": "fixture-active-details",
    "surfaceId": "surface-active-details",
    "updatedAt": "2026-05-12T18:33:30.000Z",
    "state": "active",
    "liveActivity": {
      "title": "Surface has more detail",
      "body": "Use morePartsCount when a surface has additional detail in the app.",
      "progress": 0.75,
      "deepLink": "mobilesurfaces://surface/surface-active-details",
      "modeLabel": "details",
      "contextLabel": "expanded",
      "statusLine": "active · more detail available",
      "actionLabel": "View details",
      "stage": "inProgress",
      "estimatedSeconds": 420,
      "morePartsCount": 2
    }
  },
  "widgetDashboard": {
    "schemaVersion": "4",
    "kind": "widget",
    "id": "fixture-widget-dashboard",
    "surfaceId": "surface-widget-dashboard",
    "updatedAt": "2026-05-12T18:34:00.000Z",
    "state": "active",
    "widget": {
      "title": "Widget surface synced",
      "body": "This snapshot is written through the App Group and rendered by the home-screen widget.",
      "progress": 0.62,
      "deepLink": "mobilesurfaces://surface/surface-widget-dashboard",
      "family": "systemMedium",
      "reloadPolicy": "manual"
    }
  },
  "controlToggle": {
    "schemaVersion": "4",
    "kind": "control",
    "id": "fixture-control-toggle",
    "surfaceId": "surface-control-toggle",
    "updatedAt": "2026-05-12T18:34:30.000Z",
    "state": "active",
    "control": {
      "label": "Surface toggle",
      "deepLink": "mobilesurfaces://surface/surface-control-toggle",
      "controlKind": "toggle",
      "state": false,
      "intent": "toggleSurface"
    }
  },
  "lockAccessoryCircular": {
    "schemaVersion": "4",
    "kind": "lockAccessory",
    "id": "fixture-lock-accessory-circular",
    "surfaceId": "surface-lock-accessory-circular",
    "updatedAt": "2026-05-12T18:35:00.000Z",
    "state": "active",
    "lockAccessory": {
      "title": "Surface 62%",
      "deepLink": "mobilesurfaces://surface/surface-lock-accessory-circular",
      "family": "accessoryCircular",
      "gaugeValue": 0.62,
      "shortText": "62%"
    }
  },
  "standbyCard": {
    "schemaVersion": "4",
    "kind": "standby",
    "id": "fixture-standby-card",
    "surfaceId": "surface-standby-card",
    "updatedAt": "2026-05-12T18:35:30.000Z",
    "state": "active",
    "standby": {
      "title": "Surface in StandBy",
      "body": "Visible while the device is charging on its side.",
      "progress": 0.45,
      "deepLink": "mobilesurfaces://surface/surface-standby-card",
      "presentation": "card",
      "tint": "default"
    }
  },
  "notificationAlert": {
    "schemaVersion": "4",
    "kind": "notification",
    "id": "fixture-notification-alert",
    "surfaceId": "surface-notification-alert",
    "updatedAt": "2026-05-12T18:36:00.000Z",
    "state": "attention",
    "notification": {
      "title": "Surface needs attention",
      "body": "This snapshot projects to an APNs alert payload through toNotificationContentPayload.",
      "deepLink": "mobilesurfaces://surface/surface-notification-alert",
      "category": "surface-update",
      "threadId": "surface-notification-alert"
    }
  }
} as const satisfies Record<string, LiveSurfaceSnapshot>;
