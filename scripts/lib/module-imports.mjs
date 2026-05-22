// Structural detection of every import of a given module specifier from a
// TypeScript / JavaScript source string.
//
// Why this exists: an MS-rule that forbids importing a module (MS001's
// adapter boundary, the indirect side of MS039's token discipline) is only
// sound if the check catches *every* import form. A `from "<pkg>"` regex
// misses none of the named/default/namespace import shapes — they all carry
// the specifier in a trailing `from` clause — but it does miss:
//
//   - dynamic   `import("<pkg>")`           (no `from`)
//   - require   `require("<pkg>")`          (CJS interop)
//   - bare      `import "<pkg>";`           (side-effect import, no `from`)
//
// An aliased or namespace import is NOT a separate problem: `import * as LA
// from "<pkg>"`, `import Renamed from "<pkg>"`, and `export { x } from
// "<pkg>"` all still terminate in `from "<pkg>"`, so a `from`-anchored match
// catches them. What the old grep-shaped checks missed was conflating "the
// import is aliased" with "the import is undetectable" — the alias lives on
// the *binding* side, the specifier on the *source* side, and only the
// source side matters for a forbidden-module gate. This module makes that
// explicit by matching the four statement forms directly.
//
// The caller is expected to run the source through stripNonCode first (with
// keepStrings: true, since the specifier is itself a string literal) so a
// commented-out or string-embedded import cannot register.

/**
 * Escape a string for literal use inside a RegExp.
 * @param {string} s
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the alternation that matches the target specifier, optionally with a
 * subpath (`<pkg>` or `<pkg>/react`, `<pkg>/types`, ...). The subpath is
 * matched so a check that forbids a package also forbids its sub-paths.
 *
 * @param {string} specifier  Exact module specifier, e.g. "@mobile-surfaces/live-activity".
 * @param {{ subpaths?: boolean }} [opts]  Match `<specifier>/...` too (default true).
 */
function specifierPattern(specifier, opts = {}) {
  const subpaths = opts.subpaths !== false;
  const base = escapeRegExp(specifier);
  return subpaths ? `${base}(?:\\/[^"'\\s]*)?` : base;
}

/**
 * Find every import of `specifier` in `source`. Returns one match per import
 * site, with the 1-based line number and the import form. Covers:
 *
 *   - "from"     ES `import`/`export ... from "<spec>"` — this single form
 *                subsumes named, default, namespace (`* as`), aliased, and
 *                re-export imports, because every one of them ends in the
 *                same `from "<spec>"` clause.
 *   - "bare"     side-effect `import "<spec>";` (no binding, no `from`).
 *   - "dynamic"  `import("<spec>")` expression.
 *   - "require"  `require("<spec>")` CJS call.
 *
 * The caller should pass source already run through stripNonCode (with
 * keepStrings: true) so a literal inside a comment does not register.
 *
 * @param {string} source
 * @param {string} specifier  Exact module specifier to detect.
 * @param {{ subpaths?: boolean }} [opts]
 * @returns {{ line: number, form: "from" | "bare" | "dynamic" | "require", index: number }[]}
 */
export function findModuleImports(source, specifier, opts = {}) {
  const spec = specifierPattern(specifier, opts);
  const hits = [];

  // Each entry is [form, regex]. The regexes are intentionally separate (not
  // one mega-alternation) so the form is known per match and so a future
  // form can be added without disturbing the others.
  //
  // "from": `from` followed by the quoted specifier. Matches both
  // `import ... from "x"` and `export ... from "x"`; the binding clause
  // before `from` is irrelevant, which is exactly why aliasing cannot evade
  // it. `\bfrom` is anchored on a word boundary so a property access like
  // `obj.from("x")` is not mistaken for an import.
  const forms = [
    ["from", new RegExp(`\\bfrom\\s*["']${spec}["']`, "g")],
    // "bare": `import "x"` / `import 'x'` with no binding and no `from`. The
    // negative-lookahead-free shape is fine because a binding import always
    // has a `from`, so `import` directly followed by a quote is unambiguous.
    ["bare", new RegExp(`\\bimport\\s*["']${spec}["']`, "g")],
    // "dynamic": `import("x")`. Permit whitespace before the paren.
    ["dynamic", new RegExp(`\\bimport\\s*\\(\\s*["']${spec}["']`, "g")],
    // "require": `require("x")`.
    ["require", new RegExp(`\\brequire\\s*\\(\\s*["']${spec}["']`, "g")],
  ];

  for (const [form, re] of forms) {
    let m;
    while ((m = re.exec(source)) !== null) {
      hits.push({
        form,
        index: m.index,
        line: source.slice(0, m.index).split("\n").length,
      });
    }
  }

  // Sort by source position so callers reporting violations get them in
  // file order regardless of the form-iteration order above.
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

/**
 * Convenience predicate: does `source` import `specifier` in any form?
 *
 * @param {string} source
 * @param {string} specifier
 * @param {{ subpaths?: boolean }} [opts]
 * @returns {boolean}
 */
export function importsModule(source, specifier, opts = {}) {
  return findModuleImports(source, specifier, opts).length > 0;
}
