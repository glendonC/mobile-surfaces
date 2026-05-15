// Roundtrip and shape pins for liveActivityAlertPayload. Moved from
// scripts/surface-contracts.test.mjs in 3.0.0 when the alert payload helper
// migrated from @mobile-surfaces/surface-contracts into this package.
//
// v5.0.0: helper renamed `liveActivityAlertPayloadFromSnapshot` →
// `toApnsAlertPayload`; reads now come from the `liveActivity` slice
// (`snapshot.liveActivity.title`/`body`/`deepLink`) instead of the v3 base
// fields that were lifted into per-kind slices.

import test from "node:test";
import assert from "node:assert/strict";
import { surfaceFixtureSnapshots } from "@mobile-surfaces/surface-contracts";
import {
  liveActivityAlertPayload,
  toApnsAlertPayload,
} from "../src/payloads.ts";

const queued = surfaceFixtureSnapshots.queued;

// toApnsAlertPayload constructs its return shape by hand. Round-trip through
// the liveActivityAlertPayload Zod schema so the two cannot drift: any field
// rename or type change in the schema breaks this assertion before the helper
// ships.
test("toApnsAlertPayload output parses as liveActivityAlertPayload", () => {
  assert.equal(queued.kind, "liveActivity");
  const payload = toApnsAlertPayload(queued);
  const parsed = liveActivityAlertPayload.parse(payload);
  assert.deepEqual(parsed, payload);
});

test("toApnsAlertPayload pulls fields from the snapshot's liveActivity slice", () => {
  const payload = toApnsAlertPayload(queued);
  assert.equal(payload.aps.alert.title, queued.liveActivity.title);
  assert.equal(payload.aps.alert.body, queued.liveActivity.body);
  assert.equal(payload.aps.sound, "default");
  assert.equal(payload.liveSurface.kind, "surface_snapshot");
  assert.equal(payload.liveSurface.snapshotId, queued.id);
  assert.equal(payload.liveSurface.surfaceId, queued.surfaceId);
  assert.equal(payload.liveSurface.state, queued.state);
  assert.equal(payload.liveSurface.deepLink, queued.liveActivity.deepLink);
});

// MS011 payload-size ceilings. Per-activity Live Activity pushes are bounded
// at 4 KB; iOS 18 broadcast pushes get an extra 1 KB. Pin every committed
// liveActivity fixture against both ceilings so a fixture edit that bloats
// the payload past Apple's limit fails CI rather than failing in production
// (where APNs would return 413 silently for some surface combinations and
// drop the update for others).
const MAX_PAYLOAD_BYTES_DEFAULT = 4096;
const MAX_PAYLOAD_BYTES_BROADCAST = 5120;
const TRAP_ID = "MS011";

const LIVE_ACTIVITY_FIXTURES = Object.entries(surfaceFixtureSnapshots).filter(
  ([, snap]) => snap.kind === "liveActivity",
);

test(`every liveActivity fixture stays within the MS011 per-activity 4 KB ceiling`, () => {
  assert.ok(
    LIVE_ACTIVITY_FIXTURES.length > 0,
    "expected at least one liveActivity fixture",
  );
  for (const [name, snap] of LIVE_ACTIVITY_FIXTURES) {
    const payload = toApnsAlertPayload(snap);
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    assert.ok(
      bytes <= MAX_PAYLOAD_BYTES_DEFAULT,
      `fixture "${name}" payload is ${bytes} bytes; exceeds MS011 per-activity ceiling of ${MAX_PAYLOAD_BYTES_DEFAULT}. Trap: ${TRAP_ID}.`,
    );
  }
});

test(`every liveActivity fixture stays within the MS011 broadcast 5 KB ceiling`, () => {
  for (const [name, snap] of LIVE_ACTIVITY_FIXTURES) {
    const payload = toApnsAlertPayload(snap);
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    assert.ok(
      bytes <= MAX_PAYLOAD_BYTES_BROADCAST,
      `fixture "${name}" payload is ${bytes} bytes; exceeds MS011 broadcast ceiling of ${MAX_PAYLOAD_BYTES_BROADCAST}. Trap: ${TRAP_ID}.`,
    );
  }
});

test("a snapshot bloated past 4 KB triggers the MS011 catch", () => {
  // Negative case so a future regression where the ceiling check itself was
  // weakened would surface. Use a fixture as the base then attach a long
  // body to push past the per-activity limit.
  const fat = {
    ...queued,
    liveActivity: {
      ...queued.liveActivity,
      body: "x".repeat(5000),
    },
  };
  const payload = toApnsAlertPayload(fat);
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  assert.ok(
    bytes > MAX_PAYLOAD_BYTES_DEFAULT,
    `negative test depends on the fattened payload exceeding ${MAX_PAYLOAD_BYTES_DEFAULT}; got ${bytes}`,
  );
});
