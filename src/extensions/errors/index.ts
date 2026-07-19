/**
 * Extension Runtime Errors — Typed, structured error classes.
 *
 * Every error carries enough detail for the UI to display a useful message.
 * No raw string throws anywhere in the runtime.
 */

// =============================================================================
// Base Error
// =============================================================================

export abstract class ExtensionError extends Error {
  abstract readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.details = details ? { ...details } : {};
  }
}

// =============================================================================
// Manifest Errors
// =============================================================================

export class ManifestParseError extends ExtensionError {
  readonly code = "MANIFEST_PARSE_ERROR";
  readonly details: Record<string, unknown>;

  constructor(message: string, opts: { path?: string; cause?: unknown } = {}) {
    super(message, opts);
    this.details = { path: opts.path, cause: opts.cause };
  }
}

export class ManifestValidationError extends ExtensionError {
  readonly code = "MANIFEST_VALIDATION_ERROR";
  readonly details: Record<string, unknown>;
  readonly field: string;
  readonly reason: string;

  constructor(field: string, reason: string, opts: { path?: string } = {}) {
    super(`Validation failed for "${field}": ${reason}`, opts);
    this.field = field;
    this.reason = reason;
    this.details = { field, reason, path: opts.path };
  }
}

export class SchemaVersionUnsupportedError extends ExtensionError {
  readonly code = "SCHEMA_VERSION_UNSUPPORTED";
  readonly details: Record<string, unknown>;
  readonly schemaVersion: number;

  constructor(schemaVersion: number, opts: { path?: string } = {}) {
    super(`Unsupported schema version: ${schemaVersion}`, opts);
    this.schemaVersion = schemaVersion;
    this.details = { schemaVersion, supported: [1], path: opts.path };
  }
}

// =============================================================================
// Source Errors
// =============================================================================

export class SourceLoadError extends ExtensionError {
  readonly code = "SOURCE_LOAD_ERROR";
  readonly details: Record<string, unknown>;
  readonly sourceId: string;

  constructor(sourceId: string, message: string, opts: { path?: string; cause?: unknown } = {}) {
    super(`Source "${sourceId}": ${message}`, opts);
    this.sourceId = sourceId;
    this.details = { sourceId, path: opts.path, cause: opts.cause };
  }
}

// =============================================================================
// Repository Errors
// =============================================================================

export class RepositoryIndexError extends ExtensionError {
  readonly code = "REPOSITORY_INDEX_ERROR";
  readonly details: Record<string, unknown>;
  readonly repoId: string;

  constructor(repoId: string, message: string, opts: { path?: string; cause?: unknown } = {}) {
    super(`Repository "${repoId}": ${message}`, opts);
    this.repoId = repoId;
    this.details = { repoId, path: opts.path, cause: opts.cause };
  }
}
