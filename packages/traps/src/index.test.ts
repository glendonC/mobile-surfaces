// Co-located tests for @mobile-surfaces/traps.
//
// This package is load-bearing: every error class in the monorepo derives
// from MobileSurfacesError, and every consumer that logs a trapId/docsUrl
// reads through the lookup helpers here. Until now the package owned no
// test file — its runtime code (the lookup helpers, the lazy getters, the
// docs-URL builder) was only exercised indirectly through @mobile-surfaces
// /push, which left audit readers concluding it had zero coverage.
//
// The load-bearing assertion is "docsUrlFor parity": for every generated
// binding, docsUrlFor(id, title) must equal the docsUrl baked into that
// binding. The generator (scripts/generate-traps-package.mjs) and this
// package both compute docsUrl through the ./docs-url.ts leaf module; this
// test pins that equality so a future divergence — e.g. one copy pointing
// at CLAUDE.md, the other at AGENTS.md — fails CI instead of shipping.
//
// Run with: node --experimental-strip-types --test src/index.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  findTrap,
  findTrapByErrorClass,
  trapIdForErrorClass,
  docsUrlForErrorClass,
  docsUrlFor,
  githubAnchor,
  DOCS_BASE_URL,
  MobileSurfacesError,
  TrapIds,
  TRAP_BINDINGS,
  ERROR_CLASS_TO_TRAP_ID,
  type TrapId,
} from "./index.ts";

// A known-bound error class and its trap id, taken from the catalog so the
// test does not hard-code an assumption that could rot. Picked from the
// forward map at module load.
const [BOUND_CLASS, BOUND_TRAP_ID] = Object.entries(ERROR_CLASS_TO_TRAP_ID)[0];

test("findTrap resolves a known id and rejects unknown ids", () => {
  const binding = findTrap(BOUND_TRAP_ID);
  assert.ok(binding, "expected a binding for a catalog id");
  assert.equal(binding.id, BOUND_TRAP_ID);
  assert.equal(findTrap("MS999"), undefined);
  assert.equal(findTrap("not-an-id"), undefined);
  assert.equal(findTrap(""), undefined);
});

test("findTrapByErrorClass resolves bound classes and misses unbound ones", () => {
  const binding = findTrapByErrorClass(BOUND_CLASS);
  assert.ok(binding);
  assert.equal(binding.id, BOUND_TRAP_ID);
  assert.equal(findTrapByErrorClass("TotallyUnboundError"), undefined);
  assert.equal(findTrapByErrorClass(""), undefined);
});

test("trapIdForErrorClass returns the id or undefined", () => {
  assert.equal(trapIdForErrorClass(BOUND_CLASS), BOUND_TRAP_ID);
  assert.equal(trapIdForErrorClass("TotallyUnboundError"), undefined);
});

test("docsUrlForErrorClass returns the binding docsUrl or undefined", () => {
  const binding = findTrapByErrorClass(BOUND_CLASS);
  assert.ok(binding);
  assert.equal(docsUrlForErrorClass(BOUND_CLASS), binding.docsUrl);
  assert.equal(docsUrlForErrorClass("TotallyUnboundError"), undefined);
});

test("githubAnchor matches the GitHub markdown heading-slug algorithm", () => {
  // lowercase
  assert.equal(githubAnchor("MS001 Title"), "ms001-title");
  // a run of non-alphanumeric characters collapses to a single hyphen
  assert.equal(githubAnchor("a -- b"), "a-b");
  assert.equal(githubAnchor("4 KB / 5 KB"), "4-kb-5-kb");
  assert.equal(githubAnchor("dotted.name (paren)"), "dotted-name-paren");
  // leading and trailing hyphens are trimmed
  assert.equal(githubAnchor("  spaced  "), "spaced");
  assert.equal(githubAnchor("--edge--"), "edge");
  assert.equal(githubAnchor("...!!!"), "");
});

test("docsUrlFor builds a base#anchor URL with the MSXXX: heading shape", () => {
  const url = docsUrlFor("MS001" as TrapId, "Live Activity adapter boundary");
  assert.equal(
    url,
    `${DOCS_BASE_URL}#ms001-live-activity-adapter-boundary`,
  );
  // The colon and space after the id are part of the rendered heading and
  // collapse into the slug like any other non-alphanumeric run.
  assert.ok(url.startsWith(DOCS_BASE_URL + "#"));
  assert.equal(
    docsUrlFor("MS018" as TrapId, "A: B"),
    `${DOCS_BASE_URL}#ms018-a-b`,
  );
});

test("DOCS_BASE_URL points at AGENTS.md (the per-rule prose), not CLAUDE.md", () => {
  assert.ok(DOCS_BASE_URL.endsWith("/AGENTS.md"));
  assert.ok(!DOCS_BASE_URL.includes("CLAUDE.md"));
});

test("MobileSurfacesError resolves trapId/docsUrl lazily off this.name", () => {
  class BoundError extends MobileSurfacesError {
    constructor() {
      super("bound");
      this.name = BOUND_CLASS;
    }
  }
  const bound = new BoundError();
  assert.equal(bound.trapId, BOUND_TRAP_ID);
  assert.equal(bound.docsUrl, findTrap(BOUND_TRAP_ID)?.docsUrl);

  // A subclass whose name is never bound to a catalog class resolves both
  // fields to undefined rather than throwing.
  class UnboundError extends MobileSurfacesError {
    constructor() {
      super("unbound");
      this.name = "UnboundError";
    }
  }
  const unbound = new UnboundError();
  assert.equal(unbound.trapId, undefined);
  assert.equal(unbound.docsUrl, undefined);

  // A subclass that never assigns this.name inherits "Error" and is also
  // unbound.
  class NamelessError extends MobileSurfacesError {}
  const nameless = new NamelessError("no name");
  assert.equal(nameless.name, "Error");
  assert.equal(nameless.trapId, undefined);
  assert.equal(nameless.docsUrl, undefined);
});

test("TrapIds is a non-empty Record whose keys equal their values", () => {
  const entries = Object.entries(TrapIds);
  assert.ok(entries.length > 0, "expected at least one live trap id");
  for (const [key, value] of entries) {
    assert.equal(key, value, `TrapIds.${key} should equal "${key}"`);
    assert.match(value, /^MS\d{3}$/);
    // Every live id in TrapIds must resolve to a binding.
    assert.ok(findTrap(value), `TrapIds.${key} has no binding`);
  }
});

test("ERROR_CLASS_TO_TRAP_ID has no duplicate class names and resolves", () => {
  const names = Object.keys(ERROR_CLASS_TO_TRAP_ID);
  assert.equal(
    names.length,
    new Set(names).size,
    "duplicate error-class name in ERROR_CLASS_TO_TRAP_ID",
  );
  for (const [name, trapId] of Object.entries(ERROR_CLASS_TO_TRAP_ID)) {
    assert.ok(
      findTrap(trapId),
      `${name} maps to ${trapId}, which has no binding`,
    );
  }
});

// REGRESSION LOCK. This is the assertion that would have caught the
// CLAUDE.md/AGENTS.md drift: the generator stamps docsUrl into each binding
// via docsUrlFor, and this package re-exports the same docsUrlFor. If the
// two ever computed different strings, this fails. It pins the exported
// helper against the generated data forever.
test("docsUrlFor reproduces the docsUrl of every generated binding", () => {
  assert.ok(TRAP_BINDINGS.size > 0, "expected a non-empty binding table");
  for (const binding of TRAP_BINDINGS.values()) {
    assert.equal(
      docsUrlFor(binding.id, binding.title),
      binding.docsUrl,
      `docsUrlFor drifted from the generated docsUrl for ${binding.id}`,
    );
  }
});
