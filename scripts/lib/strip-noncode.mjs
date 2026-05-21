// Blanks the non-code regions of a TypeScript / JavaScript source string so a
// grep-shaped check cannot be satisfied (or falsely tripped) by a marker that
// only appears inside a comment, a string literal, or a regex literal.
//
// Why this exists: several invariant checks (check-adapter-parses,
// check-token-discipline) look for a fixed identifier or call in source.
// Matching the raw file means a call commented out during a refactor still
// satisfies the gate. Routing the source through stripNonCode first means
// only live code is matched.
//
// Two modes:
//   stripNonCode(src)                        comments AND string / regex
//                                            literal contents are blanked.
//   stripNonCode(src, { keepStrings: true }) only comments are blanked;
//                                            string and regex contents are
//                                            kept verbatim. Use this for a
//                                            check whose marker is itself a
//                                            string-literal argument (e.g.
//                                            an event name or a module
//                                            specifier) but which still must
//                                            not be satisfied by a comment.
//
// Contract: the returned string has the SAME LENGTH as the input, and every
// newline is preserved at the same offset, so byte offsets and line/column
// numbers computed against the stripped string map back to the original.
//
// This is a pragmatic lexer, not a full parser: it handles line and block
// comments, the three string forms (including template-literal `${}`
// interpolation, whose expressions remain live code), and regex literals
// (disambiguated from division by the preceding significant character).

// Characters that, when they are the last significant character before a `/`,
// mean the `/` begins a regex literal rather than a division operator. An
// empty previous character (start of input) also means regex.
//
// `<` is deliberately excluded: in a .tsx file `</Tag>` would otherwise be
// read as a regex literal and desync the scanner. Treating `/` after `<` as
// division leaves JSX intact; the only cost is that a regex written directly
// after a `<` comparison is mis-tokenized, which is negligible and cannot
// cause a false negative for the identifier-presence checks that consume this.
const REGEX_PRECEDERS = new Set([
  "(", "[", "{", ",", ";", ":", "=", "!", "&", "|",
  "?", "+", "-", "*", "/", "%", "^", "~", ">",
]);

// Keywords that, when they are the last token before a `/`, mean the `/`
// begins a regex literal even though the preceding character is alphanumeric.
// Without this, `return /re/` is mis-read as `return` divided by `re`, and a
// quote or backtick inside that regex body desyncs the scanner. The set is
// the statement/operator keywords genuinely followed by an expression; `in`,
// `of`, and `new` are excluded because they more often appear as property
// names (`obj.in`) than before a regex. The residual gap (a generator method
// `gen.return /re/` with no call parens) is too rare to matter for the
// identifier-presence checks that consume this.
const REGEX_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "throw", "case",
  "delete", "void", "do", "else", "yield", "await",
]);

// The identifier-or-keyword token ending the already-emitted output, used to
// resolve a `/` after an alphanumeric character: trailing whitespace is
// skipped, then word characters are collected backward.
function trailingWord(emitted) {
  let i = emitted.length - 1;
  while (i >= 0 && /\s/.test(emitted[i])) i -= 1;
  const end = i;
  while (i >= 0 && /[A-Za-z0-9_$]/.test(emitted[i])) i -= 1;
  return emitted.slice(i + 1, end + 1);
}

// Newlines and tabs survive blanking so line/column math is preserved and
// indentation-sensitive scans are unaffected; every other blanked char
// becomes a space.
function blank(ch) {
  return ch === "\n" || ch === "\r" || ch === "\t" ? ch : " ";
}

/**
 * @param {string} source
 * @param {{ keepStrings?: boolean }} [options]
 * @returns {string} same-length source with comments (and, unless
 *   keepStrings, string and regex literal contents) blanked.
 */
export function stripNonCode(source, options = {}) {
  const keepStrings = options.keepStrings === true;
  const n = source.length;
  let out = "";
  let i = 0;

  // Last significant (non-whitespace) code character emitted, used to
  // disambiguate a `/` as regex-start vs division.
  let lastSignificant = "";
  // Brace-depth stack: each `${` interpolation records the brace depth it
  // opened at so the matching `}` returns scanning to template-literal mode.
  const templateStack = [];
  let braceDepth = 0;

  // Emit one literal character: verbatim when keepStrings, blanked otherwise.
  const lit = (ch) => (keepStrings ? ch : blank(ch));

  // Scan a template literal starting just past the opening backtick or just
  // past a `${...}` close. Returns when the literal closes or an interpolation
  // opens. Sets the index and emits as it goes.
  function scanTemplate() {
    let closed = false;
    while (i < n) {
      const c = source[i];
      if (c === "\\" && i + 1 < n) {
        out += lit(c) + lit(source[i + 1]);
        i += 2;
        continue;
      }
      if (c === "`") {
        out += lit(c);
        i += 1;
        closed = true;
        break;
      }
      if (c === "$" && source[i + 1] === "{") {
        braceDepth += 1;
        templateStack.push(braceDepth);
        out += "${";
        i += 2;
        break;
      }
      out += keepStrings && c !== "\n" ? c : blank(c);
      i += 1;
    }
    if (closed) lastSignificant = "x";
  }

  while (i < n) {
    const ch = source[i];
    const next = i + 1 < n ? source[i + 1] : "";

    // Line comment. Always blanked, both modes.
    if (ch === "/" && next === "/") {
      out += "  ";
      i += 2;
      while (i < n && source[i] !== "\n") {
        out += blank(source[i]);
        i += 1;
      }
      continue;
    }

    // Block comment. Always blanked, both modes.
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out += blank(source[i]);
        i += 1;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
      continue;
    }

    // String literal (single or double quoted).
    if (ch === '"' || ch === "'") {
      out += lit(ch);
      i += 1;
      while (i < n && source[i] !== ch) {
        if (source[i] === "\\" && i + 1 < n) {
          out += lit(source[i]) + lit(source[i + 1]);
          i += 2;
          continue;
        }
        if (source[i] === "\n") break; // unterminated; stop at the line end
        out += lit(source[i]);
        i += 1;
      }
      if (i < n && source[i] === ch) {
        out += lit(ch);
        i += 1;
      }
      lastSignificant = "x"; // a closed string is a value
      continue;
    }

    // Template literal. `${...}` interpolations are live code regardless.
    if (ch === "`") {
      out += lit(ch);
      i += 1;
      scanTemplate();
      continue;
    }

    // Regex literal vs division.
    if (ch === "/") {
      let isRegex;
      if (lastSignificant === "" || REGEX_PRECEDERS.has(lastSignificant)) {
        isRegex = true;
      } else if (/[A-Za-z0-9_$]/.test(lastSignificant)) {
        // A `/` after an identifier is division, unless that identifier is a
        // keyword an expression (and so a regex) can follow.
        isRegex = REGEX_KEYWORDS.has(trailingWord(out));
      } else {
        isRegex = false;
      }
      if (isRegex) {
        out += lit(ch);
        i += 1;
        let inClass = false;
        while (i < n) {
          const c = source[i];
          if (c === "\\" && i + 1 < n) {
            out += lit(c) + lit(source[i + 1]);
            i += 2;
            continue;
          }
          if (c === "\n") break; // unterminated regex; bail at line end
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) {
            out += lit(c);
            i += 1;
            break;
          }
          out += lit(c);
          i += 1;
        }
        // Consume regex flags.
        while (i < n && /[a-z]/i.test(source[i])) {
          out += lit(source[i]);
          i += 1;
        }
        lastSignificant = "x";
        continue;
      }
      // Division operator.
      out += ch;
      lastSignificant = ch;
      i += 1;
      continue;
    }

    // Plain code character.
    if (ch === "{") {
      braceDepth += 1;
    } else if (ch === "}") {
      if (
        templateStack.length > 0 &&
        templateStack[templateStack.length - 1] === braceDepth
      ) {
        // Close of a `${...}` interpolation; resume the template literal.
        templateStack.pop();
        braceDepth -= 1;
        out += ch;
        i += 1;
        scanTemplate();
        continue;
      }
      braceDepth -= 1;
    }

    out += ch;
    if (!/\s/.test(ch)) lastSignificant = ch;
    i += 1;
  }

  return out;
}
