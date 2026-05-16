// CLI error hierarchy. Every concrete error the create-mobile-surfaces /
// mobile-surfaces bin throws extends MobileSurfacesError so the structured
// `name`/`trapId`/`docsUrl` lookup in @mobile-surfaces/traps works
// uniformly across the monorepo. Most CLI errors are tooling-environment
// bugs (missing pnpm, missing CocoaPods, corrupt template tarball); those
// stay unbound to the catalog because the failure mode is the CLI refusing
// to proceed, not a silent runtime trap. Audit-mode violations DO carry a
// trapId — they exist precisely to map foreign-project state onto an MS-id.
//
// The exit-code field is the canonical mapping into bin/index.mjs's
// process.exit contract (EXIT_CODES). The bin handler reads err.exitCode
// directly when present, so new subclasses can override without touching
// the catch arm.

import { MobileSurfacesError, findTrap } from "@mobile-surfaces/traps";

/** Base class for every error this CLI throws. */
export class CreateMobileSurfacesError extends MobileSurfacesError {
  constructor(message, { exitCode = 1, cause } = {}) {
    super(message);
    this.name = "CreateMobileSurfacesError";
    this.exitCode = exitCode;
    if (cause !== undefined) this.cause = cause;
  }
}

/** Tooling environment: pnpm missing. No catalog trap (tooling bug, not a silent-failure mode). */
export class PnpmMissingError extends CreateMobileSurfacesError {
  constructor(cause) {
    super(
      "pnpm not found on PATH. The Mobile Surfaces template ships a pnpm-lock.yaml. Enable pnpm with: corepack enable pnpm",
      { exitCode: 2, cause },
    );
    this.name = "PnpmMissingError";
  }
}

/** Tooling environment: cocoapods missing. */
export class CocoapodsMissingError extends CreateMobileSurfacesError {
  constructor(cause) {
    super(
      "CocoaPods not found on PATH. expo prebuild needs it to install iOS pods. Install with: brew install cocoapods (or sudo gem install cocoapods)",
      { exitCode: 2, cause },
    );
    this.name = "CocoapodsMissingError";
  }
}

/** Template load failed. Tooling bug. */
export class TemplateLoadError extends CreateMobileSurfacesError {
  constructor(message, cause) {
    super(`Template error: ${message}`, { exitCode: 3, cause });
    this.name = "TemplateLoadError";
  }
}

/**
 * Apply phase failed and we rolled back. Carries forwarded fields from the
 * underlying apply-summary so bin/index.mjs can still render the same
 * "restored N files" / "rollback errored" prose without reaching into
 * `err.cause` for them.
 */
export class RolledBackError extends CreateMobileSurfacesError {
  constructor(message, { cause, restoredCount, rollbackError } = {}) {
    super(`Apply rolled back: ${message}`, { exitCode: 2, cause });
    this.name = "RolledBackError";
    this.rolledBack = true;
    if (restoredCount !== undefined) this.restoredCount = restoredCount;
    if (rollbackError !== undefined) this.rollbackError = rollbackError;
  }
}

/** Post-commit error — apply succeeded but follow-up (e.g. expo prebuild) failed. */
export class PostCommitError extends CreateMobileSurfacesError {
  constructor(message, cause) {
    super(message, { exitCode: 2, cause });
    this.name = "PostCommitError";
  }
}

/**
 * Audit-mode error: foreign project violates a catalog trap. The trap id
 * is set explicitly (not resolved from `this.name`) because every audit
 * failure routes through this one class — the catalog id is the
 * load-bearing identifier, not the JS class name. trapId/docsUrl getters
 * are pinned to the constructor argument so each instance carries its own.
 */
export class AuditViolationError extends CreateMobileSurfacesError {
  constructor(trapId, message) {
    super(message, { exitCode: 1 });
    this.name = "AuditViolationError";
    Object.defineProperty(this, "trapId", {
      get: () => trapId,
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(this, "docsUrl", {
      get: () => findTrap(trapId)?.docsUrl,
      enumerable: true,
      configurable: true,
    });
  }
}
