// Unit tests for the DeliveryOrder reference domain. Verifies that:
//   - every stage projects to a snapshot that round-trips through
//     safeParseSnapshot (no producer-side drift from the contract)
//   - stage → progress mapping matches the documented quartile split
//   - mockTickOrder advances the lifecycle and bumps updatedAt
//   - every kind populates the slice the discriminated union demands
//
// The point of these tests is the wire-boundary parse pattern: the
// projection family itself runs safeParseSnapshot inside
// deliveryToSnapshot, so the assertions below mostly re-parse the
// output to demonstrate the round-trip rather than re-discover any
// drift the producer-side parse would already have caught.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  safeParseSnapshot,
  type LiveSurfaceKind,
} from "@mobile-surfaces/surface-contracts";
import {
  deliveryToSnapshot,
  initialDeliveryOrder,
  mockTickOrder,
  stageToProgress,
  type DeliveryStage,
} from "../src/example/delivery.ts";

const KINDS: ReadonlyArray<LiveSurfaceKind> = [
  "liveActivity",
  "widget",
  "control",
  "notification",
  "lockAccessory",
  "standby",
];

const STAGES: ReadonlyArray<DeliveryStage> = [
  "placed",
  "preparing",
  "out_for_delivery",
  "delivered",
];

test("every (stage × kind) projection parses as a LiveSurfaceSnapshot", () => {
  const base = initialDeliveryOrder(new Date("2026-05-16T00:00:00Z"));
  for (const stage of STAGES) {
    const order = { ...base, stage, updatedAt: "2026-05-16T00:00:01Z" };
    for (const kind of KINDS) {
      const snapshot = deliveryToSnapshot(order, kind);
      const parsed = safeParseSnapshot(snapshot);
      assert.equal(
        parsed.success,
        true,
        `stage=${stage} kind=${kind}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`,
      );
      assert.equal((parsed as { data: { kind: string } }).data.kind, kind);
    }
  }
});

test("progress mapping covers the expected quartile split", () => {
  assert.equal(stageToProgress("placed"), 0);
  assert.equal(stageToProgress("preparing"), 1 / 3);
  assert.equal(stageToProgress("out_for_delivery"), 2 / 3);
  assert.equal(stageToProgress("delivered"), 1);
});

test("liveActivity projection carries the stage's mapped LiveSurfaceStage", () => {
  const base = initialDeliveryOrder(new Date("2026-05-16T00:00:00Z"));
  const cases: Array<[DeliveryStage, string]> = [
    ["placed", "prompted"],
    ["preparing", "inProgress"],
    ["out_for_delivery", "inProgress"],
    ["delivered", "completing"],
  ];
  for (const [stage, expected] of cases) {
    const snapshot = deliveryToSnapshot(
      { ...base, stage, updatedAt: "2026-05-16T00:00:01Z" },
      "liveActivity",
    );
    if (snapshot.kind !== "liveActivity") {
      throw new Error("expected liveActivity snapshot");
    }
    assert.equal(snapshot.liveActivity.stage, expected, `stage=${stage}`);
  }
});

test("notification projection sets timeSensitive on out_for_delivery and delivered", () => {
  const base = initialDeliveryOrder(new Date("2026-05-16T00:00:00Z"));
  const cases: Array<[DeliveryStage, string | undefined]> = [
    ["placed", undefined],
    ["preparing", undefined],
    ["out_for_delivery", "timeSensitive"],
    ["delivered", "timeSensitive"],
  ];
  for (const [stage, expected] of cases) {
    const snapshot = deliveryToSnapshot(
      { ...base, stage, updatedAt: "2026-05-16T00:00:01Z" },
      "notification",
    );
    if (snapshot.kind !== "notification") {
      throw new Error("expected notification snapshot");
    }
    assert.equal(snapshot.notification.interruptionLevel, expected);
  }
});

test("control projection uses the registry's toggle controlKind", () => {
  const order = initialDeliveryOrder(new Date("2026-05-16T00:00:00Z"));
  const snapshot = deliveryToSnapshot(order, "control");
  if (snapshot.kind !== "control") {
    throw new Error("expected control snapshot");
  }
  assert.equal(snapshot.control.controlKind, "toggle");
  assert.equal(snapshot.control.state, false);
});

test("lockAccessory projection drives the gauge from stage progress", () => {
  const base = initialDeliveryOrder(new Date("2026-05-16T00:00:00Z"));
  for (const stage of STAGES) {
    const snapshot = deliveryToSnapshot(
      { ...base, stage, updatedAt: "2026-05-16T00:00:01Z" },
      "lockAccessory",
    );
    if (snapshot.kind !== "lockAccessory") {
      throw new Error("expected lockAccessory snapshot");
    }
    assert.equal(snapshot.lockAccessory.gaugeValue, stageToProgress(stage));
  }
});

test("mockTickOrder bumps updatedAt and advances stage", () => {
  const t0 = new Date("2026-05-16T00:00:00Z");
  const t1 = new Date("2026-05-16T00:05:00Z");
  const order = initialDeliveryOrder(t0);
  const next = mockTickOrder(order, "preparing", t1);
  assert.equal(next.stage, "preparing");
  assert.equal(next.updatedAt, t1.toISOString());
  assert.notEqual(next.updatedAt, order.updatedAt);
});

test("mockTickOrder drops etaMinutes once delivered", () => {
  const order = initialDeliveryOrder(new Date("2026-05-16T00:00:00Z"));
  const next = mockTickOrder(
    order,
    "delivered",
    new Date("2026-05-16T00:30:00Z"),
  );
  assert.equal(next.etaMinutes, undefined);
});

test("snapshotId is stable across re-projections of the same order", () => {
  const order = initialDeliveryOrder(new Date("2026-05-16T00:00:00Z"));
  const a = deliveryToSnapshot(order, "widget");
  const b = deliveryToSnapshot(order, "widget");
  assert.equal(a.id, b.id);
});

test("snapshotId changes after mockTickOrder bumps updatedAt", () => {
  const order = initialDeliveryOrder(new Date("2026-05-16T00:00:00Z"));
  const a = deliveryToSnapshot(order, "widget");
  const next = mockTickOrder(
    order,
    "preparing",
    new Date("2026-05-16T00:05:00Z"),
  );
  const b = deliveryToSnapshot(next, "widget");
  assert.notEqual(a.id, b.id);
});
