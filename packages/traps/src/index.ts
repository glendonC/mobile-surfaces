// @mobile-surfaces/traps — public surface.
//
// Single home for:
//   - the catalog binding type (TrapBinding) consumed at runtime by every
//     other package;
//   - the MobileSurfacesError abstract base class (every error class in
//     the monorepo derives from this; lazy trapId/docsUrl getters resolve
//     through the generated table);
//   - the docs URL builder, re-exported from the ./docs-url.ts leaf module
//     so external code imports it from the package root while the codegen
//     script imports the same module directly — one slug algorithm, no
//     drift between generated docsUrl and runtime docsUrl;
//   - lookup helpers (findTrap, findTrapByErrorClass, trapIdForErrorClass,
//     docsUrlForErrorClass) and the typed TrapIds constant.
//
// The actual data table lives in src/generated/bindings.ts, generated from
// data/traps.json by scripts/generate-traps-package.mjs. This file declares
// the surface; it does not encode the catalog contents.

import {
  TRAP_BINDINGS as GENERATED_BINDINGS,
  ERROR_CLASS_TO_TRAP_ID as GENERATED_ERROR_CLASS_MAP,
  TrapIds as GENERATED_TRAP_IDS,
} from "./generated/bindings.ts";

// The docs-URL / slug logic lives in the ./docs-url.ts leaf module (no
// bootstrap cycle with codegen) and is re-exported here so external code
// keeps importing it from the package root. scripts/generate-traps-package
// .mjs imports the SAME module by relative path, so the docsUrl baked into
// the generated bindings and the docsUrl this package exports at runtime
// are computed by one function. The index.test.ts regression lock pins
// that equality forever.
export { DOCS_BASE_URL, docsUrlFor, githubAnchor } from "./docs-url.ts";

export type TrapId = `MS${string}`;

export type TrapSeverity = "error" | "warning" | "info";
export type TrapDetection = "static" | "config" | "runtime" | "advisory";

/**
 * Runtime view of a single trap catalog entry. Carries the fields a
 * backend operator or AI assistant needs to act on a logged error: human
 * title, severity/detection class, summary/symptom/fix prose, and a
 * `docsUrl` pointing at the rendered catalog entry. Optional `siblings`
 * cross-reference the inverse-failure / dual-context relationships
 * documented in data/traps.json. Other catalog fields (tags, enforcement
 * script, since-version) stay out of the runtime bundle; consult
 * data/traps.json or the rendered AGENTS.md for the full record.
 */
export interface TrapBinding {
  readonly id: TrapId;
  readonly title: string;
  readonly severity: TrapSeverity;
  readonly detection: TrapDetection;
  readonly summary: string;
  readonly symptom: string;
  readonly fix: string;
  readonly docsUrl: string;
  readonly deprecated?: boolean;
  readonly siblings?: ReadonlyArray<TrapId>;
  readonly errorClasses?: ReadonlyArray<string>;
}

/**
 * Marker interface every Mobile Surfaces error implements (via the
 * `MobileSurfacesError` base class). External code that needs to log
 * `trapId` + `docsUrl` without depending on the concrete class hierarchy
 * can narrow against this interface.
 */
export interface TrapBound {
  readonly trapId: TrapId | undefined;
  readonly docsUrl: string | undefined;
}

/**
 * Diagnostic-shaped breadcrumb every host-side reporter can stamp on
 * structured logs. Distinct from TrapBound so it doesn't require an Error
 * instance.
 */
export interface TrapBoundDiagnostic {
  readonly trapId?: TrapId;
  readonly docsUrl?: string;
}

/**
 * Base class for every error class in the Mobile Surfaces monorepo:
 *
 *   - @mobile-surfaces/push          (ApnsError + subclasses, MissingApnsConfigError, ...)
 *   - @mobile-surfaces/surface-contracts  (InvalidSnapshotError, ...)
 *   - @mobile-surfaces/live-activity (LiveActivityNativeError)
 *   - @mobile-surfaces/validators
 *
 * `trapId` and `docsUrl` are resolved lazily off `this.name`, so subclasses
 * only need to assign `this.name = "FooError"` in their constructor. The
 * lookup table is the generated `ERROR_CLASS_TO_TRAP_ID` map; classes that
 * are not bound to a trap return `undefined` for both fields.
 */
export abstract class MobileSurfacesError extends Error implements TrapBound {
  get trapId(): TrapId | undefined {
    return trapIdForErrorClass(this.name);
  }

  get docsUrl(): string | undefined {
    return docsUrlForErrorClass(this.name);
  }
}

/**
 * Look up a trap binding by its catalog id (e.g. "MS018"). Returns
 * `undefined` for unknown ids or for ids not present in the bundled
 * runtime subset.
 */
export function findTrap(trapId: string): TrapBinding | undefined {
  return GENERATED_BINDINGS.get(trapId as TrapId);
}

/**
 * Look up a trap binding by the name of an error class that surfaces it
 * (e.g. "TopicDisallowedError"). Returns `undefined` for classes with no
 * catalog binding (most SDK self-correctness classes — see the
 * "intentionally unbound" allowlist in
 * scripts/check-trap-error-binding.mjs).
 */
export function findTrapByErrorClass(name: string): TrapBinding | undefined {
  const id = GENERATED_ERROR_CLASS_MAP[name];
  return id ? GENERATED_BINDINGS.get(id) : undefined;
}

/**
 * Resolve the trap id for an error class name, or `undefined`.
 */
export function trapIdForErrorClass(name: string): TrapId | undefined {
  return GENERATED_ERROR_CLASS_MAP[name];
}

/**
 * Resolve the docs URL for an error class name, or `undefined`.
 */
export function docsUrlForErrorClass(name: string): string | undefined {
  return findTrapByErrorClass(name)?.docsUrl;
}

/**
 * Typed constant for every live (non-deprecated) trap id, so consumers
 * can write `TrapIds.MS012` and let tsc flag typos at compile time.
 */
export const TrapIds: Readonly<Record<string, TrapId>> = GENERATED_TRAP_IDS;

/**
 * All bindings, indexed by id, including deprecated entries. Consumers
 * filter on `.deprecated` as needed; the renderer's "Retired ids" section
 * pulls from these.
 */
export const TRAP_BINDINGS: ReadonlyMap<TrapId, TrapBinding> =
  GENERATED_BINDINGS;

/**
 * Forward map from error-class name to trap id. Exposed for test
 * fixtures and log aggregators that want to bucket errors by binding
 * without instantiating one of each class. Most consumers should reach
 * for `trapIdForErrorClass` / `findTrapByErrorClass` instead.
 */
export const ERROR_CLASS_TO_TRAP_ID: Readonly<Record<string, TrapId>> =
  GENERATED_ERROR_CLASS_MAP;
