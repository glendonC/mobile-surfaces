import type { LiveSurfaceSnapshot } from "./index";

// Generated from data/surface-fixtures by scripts/generate-surface-fixtures.mjs.
// Edit the JSON fixtures, then run pnpm surface:check.
export const surfaceFixtureSnapshots = {
  "queued": {
    "schemaVersion": "5",
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
    "schemaVersion": "5",
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
    "schemaVersion": "5",
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
    "schemaVersion": "5",
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
    "schemaVersion": "5",
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
    "schemaVersion": "5",
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
    "schemaVersion": "5",
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
    "schemaVersion": "5",
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
    "schemaVersion": "5",
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
  "widgetMinimal": {
    "schemaVersion": "5",
    "kind": "widget",
    "id": "fixture-widget-minimal",
    "surfaceId": "surface-widget-minimal",
    "updatedAt": "2026-05-15T12:02:00.000Z",
    "state": "active",
    "widget": {
      "title": "Widget surface synced",
      "body": "Host renders at the user-chosen size with the default reload policy.",
      "progress": 0.5,
      "deepLink": "mobilesurfaces://surface/surface-widget-minimal"
    }
  },
  "controlToggle": {
    "schemaVersion": "5",
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
  "controlButton": {
    "schemaVersion": "5",
    "kind": "control",
    "id": "fixture-control-button",
    "surfaceId": "surface-control-button",
    "updatedAt": "2026-05-15T12:00:00.000Z",
    "state": "active",
    "control": {
      "label": "Refresh surface",
      "deepLink": "mobilesurfaces://surface/surface-control-button",
      "controlKind": "button",
      "intent": "refreshSurface"
    }
  },
  "lockAccessoryCircular": {
    "schemaVersion": "5",
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
  "lockAccessoryRectangular": {
    "schemaVersion": "5",
    "kind": "lockAccessory",
    "id": "fixture-lock-accessory-rectangular",
    "surfaceId": "surface-lock-accessory-rectangular",
    "updatedAt": "2026-05-15T12:00:30.000Z",
    "state": "active",
    "lockAccessory": {
      "title": "Surface 41% complete",
      "deepLink": "mobilesurfaces://surface/surface-lock-accessory-rectangular",
      "family": "accessoryRectangular",
      "gaugeValue": 0.41,
      "shortText": "41%"
    }
  },
  "lockAccessoryInline": {
    "schemaVersion": "5",
    "kind": "lockAccessory",
    "id": "fixture-lock-accessory-inline",
    "surfaceId": "surface-lock-accessory-inline",
    "updatedAt": "2026-05-15T12:01:00.000Z",
    "state": "active",
    "lockAccessory": {
      "title": "Surface running",
      "deepLink": "mobilesurfaces://surface/surface-lock-accessory-inline",
      "family": "accessoryInline",
      "shortText": "Surface running"
    }
  },
  "standbyCard": {
    "schemaVersion": "5",
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
  "standbyNight": {
    "schemaVersion": "5",
    "kind": "standby",
    "id": "fixture-standby-night",
    "surfaceId": "surface-standby-night",
    "updatedAt": "2026-05-15T12:01:30.000Z",
    "state": "active",
    "standby": {
      "title": "Surface overnight",
      "body": "Red-shifted rendering for ambient low-light viewing.",
      "progress": 0.78,
      "deepLink": "mobilesurfaces://surface/surface-standby-night",
      "presentation": "night",
      "tint": "monochrome"
    }
  },
  "notificationAlert": {
    "schemaVersion": "5",
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
  },
  "notificationCategoryRouted": {
    "schemaVersion": "5",
    "kind": "notification",
    "id": "fixture-notification-category-routed",
    "surfaceId": "surface-notification-category-routed",
    "updatedAt": "2026-05-13T09:15:00.000Z",
    "state": "active",
    "notification": {
      "title": "Order ready for pickup",
      "body": "Tap to open the order. Pickup window closes at 6 PM.",
      "deepLink": "mobilesurfaces://surface/surface-notification-category-routed",
      "category": "surface-update",
      "threadId": "orders-2026-05-13"
    }
  },
  "notificationThreadGrouped": {
    "schemaVersion": "5",
    "kind": "notification",
    "id": "fixture-notification-thread-grouped",
    "surfaceId": "surface-notification-thread-grouped",
    "updatedAt": "2026-05-13T10:42:00.000Z",
    "state": "queued",
    "notification": {
      "title": "Build queued",
      "body": "Your build is waiting for a runner. We will notify you when it starts.",
      "deepLink": "mobilesurfaces://surface/surface-notification-thread-grouped",
      "threadId": "build-9821"
    }
  },
  "notificationTimeSensitive": {
    "schemaVersion": "5",
    "kind": "notification",
    "id": "fixture-notification-time-sensitive",
    "surfaceId": "surface-notification-time-sensitive",
    "updatedAt": "2026-05-13T11:30:00.000Z",
    "state": "attention",
    "notification": {
      "title": "Driver is two minutes away",
      "body": "Please be ready at the curb. We won't be able to wait.",
      "deepLink": "mobilesurfaces://surface/surface-notification-time-sensitive",
      "category": "surface-update",
      "threadId": "delivery-3300",
      "interruptionLevel": "timeSensitive"
    }
  },
  "notificationRelevanceSummary": {
    "schemaVersion": "5",
    "kind": "notification",
    "id": "fixture-notification-relevance-summary",
    "surfaceId": "surface-notification-relevance-summary",
    "updatedAt": "2026-05-13T12:00:00.000Z",
    "state": "active",
    "notification": {
      "title": "Daily digest ready",
      "body": "Five surfaces updated since you last opened the app.",
      "deepLink": "mobilesurfaces://surface/surface-notification-relevance-summary",
      "category": "surface-update",
      "threadId": "digests",
      "relevanceScore": 0.9
    }
  },
  "notificationCompleted": {
    "schemaVersion": "5",
    "kind": "notification",
    "id": "fixture-notification-completed",
    "surfaceId": "surface-notification-completed",
    "updatedAt": "2026-05-13T14:10:00.000Z",
    "state": "completed",
    "notification": {
      "title": "Build #9821 completed",
      "body": "Finished in 4 minutes. Tap to view the artifact.",
      "deepLink": "mobilesurfaces://surface/surface-notification-completed",
      "category": "surface-update",
      "threadId": "build-9821"
    }
  },
  "notificationSubtitle": {
    "schemaVersion": "5",
    "kind": "notification",
    "id": "fixture-notification-subtitle",
    "surfaceId": "surface-notification-subtitle",
    "updatedAt": "2026-05-13T15:25:00.000Z",
    "state": "active",
    "notification": {
      "title": "New comment on your draft",
      "subtitle": "Project Atlas - design review",
      "body": "Sam left a comment on \"Mobile Surfaces architecture review\".",
      "deepLink": "mobilesurfaces://surface/surface-notification-subtitle",
      "category": "surface-update",
      "threadId": "project-atlas"
    }
  },
  "notificationDeepLinkWindow": {
    "schemaVersion": "5",
    "kind": "notification",
    "id": "fixture-notification-deep-link-window",
    "surfaceId": "surface-notification-deep-link-window",
    "updatedAt": "2026-05-13T16:50:00.000Z",
    "state": "active",
    "notification": {
      "title": "Document ready for review",
      "body": "Sam shared \"Q3 plan\" with you. Tap to open in the document scene.",
      "deepLink": "mobilesurfaces://surface/surface-notification-deep-link-window",
      "category": "surface-update",
      "threadId": "shared-docs",
      "targetContentId": "scene.document.q3-plan"
    }
  }
} as const satisfies Record<string, LiveSurfaceSnapshot>;
