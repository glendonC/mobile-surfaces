// APNs payload shapes derived from Mobile Surfaces snapshots. Lives in
// @mobile-surfaces/push because the `aps` envelope is APNs wire format, not
// a contract concern.
//
// Moved from @mobile-surfaces/surface-contracts in 3.0.0. The contract
// package now stops at the snapshot shape; anything that emits an APNs
// envelope (alert payload sidecar, channel-broadcast variants when they
// land) lives next to the SDK that sends it.
//
// Renamed `liveActivityAlertPayloadFromSnapshot` → `toApnsAlertPayload` in
// 5.0.0 for naming consistency with the other `to*` projection helpers in
// `@mobile-surfaces/surface-contracts`. The wire shape did not change; only
// the function name. The input now reads `snapshot.liveActivity.title` /
// `body` / `deepLink` instead of the v3 base fields (`primaryText`,
// `secondaryText`, `deepLink`) that no longer exist on the v4 base.

import { z } from "zod";
import {
  liveSurfaceState,
  type LiveSurfaceSnapshotLiveActivity,
} from "@mobile-surfaces/surface-contracts";

/**
 * Alert-push payload derived from a liveActivity-kind snapshot. The `aps`
 * block is Apple's APNs wire format; the `liveSurface` sidecar carries the
 * snapshot id, surface id, current state, and deep link so the receiving
 * client can correlate the alert back to its originating snapshot.
 *
 * The inner discriminator `kind: "surface_snapshot"` is intentionally left
 * unchanged from the v1 wire shape to avoid breaking on-device parsing in
 * consumer apps that already shipped against v1.
 */
export const liveActivityAlertPayload = z
  .object({
    aps: z.object({
      alert: z.object({
        title: z.string(),
        body: z.string(),
      }),
      sound: z.literal("default").optional(),
    }),
    liveSurface: z.object({
      kind: z.literal("surface_snapshot"),
      snapshotId: z.string(),
      surfaceId: z.string(),
      state: liveSurfaceState,
      deepLink: z.string(),
    }),
  })
  .strict();
export type LiveActivityAlertPayload = z.infer<typeof liveActivityAlertPayload>;

/**
 * Build an alert-payload from a liveActivity-kind snapshot. The argument is
 * typed as the narrowed variant rather than the full union; callers narrow
 * via `snapshot.kind === "liveActivity"` at the call site, matching the
 * rest of the SDK's preference for TS narrowing over runtime kind checks.
 *
 * v5 rename: was `liveActivityAlertPayloadFromSnapshot` in 3.x–4.x.
 */
export function toApnsAlertPayload(
  snapshot: LiveSurfaceSnapshotLiveActivity,
): LiveActivityAlertPayload {
  return {
    aps: {
      alert: {
        title: snapshot.liveActivity.title,
        body: snapshot.liveActivity.body,
      },
      sound: "default",
    },
    liveSurface: {
      kind: "surface_snapshot",
      snapshotId: snapshot.id,
      surfaceId: snapshot.surfaceId,
      state: snapshot.state,
      deepLink: snapshot.liveActivity.deepLink,
    },
  };
}
