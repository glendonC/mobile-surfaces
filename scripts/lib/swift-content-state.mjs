// Parse the Swift `ContentState` struct (and its `Stage` enum) from an
// ActivityAttributes source file. The Codable wire shape ActivityKit decodes
// is driven by the JSON key for each property, not the Swift property name -
// so any check that only compares Swift identifiers misses the silent class
// of failure where someone adds `case headline = "title"` to CodingKeys and
// the APNs payload silently fails to decode (MS003).
//
// This module is the source of truth for that parse so the check script and
// its tests share one implementation. Helpers are exported individually for
// targeted tests.
//
// Recognized CodingKeys forms:
//   - Auto-synthesized (no enum present): JSON key equals property name for
//     every property in the struct.
//   - `enum CodingKeys: String, CodingKey { case foo }`: JSON key equals
//     case name.
//   - `case foo = "bar"`: JSON key equals the string literal.
//   - Multi-case: `case foo, bar = "x", baz`.
//   - The enum nested inside the struct body OR declared in a sibling
//     `extension <Outer>.ContentState { enum CodingKeys: ... }` block.
//
// Properties NOT covered by an explicit CodingKeys enum are not en/decoded
// at all; the parser surfaces those as `jsonKey: null` so the caller can
// flag them as a parity issue (Swift field exists on the type but never
// reaches the wire).

const VISIBILITY = String.raw`(?:public\s+|private\s+|fileprivate\s+|internal\s+)?`;

/**
 * Parse the ContentState struct from a Swift source. Returns
 * `{ ok: true, fields, codingKeys, structRange }` where:
 *   - fields: Array<{ name, type, line, jsonKey }>. `jsonKey === null` means
 *     the property is declared but excluded from CodingKeys (so it never
 *     serializes).
 *   - codingKeys: null when no CodingKeys enum is found anywhere (Swift
 *     auto-synthesizes); otherwise `{ source: "nested" | "extension", cases }`
 *     where each case is `{ name, rawValue, jsonKey, line }`.
 *   - structRange: { start, end, body } locating the struct in the source.
 * Returns `{ ok: false, reason }` when the struct cannot be located.
 */
export function parseContentState(swiftSrc, { structName = "ContentState" } = {}) {
  const structRange = findBracedBlock(swiftSrc, new RegExp(
    `${VISIBILITY}struct\\s+${escapeRegExp(structName)}\\b[^{]*\\{`,
  ));
  if (!structRange) {
    return { ok: false, reason: `struct ${structName} not found` };
  }

  const fields = parseStoredProperties(swiftSrc, structRange);

  let codingKeys = findCodingKeysInBody(swiftSrc, structRange);
  if (!codingKeys) {
    const extCases = findCodingKeysInExtension(swiftSrc, structName);
    if (extCases) codingKeys = { source: "extension", cases: extCases };
  }

  if (codingKeys) {
    const byName = new Map(codingKeys.cases.map((c) => [c.name, c.jsonKey]));
    for (const f of fields) {
      f.jsonKey = byName.has(f.name) ? byName.get(f.name) : null;
    }
  } else {
    for (const f of fields) f.jsonKey = f.name;
  }

  return { ok: true, fields, codingKeys, structRange };
}

/**
 * Parse the Stage enum's case names. Returns `[{ name, line }]` or null when
 * the enum is not found. Kept here so the check script has a single Swift
 * parser to depend on; CodingKeys-style raw values on Stage cases would still
 * be a Zod-mirroring concern but are not used in the current contract.
 */
export function parseStageCases(swiftSrc) {
  const range = findBracedBlock(swiftSrc, new RegExp(
    `${VISIBILITY}enum\\s+Stage\\b[^{]*\\{`,
  ));
  if (!range) return null;
  const cases = [];
  for (const item of iterateCaseDeclarations(range.body)) {
    const absoluteOffset = range.start + item.offset;
    const line = swiftSrc.slice(0, absoluteOffset).split("\n").length;
    cases.push({ name: item.name, line });
  }
  return cases;
}

// ---------- Internal helpers ----------

function parseStoredProperties(swiftSrc, structRange) {
  // Only the immediate struct body, excluding nested enums/structs so we
  // don't mistake an inner declaration for a stored property.
  const surface = blankNestedBraces(structRange.body);
  const fields = [];
  // Property declarations may use `var` or `let`. The original check
  // accepted `var` only, but Codable synthesis works with `let` too, and a
  // user could plausibly declare immutable fields.
  const propRe = /\b(?:var|let)\s+(\w+)\s*:\s*([^\n=,{}/]+?)(?=\s*(?:=|\n|\/\/|$))/g;
  for (const m of surface.matchAll(propRe)) {
    const name = m[1];
    const type = m[2].trim();
    const absoluteOffset = structRange.start + m.index;
    const line = swiftSrc.slice(0, absoluteOffset).split("\n").length;
    fields.push({ name, type, line });
  }
  return fields;
}

function findCodingKeysInBody(swiftSrc, structRange) {
  // Match an enum CodingKeys block whose opening brace lives inside the
  // struct body. CodingKey is the conformance Swift's Codable synthesis
  // looks for; we don't require `String` since CaseIterable + Int keys would
  // produce numeric JSON keys (we'd still want to flag those).
  const headerRe = new RegExp(
    `${VISIBILITY}enum\\s+CodingKeys\\b[^{]*\\bCodingKey\\b[^{]*\\{`,
    "g",
  );
  const range = findBracedBlockWithin(
    swiftSrc,
    headerRe,
    structRange.start,
    structRange.end,
  );
  if (!range) return null;
  return { source: "nested", cases: parseCases(range.body, range.start, swiftSrc) };
}

function findCodingKeysInExtension(swiftSrc, structName) {
  // Match: extension <something>.ContentState { ... enum CodingKeys ... }
  // The extension may or may not qualify the parent type; permit both
  // `extension ContentState` and `extension X.ContentState`. We only handle
  // the simple, single-level pattern; deeper nesting is intentionally out
  // of scope and would surface as "no CodingKeys found, parity falls back
  // to property names" rather than silently misreporting.
  const extHeader = new RegExp(
    `\\bextension\\s+(?:[\\w.]+\\.)?${escapeRegExp(structName)}\\b[^{]*\\{`,
    "g",
  );
  let m;
  while ((m = extHeader.exec(swiftSrc)) !== null) {
    const extRange = findBracedBlockFromMatch(swiftSrc, m);
    if (!extRange) continue;
    const inner = findBracedBlockWithin(
      swiftSrc,
      new RegExp(
        `${VISIBILITY}enum\\s+CodingKeys\\b[^{]*\\bCodingKey\\b[^{]*\\{`,
        "g",
      ),
      extRange.start,
      extRange.end,
    );
    if (inner) return parseCases(inner.body, inner.start, swiftSrc);
  }
  return null;
}

function parseCases(enumBody, bodyStartOffset, swiftSrc) {
  const cases = [];
  for (const item of iterateCaseDeclarations(enumBody)) {
    const absoluteOffset = bodyStartOffset + item.offset;
    const line = swiftSrc.slice(0, absoluteOffset).split("\n").length;
    cases.push({
      name: item.name,
      rawValue: item.rawValue,
      jsonKey: item.rawValue ?? item.name,
      line,
    });
  }
  return cases;
}

// Walk a brace-delimited body and yield every case declaration with its
// offset inside the body. Handles `case foo`, `case foo = "bar"`, and
// `case foo, bar = "y", baz` on a single declaration.
function* iterateCaseDeclarations(body) {
  // Strip line comments so they don't swallow trailing tokens; keep
  // positions stable by replacing with spaces of the same width.
  const cleaned = body.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  const caseRe = /\bcase\s+([^\n;}]+)/g;
  let m;
  while ((m = caseRe.exec(cleaned)) !== null) {
    const declStart = m.index;
    const segments = splitTopLevelCommas(m[1]);
    let cursor = m.index + (m[0].length - m[1].length);
    for (const seg of segments) {
      const trimmed = seg.trim();
      if (!trimmed) {
        cursor += seg.length + 1;
        continue;
      }
      const eqIdx = indexOfTopLevelEqual(trimmed);
      let name;
      let rawValue = null;
      if (eqIdx === -1) {
        name = trimmed;
      } else {
        name = trimmed.slice(0, eqIdx).trim();
        const rhs = trimmed.slice(eqIdx + 1).trim();
        rawValue = parseStringLiteral(rhs);
        // If RHS is not a string literal (e.g. numeric raw value), treat
        // jsonKey as the property name and surface no rawValue. Numeric
        // CodingKey keys are legal but uncommon; the type check below
        // would flag them as drift if Zod expects a string key.
      }
      if (isValidIdentifier(name)) {
        yield {
          name,
          rawValue,
          offset: declStart, // approximate: start of the `case` keyword
        };
      }
      cursor += seg.length + 1;
    }
  }
}

function splitTopLevelCommas(s) {
  const out = [];
  let buf = "";
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && inStr && i + 1 < s.length) {
      buf += ch + s[i + 1];
      i++;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      buf += ch;
      continue;
    }
    if (ch === "," && !inStr) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

function indexOfTopLevelEqual(s) {
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && inStr && i + 1 < s.length) {
      i++;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (ch === "=" && !inStr) return i;
  }
  return -1;
}

function parseStringLiteral(s) {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
  if (!m) return null;
  return m[1].replace(/\\(.)/g, "$1");
}

function isValidIdentifier(s) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Replace the contents of every nested `{...}` block with spaces of the
// same length so a regex over the result only matches the immediate body's
// declarations. Brace counting starts at depth 0 at the outermost level.
function blankNestedBraces(body) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{") {
      depth++;
      out += depth === 1 ? ch : " ";
      continue;
    }
    if (ch === "}") {
      out += depth === 1 ? ch : " ";
      depth = Math.max(0, depth - 1);
      continue;
    }
    out += depth === 0 ? ch : " ";
  }
  return out;
}

function findBracedBlock(source, headerRe) {
  headerRe.lastIndex = 0;
  const m = headerRe.exec(source);
  if (!m) return null;
  return findBracedBlockFromMatch(source, m);
}

function findBracedBlockWithin(source, headerRe, regionStart, regionEnd) {
  headerRe.lastIndex = regionStart;
  while (true) {
    const m = headerRe.exec(source);
    if (!m) return null;
    if (m.index >= regionEnd) return null;
    const range = findBracedBlockFromMatch(source, m);
    if (range && range.end <= regionEnd) return range;
    // Header matched but body extended beyond the region; advance past it.
    if (range) headerRe.lastIndex = range.end;
  }
}

function findBracedBlockFromMatch(source, m) {
  const openIdx = m.index + m[0].length - 1;
  if (source[openIdx] !== "{") return null;
  let depth = 1;
  let i = openIdx + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return null;
  return {
    headerIndex: m.index,
    start: openIdx + 1,
    end: i,
    body: source.slice(openIdx + 1, i),
  };
}

// ---------- Shared Zod → Swift type resolver ----------
//
// Resolve a Zod field schema to the Swift type its JSONDecoder counterpart
// must declare. Returns `{ expected, reason }` where `expected` is the Swift
// type string (e.g. "String", "Double", "Bool", "String?") or null when the
// resolver does not recognize the shape. `reason` explains a null so the
// caller can emit a "teach the checker" issue rather than passing silently.
//
// `optional()` / `nullable()` both map to a Swift Optional. The projection
// helpers use `.optional()` for genuinely-absent slice fields and
// `.nullable()` for "present but null" projected fields. Swift Codable
// decodes both an absent key and an explicit JSON null into `T?`, so for the
// wire shape they are equivalent: the inner type must match and the Swift
// type must be the Optional form.
//
// Zod enums and string literals collapse to plain Swift `String`. The
// shared-state snapshot structs intentionally use plain scalars rather than
// nominal Swift enums so JSONDecoder stays tolerant of a host that emits a
// state value the widget binary predates.
//
// `check-activity-attributes.mjs` has one extra concern this resolver does
// not handle: the Live Activity Stage enum maps to a nominal Swift `Stage`
// (not `String`). That script special-cases the Stage instance check before
// delegating to this resolver.
export function resolveExpectedSwiftType(schema) {
  const def = schema?._zod?.def;
  if (!def) return { expected: null, reason: "no resolvable Zod def" };

  if (def.type === "optional" || def.type === "nullable") {
    const inner = resolveExpectedSwiftType(def.innerType);
    if (inner.expected === null) {
      return {
        expected: null,
        reason: `${def.type} wrapping an unsupported inner shape (${inner.reason})`,
      };
    }
    if (inner.expected.endsWith("?")) {
      // optional(optional(...)) collapses to a single Swift Optional, but
      // the contract does not use that shape; flag rather than guess.
      return {
        expected: null,
        reason: `nested ${def.type} is not a shape this checker handles`,
      };
    }
    return { expected: `${inner.expected}?`, reason: null };
  }

  if (def.type === "string") return { expected: "String", reason: null };
  if (def.type === "boolean") return { expected: "Bool", reason: null };
  if (def.type === "number") {
    if (def.format && /int/i.test(String(def.format))) {
      return { expected: "Int", reason: null };
    }
    return { expected: "Double", reason: null };
  }
  if (def.type === "enum") {
    const members = def.entries ? Object.values(def.entries) : [];
    if (members.length > 0 && members.every((v) => typeof v === "string")) {
      return { expected: "String", reason: null };
    }
    return {
      expected: null,
      reason: "enum with non-string members is not handled",
    };
  }
  if (def.type === "literal") {
    const vals = def.values ?? [];
    if (vals.length > 0 && vals.every((v) => typeof v === "string")) {
      return { expected: "String", reason: null };
    }
    return {
      expected: null,
      reason: "literal with non-string value is not handled",
    };
  }

  return { expected: null, reason: `unrecognized Zod type "${def.type}"` };
}
