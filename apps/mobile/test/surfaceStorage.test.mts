// Unit coverage for the native-free App Group parsing in
// src/surfaceStorage/parse.ts. surfaceStorage/index.ts pairs these with
// ExtensionStorage reads; the parsing branches are exercised directly here.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  coerceSnapshotValue,
  coerceWrittenAt,
  parseDecodeErrorBreadcrumb,
} from "../src/surfaceStorage/parse.ts";

describe("parseDecodeErrorBreadcrumb", () => {
  it("returns null when the value is absent", () => {
    assert.equal(parseDecodeErrorBreadcrumb("s1", null), null);
    assert.equal(parseDecodeErrorBreadcrumb("s1", undefined), null);
  });

  it("parses a JSON-string breadcrumb with all fields", () => {
    const raw = JSON.stringify({
      at: "2026-05-22T10:00:00.000Z",
      error: "keyNotFound: stage",
      trapId: "MS003",
    });
    assert.deepEqual(parseDecodeErrorBreadcrumb("widget-1", raw), {
      surfaceId: "widget-1",
      at: "2026-05-22T10:00:00.000Z",
      error: "keyNotFound: stage",
      trapId: "MS003",
    });
  });

  it("defaults trapId to MS036 when a pre-v7 writer omitted it", () => {
    const raw = JSON.stringify({ at: "2026-05-22T10:00:00.000Z", error: "x" });
    const b = parseDecodeErrorBreadcrumb("s1", raw);
    assert.equal(b?.trapId, "MS036");
  });

  it("tolerates a raw object in case a future writer drops the JSON layer", () => {
    const b = parseDecodeErrorBreadcrumb("s1", { at: "t", error: "e" });
    assert.equal(b?.error, "e");
    assert.equal(b?.trapId, "MS036");
  });

  it("returns null for a string that is not JSON", () => {
    assert.equal(parseDecodeErrorBreadcrumb("s1", "not json {"), null);
  });

  it("returns null when the JSON is not an object", () => {
    assert.equal(parseDecodeErrorBreadcrumb("s1", "42"), null);
    assert.equal(parseDecodeErrorBreadcrumb("s1", "null"), null);
    assert.equal(parseDecodeErrorBreadcrumb("s1", '"a string"'), null);
  });

  it("returns null when at or error is missing or mistyped", () => {
    assert.equal(
      parseDecodeErrorBreadcrumb("s1", JSON.stringify({ error: "e" })),
      null,
    );
    assert.equal(
      parseDecodeErrorBreadcrumb("s1", JSON.stringify({ at: "t" })),
      null,
    );
    assert.equal(
      parseDecodeErrorBreadcrumb("s1", JSON.stringify({ at: 1, error: "e" })),
      null,
    );
  });
});

describe("coerceSnapshotValue", () => {
  it("returns null for an absent value", () => {
    assert.equal(coerceSnapshotValue(null), null);
    assert.equal(coerceSnapshotValue(undefined), null);
  });

  it("decodes a JSON string", () => {
    assert.deepEqual(coerceSnapshotValue('{"kind":"widget"}'), {
      kind: "widget",
    });
  });

  it("keeps a non-JSON string verbatim so the inspector can show the bytes", () => {
    assert.equal(coerceSnapshotValue("garbled{"), "garbled{");
  });

  it("passes a non-string value through unchanged", () => {
    const obj = { already: "decoded" };
    assert.equal(coerceSnapshotValue(obj), obj);
    assert.equal(coerceSnapshotValue(7), 7);
  });
});

describe("coerceWrittenAt", () => {
  it("accepts a finite number", () => {
    assert.equal(coerceWrittenAt(1747900800), 1747900800);
  });

  it("rejects a non-finite number", () => {
    assert.equal(coerceWrittenAt(Number.NaN), null);
    assert.equal(coerceWrittenAt(Number.POSITIVE_INFINITY), null);
  });

  it("parses a numeric string", () => {
    assert.equal(coerceWrittenAt("1747900800"), 1747900800);
  });

  it("rejects a non-numeric string and an absent value", () => {
    assert.equal(coerceWrittenAt("not-a-number"), null);
    assert.equal(coerceWrittenAt(null), null);
    assert.equal(coerceWrittenAt(undefined), null);
  });

  it("treats an empty string as 0 (carried over from the inline logic)", () => {
    // Number("") is 0; this edge is preserved verbatim from the
    // pre-extraction implementation rather than silently changed.
    assert.equal(coerceWrittenAt(""), 0);
  });
});
