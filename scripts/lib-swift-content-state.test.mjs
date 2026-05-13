import test from "node:test";
import assert from "node:assert/strict";

import { parseContentState, parseStageCases } from "./lib/swift-content-state.mjs";

function field(fields, name) {
  return fields.find((f) => f.name === name);
}

test("auto-synthesized CodingKeys: jsonKey equals property name for every field", () => {
  const src = `
    public struct ContentState: Codable, Hashable, Sendable {
      var headline: String
      var subhead: String
      var progress: Double
      var stage: Stage
    }
  `;
  const r = parseContentState(src);
  assert.equal(r.ok, true);
  assert.equal(r.codingKeys, null);
  assert.equal(r.fields.length, 4);
  for (const f of r.fields) assert.equal(f.jsonKey, f.name);
});

test("explicit CodingKeys without raw values: jsonKey equals case name", () => {
  const src = `
    public struct ContentState: Codable, Hashable, Sendable {
      var headline: String
      var subhead: String
      enum CodingKeys: String, CodingKey {
        case headline
        case subhead
      }
    }
  `;
  const r = parseContentState(src);
  assert.equal(r.ok, true);
  assert.equal(r.codingKeys.source, "nested");
  assert.equal(field(r.fields, "headline").jsonKey, "headline");
  assert.equal(field(r.fields, "subhead").jsonKey, "subhead");
});

test("CodingKeys with raw-value remap: jsonKey reflects the string literal (this is the MS003 hole)", () => {
  const src = `
    public struct ContentState: Codable, Hashable, Sendable {
      var headline: String
      var subhead: String
      enum CodingKeys: String, CodingKey {
        case headline = "title"
        case subhead
      }
    }
  `;
  const r = parseContentState(src);
  assert.equal(r.ok, true);
  assert.equal(field(r.fields, "headline").jsonKey, "title");
  assert.equal(field(r.fields, "subhead").jsonKey, "subhead");
});

test("CodingKeys with multi-case declarations on one line", () => {
  const src = `
    struct ContentState: Codable {
      var a: String
      var b: String
      var c: String
      enum CodingKeys: String, CodingKey {
        case a, b = "B", c
      }
    }
  `;
  const r = parseContentState(src);
  assert.equal(r.ok, true);
  assert.equal(field(r.fields, "a").jsonKey, "a");
  assert.equal(field(r.fields, "b").jsonKey, "B");
  assert.equal(field(r.fields, "c").jsonKey, "c");
});

test("partial CodingKeys: properties absent from the enum get jsonKey=null (not serialized)", () => {
  const src = `
    struct ContentState: Codable {
      var headline: String
      var subhead: String
      enum CodingKeys: String, CodingKey {
        case headline
      }
    }
  `;
  const r = parseContentState(src);
  assert.equal(r.ok, true);
  assert.equal(field(r.fields, "headline").jsonKey, "headline");
  assert.equal(field(r.fields, "subhead").jsonKey, null);
});

test("CodingKeys declared in a sibling extension is detected", () => {
  const src = `
    struct ContentState: Codable {
      var headline: String
    }

    extension Outer.ContentState {
      enum CodingKeys: String, CodingKey {
        case headline = "title"
      }
    }
  `;
  const r = parseContentState(src);
  assert.equal(r.ok, true);
  assert.equal(r.codingKeys.source, "extension");
  assert.equal(field(r.fields, "headline").jsonKey, "title");
});

test("CodingKeys with comments interleaved is parsed", () => {
  const src = `
    struct ContentState: Codable {
      var a: String
      var b: String
      enum CodingKeys: String, CodingKey {
        // Renames a to "alpha"
        case a = "alpha"
        case b  // unchanged
      }
    }
  `;
  const r = parseContentState(src);
  assert.equal(r.ok, true);
  assert.equal(field(r.fields, "a").jsonKey, "alpha");
  assert.equal(field(r.fields, "b").jsonKey, "b");
});

test("nested types inside the struct do not leak into stored-property parsing", () => {
  const src = `
    struct ContentState: Codable {
      var headline: String
      enum Stage: String, Codable {
        case prompted
        case inProgress
      }
      var stage: Stage
    }
  `;
  const r = parseContentState(src);
  assert.equal(r.ok, true);
  const names = r.fields.map((f) => f.name).sort();
  assert.deepEqual(names, ["headline", "stage"]);
});

test("let-declared fields are recognized alongside var", () => {
  const src = `
    struct ContentState: Codable {
      let headline: String
      var subhead: String
    }
  `;
  const r = parseContentState(src);
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields.map((f) => f.name).sort(), ["headline", "subhead"]);
});

test("missing struct returns ok=false", () => {
  const r = parseContentState("// nothing here");
  assert.equal(r.ok, false);
});

test("parseStageCases returns case names and line numbers", () => {
  const src = `
    enum Stage: String, Codable, Hashable, Sendable {
      case prompted
      case inProgress
      case completing
    }
  `;
  const cases = parseStageCases(src);
  assert.equal(cases.length, 3);
  assert.deepEqual(cases.map((c) => c.name), ["prompted", "inProgress", "completing"]);
  for (const c of cases) assert.ok(c.line > 0);
});

test("real ContentState file shape: parses the canonical attributes file", () => {
  const src = `
import ActivityKit

struct MobileSurfacesActivityAttributes: ActivityAttributes, Sendable {
  public struct ContentState: Codable, Hashable, Sendable {
    var headline: String
    var subhead: String
    var progress: Double
    var stage: Stage
  }

  enum Stage: String, Codable, Hashable, Sendable {
    case prompted
    case inProgress
    case completing
  }

  var surfaceId: String
  var modeLabel: String
}
`;
  const r = parseContentState(src);
  assert.equal(r.ok, true);
  assert.equal(r.codingKeys, null);
  assert.equal(r.fields.length, 4);
  assert.equal(field(r.fields, "stage").type, "Stage");
  const stages = parseStageCases(src);
  assert.equal(stages.length, 3);
});
