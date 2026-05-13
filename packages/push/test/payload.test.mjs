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
    const payload = liveActivityAlertPayloadFromSnapshot(snap);
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    assert.ok(
      bytes <= MAX_PAYLOAD_BYTES_DEFAULT,
      `fixture "${name}" payload is ${bytes} bytes; exceeds MS011 per-activity ceiling of ${MAX_PAYLOAD_BYTES_DEFAULT}. Trap: ${TRAP_ID}.`,
    );
  }
});

test(`every liveActivity fixture stays within the MS011 broadcast 5 KB ceiling`, () => {
  for (const [name, snap] of LIVE_ACTIVITY_FIXTURES) {
    const payload = liveActivityAlertPayloadFromSnapshot(snap);
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
  // secondaryText to push past the per-activity limit.
  const fat = {
    ...queued,
    secondaryText: "x".repeat(5000),
  };
  const payload = liveActivityAlertPayloadFromSnapshot(fat);
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  assert.ok(
    bytes > MAX_PAYLOAD_BYTES_DEFAULT,
    `negative test depends on the fattened payload exceeding ${MAX_PAYLOAD_BYTES_DEFAULT}; got ${bytes}`,
  );
});
