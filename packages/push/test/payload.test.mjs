// Roundtrip and shape pins for liveActivityAlertPayload. Moved from
// scripts/surface-contracts.test.mjs in 3.0.0 when the alert payload helper
// migrated from @mobile-surfaces/surface-contracts into this package.

import test from "node:test";
import assert from "node:assert/strict";
import { surfaceFixtureSnapshots } from "@mobile-surfaces/surface-contracts";
import {
  liveActivityAlertPayload,
  liveActivityAlertPayloadFromSnapshot,
} from "../src/payloads.ts";

const queued = surfaceFixtureSnapshots.queued;

// liveActivityAlertPayloadFromSnapshot constructs its return shape by hand.
// Round-trip through the liveActivityAlertPayload Zod schema so the two
// cannot drift: any field rename or type change in the schema breaks this
// assertion before the helper ships.
test("liveActivityAlertPayloadFromSnapshot output parses as liveActivityAlertPayload", () => {
  assert.equal(queued.kind, "liveActivity");
  const payload = liveActivityAlertPayloadFromSnapshot(queued);
  const parsed = liveActivityAlertPayload.parse(payload);
  assert.deepEqual(parsed, payload);
});

test("liveActivityAlertPayloadFromSnapshot pulls fields from the snapshot", () => {
  const payload = liveActivityAlertPayloadFromSnapshot(queued);
  assert.equal(payload.aps.alert.title, queued.primaryText);
  assert.equal(payload.aps.alert.body, queued.secondaryText);
  assert.equal(payload.aps.sound, "default");
  assert.equal(payload.liveSurface.kind, "surface_snapshot");
  assert.equal(payload.liveSurface.snapshotId, queued.id);
  assert.equal(payload.liveSurface.surfaceId, queued.surfaceId);
  assert.equal(payload.liveSurface.state, queued.state);
  assert.equal(payload.liveSurface.deepLink, queued.deepLink);
});
