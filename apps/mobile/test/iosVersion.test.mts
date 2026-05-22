// Unit coverage for the native-free iOS-version floor check in
// src/diagnostics/iosVersion.ts. checkSetup.ts feeds it Platform.Version.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { meetsIosFloor } from "../src/diagnostics/iosVersion.ts";

describe("meetsIosFloor", () => {
  it("accepts the 17.2 floor exactly", () => {
    assert.equal(meetsIosFloor("17.2"), true);
  });

  it("accepts a higher minor and a higher major", () => {
    assert.equal(meetsIosFloor("17.10"), true);
    assert.equal(meetsIosFloor("18.0"), true);
    assert.equal(meetsIosFloor("26.1.1"), true);
  });

  it("accepts a bare major above the floor", () => {
    assert.equal(meetsIosFloor("18"), true);
  });

  it("rejects a minor below the floor on the floor major", () => {
    assert.equal(meetsIosFloor("17.1"), false);
    assert.equal(meetsIosFloor("17.0"), false);
    assert.equal(meetsIosFloor("17"), false);
  });

  it("rejects a major below the floor", () => {
    assert.equal(meetsIosFloor("16.4"), false);
    assert.equal(meetsIosFloor("15.1"), false);
  });

  it("rejects a version whose major does not parse", () => {
    assert.equal(meetsIosFloor(""), false);
    assert.equal(meetsIosFloor("abc"), false);
  });
});
