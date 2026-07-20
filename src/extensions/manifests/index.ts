/**
 * Manifest Loader — Parse and validate extension manifests.
 *
 * Pure functions: no file I/O, no side effects, no network calls.
 * Accepts raw JSON objects and returns typed ExtensionManifestV1 or throws typed errors.
 *
 * Validation pipeline:
 * 1. Type check (must be a non-null object)
 * 2. Schema version check (must be 1)
 * 3. Required field presence
 * 4. Field format validation (ID regex, SemVer, etc.)
 * 5. Managed files validation
 * 6. Permissions format validation
 * 7. Capabilities format validation
 */

import type { ExtensionManifestV1, ManagedFileDescriptor } from "../types";
import { VALIDATION_PATTERNS, MAX_LENGTHS } from "../types";
import {
  ManifestParseError,
  ManifestValidationError,
  SchemaVersionUnsupportedError,
} from "../errors";

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a raw JSON string into a validated ExtensionManifestV1.
 * @throws {ManifestParseError} if JSON is invalid
 * @throws {ManifestValidationError} if manifest fields are invalid
 * @throws {SchemaVersionUnsupportedError} if schemaVersion is not supported
 */
export function loadManifestFromString(json: string, opts?: { path?: string }): ExtensionManifestV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new ManifestParseError("Invalid JSON", { path: opts?.path, cause });
  }
  return loadManifestFromObject(parsed, opts);
}

/**
 * Validate a raw object into a typed ExtensionManifestV1.
 * @throws {ManifestParseError} if the object is not a valid manifest structure
 * @throws {ManifestValidationError} if manifest fields are invalid
 * @throws {SchemaVersionUnsupportedError} if schemaVersion is not supported
 */
export function loadManifestFromObject(raw: unknown, opts?: { path?: string }): ExtensionManifestV1 {
  // 1. Type check
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ManifestParseError("Manifest must be a non-null object", { path: opts?.path });
  }

  const obj = raw as Record<string, unknown>;

  // 2. Schema version
  const schemaVersion = obj.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    throw new ManifestValidationError("schemaVersion", "Must be an integer", { path: opts?.path });
  }
  if (schemaVersion !== 1) {
    throw new SchemaVersionUnsupportedError(schemaVersion, { path: opts?.path });
  }

  // 3. Required fields
  requireString(obj, "id", opts?.path);
  requireString(obj, "name", opts?.path);
  requireString(obj, "displayName", opts?.path);
  requireString(obj, "description", opts?.path);
  requireString(obj, "version", opts?.path);

  // 4. Format validation
  validateField("id", obj.id as string, VALIDATION_PATTERNS.EXTENSION_ID, opts?.path, "Lowercase alphanumeric with hyphens (max 64 chars)");
  validateField("name", obj.name as string, VALIDATION_PATTERNS.EXTENSION_NAME, opts?.path, "Lowercase alphanumeric with hyphens (max 64 chars)");
  validateMaxLength("displayName", obj.displayName as string, MAX_LENGTHS.DISPLAY_NAME, opts?.path);
  validateMaxLength("description", obj.description as string, MAX_LENGTHS.DESCRIPTION, opts?.path);
  validateField("version", obj.version as string, VALIDATION_PATTERNS.SEMVER, opts?.path, "Must be valid SemVer 2.0.0");

  // 5. Optional string fields with max lengths
  if (obj.summary !== undefined) {
    requireString(obj, "summary", opts?.path);
    validateMaxLength("summary", obj.summary as string, MAX_LENGTHS.SUMMARY, opts?.path);
  }
  if (obj.author !== undefined) {
    requireString(obj, "author", opts?.path);
    validateMaxLength("author", obj.author as string, MAX_LENGTHS.AUTHOR, opts?.path);
  }
  if (obj.longDescription !== undefined) {
    requireString(obj, "longDescription", opts?.path);
    validateMaxLength("longDescription", obj.longDescription as string, MAX_LENGTHS.LONG_DESCRIPTION, opts?.path);
  }
  if (obj.homepage !== undefined) {
    requireString(obj, "homepage", opts?.path);
    if (!(VALIDATION_PATTERNS.URL as RegExp).test(obj.homepage as string)) {
      throw new ManifestValidationError("homepage", "Must be a valid URL", { path: opts?.path });
    }
  }
  if (obj.repository !== undefined) {
    requireString(obj, "repository", opts?.path);
    if (!(VALIDATION_PATTERNS.URL as RegExp).test(obj.repository as string)) {
      throw new ManifestValidationError("repository", "Must be a valid URL", { path: opts?.path });
    }
  }
  if (obj.license !== undefined) {
    requireString(obj, "license", opts?.path);
  }

  // 6. Managed files
  if (!Array.isArray(obj.managedFiles)) {
    throw new ManifestValidationError("managedFiles", "Must be an array", { path: opts?.path });
  }
  const managedFiles = obj.managedFiles as unknown[];
  for (let i = 0; i < managedFiles.length; i++) {
    const file = managedFiles[i];
    if (!file || typeof file !== "object") {
      throw new ManifestValidationError(`managedFiles[${i}]`, "Must be an object", { path: opts?.path });
    }
    const fileObj = file as Record<string, unknown>;
    if (typeof fileObj.path !== "string" || !fileObj.path) {
      throw new ManifestValidationError(`managedFiles[${i}].path`, "Must be a non-empty string", { path: opts?.path });
    }
    if (!(VALIDATION_PATTERNS.RELATIVE_PATH as RegExp).test(fileObj.path as string)) {
      throw new ManifestValidationError(`managedFiles[${i}].path`, "Must be a valid relative path", { path: opts?.path });
    }
  }

  // 7. Permissions format
  if (obj.permissions !== undefined) {
    if (!Array.isArray(obj.permissions)) {
      throw new ManifestValidationError("permissions", "Must be an array", { path: opts?.path });
    }
    for (let i = 0; i < (obj.permissions as unknown[]).length; i++) {
      const perm = (obj.permissions as unknown[])[i];
      if (!perm || typeof perm !== "object") {
        throw new ManifestValidationError(`permissions[${i}]`, "Must be an object", { path: opts?.path });
      }
      const permObj = perm as Record<string, unknown>;
      if (typeof permObj.id !== "string" || !permObj.id) {
        throw new ManifestValidationError(`permissions[${i}].id`, "Must be a non-empty string", { path: opts?.path });
      }
    }
  }

  // 8. Capabilities format
  if (obj.capabilities !== undefined) {
    if (!Array.isArray(obj.capabilities)) {
      throw new ManifestValidationError("capabilities", "Must be an array", { path: opts?.path });
    }
    for (let i = 0; i < (obj.capabilities as unknown[]).length; i++) {
      const cap = (obj.capabilities as unknown[])[i];
      if (!cap || typeof cap !== "object") {
        throw new ManifestValidationError(`capabilities[${i}]`, "Must be an object", { path: opts?.path });
      }
      const capObj = cap as Record<string, unknown>;
      if (typeof capObj.id !== "string" || !capObj.id) {
        throw new ManifestValidationError(`capabilities[${i}].id`, "Must be a non-empty string", { path: opts?.path });
      }
    }
  }

  // 9. Categories / tags
  if (obj.categories !== undefined) {
    if (!Array.isArray(obj.categories) || (obj.categories as unknown[]).length > 3) {
      throw new ManifestValidationError("categories", "Must be an array with at most 3 items", { path: opts?.path });
    }
  }
  if (obj.tags !== undefined) {
    if (!Array.isArray(obj.tags)) {
      throw new ManifestValidationError("tags", "Must be an array", { path: opts?.path });
    }
  }

  // 10. Strategies (optional, type-checked)
  if (obj.installStrategy !== undefined) {
    validateStrategy(obj.installStrategy, "installStrategy", opts?.path);
  }
  if (obj.toggleStrategy !== undefined) {
    validateStrategy(obj.toggleStrategy, "toggleStrategy", opts?.path);
  }
  if (obj.updateStrategy !== undefined) {
    validateStrategy(obj.updateStrategy, "updateStrategy", opts?.path);
  }

  // 11. Release provider (optional)
  if (obj.releaseProvider !== undefined) {
    if (!obj.releaseProvider || typeof obj.releaseProvider !== "object") {
      throw new ManifestValidationError("releaseProvider", "Must be an object", { path: opts?.path });
    }
    const rp = obj.releaseProvider as Record<string, unknown>;
    if (typeof rp.provider !== "string" || !rp.provider) {
      throw new ManifestValidationError("releaseProvider.provider", "Must be a non-empty string", { path: opts?.path });
    }
    if (!rp.config || typeof rp.config !== "object") {
      throw new ManifestValidationError("releaseProvider.config", "Must be an object", { path: opts?.path });
    }
  }

  // 12. Criteria (optional, validated)
  if (obj.criteria !== undefined) {
    validateCriteria(obj.criteria, opts?.path);
  }

  // Build the validated manifest — strip unknown top-level keys
  const manifest: ExtensionManifestV1 = {
    schemaVersion: 1,
    id: obj.id as string,
    name: obj.name as string,
    displayName: obj.displayName as string,
    description: obj.description as string,
    version: obj.version as string,
    managedFiles: obj.managedFiles as ManagedFileDescriptor[],
  };

  // Copy optional fields
  const optionalKeys: (keyof ExtensionManifestV1)[] = [
    "longDescription", "summary", "author", "authorEmail", "homepage",
    "repository", "license", "icon", "banner", "screenshots",
    "categories", "tags", "minimumLauncherVersion", "maximumLauncherVersion",
    "permissions", "capabilities", "installStrategy", "toggleStrategy",
    "updateStrategy", "releaseProvider", "behavior", "criteria", "validation", "metadata",
  ];
  for (const key of optionalKeys) {
    if (obj[key] !== undefined) {
      (manifest as unknown as Record<string, unknown>)[key] = obj[key];
    }
  }

  return manifest;
}

// =============================================================================
// Helpers
// =============================================================================

function requireString(obj: Record<string, unknown>, field: string, path?: string): void {
  if (typeof obj[field] !== "string" || !obj[field]) {
    throw new ManifestValidationError(field, "Must be a non-empty string", { path });
  }
}

function validateField(
  field: string,
  value: string,
  pattern: RegExp,
  path?: string,
  hint?: string,
): void {
  if (!pattern.test(value)) {
    throw new ManifestValidationError(field, hint ?? `Does not match required pattern`, { path });
  }
}

function validateMaxLength(field: string, value: string, max: number, path?: string): void {
  if (value.length > max) {
    throw new ManifestValidationError(field, `Maximum length is ${max} characters`, { path });
  }
}

function validateCriteria(criteria: unknown, path?: string): void {
  if (!criteria || typeof criteria !== "object") {
    throw new ManifestValidationError("criteria", "Must be a non-null object", { path });
  }
  const c = criteria as Record<string, unknown>;

  // detection (optional)
  if (c.detection !== undefined) {
    validateDetectionCriteria(c.detection, path);
  }
}

function validateDetectionCriteria(detection: unknown, path?: string): void {
  if (!detection || typeof detection !== "object") {
    throw new ManifestValidationError("criteria.detection", "Must be a non-null object", { path });
  }
  const d = detection as Record<string, unknown>;

  if (d.type !== "files_presence") {
    throw new ManifestValidationError("criteria.detection.type", 'Must be "files_presence"', { path });
  }

  if (!Array.isArray(d.paths) || (d.paths as unknown[]).length === 0) {
    throw new ManifestValidationError("criteria.detection.paths", "Must be a non-empty array of strings", { path });
  }
  for (let i = 0; i < (d.paths as unknown[]).length; i++) {
    if (typeof (d.paths as unknown[])[i] !== "string") {
      throw new ManifestValidationError(`criteria.detection.paths[${i}]`, "Must be a string", { path });
    }
  }
}

function validateStrategy(obj: unknown, field: string, path?: string): void {
  if (!obj || typeof obj !== "object") {
    throw new ManifestValidationError(field, "Must be an object", { path });
  }
  const strategy = obj as Record<string, unknown>;
  if (typeof strategy.type !== "string" || !strategy.type) {
    throw new ManifestValidationError(`${field}.type`, "Must be a non-empty string", { path });
  }
}
