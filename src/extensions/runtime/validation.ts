/**
 * Extension Status Resolver — Validates extension manifests through the registration pipeline.
 *
 * Pure functions. No side effects, no I/O, no network.
 * Reuses VALIDATION_PATTERNS and MAX_LENGTHS from ../types.
 *
 * Pipeline stages:
 * 1. Schema validation (schemaVersion must be 1)
 * 2. Identity validation (id + name format)
 * 3. Semantic-version validation
 * 4. Permission declaration validation
 * 5. Capability declaration validation
 * 6. Contribution validation (surface, uniqueness)
 */

import type { ExtensionManifestV1, PermissionEntry, CapabilityEntry } from "../types";
import { VALIDATION_PATTERNS, MAX_LENGTHS } from "../types";

// =============================================================================
// Types
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// =============================================================================
// Full Validation Pipeline
// =============================================================================

/**
 * Run the full validation pipeline on a manifest.
 * Returns a ValidationResult with all errors and warnings.
 */
export function validateManifest(manifest: ExtensionManifestV1): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Schema validation
  if (manifest.schemaVersion !== 1) {
    errors.push(`Unsupported schema version: ${manifest.schemaVersion}`);
  }

  // 2. Identity validation
  if (!VALIDATION_PATTERNS.EXTENSION_ID.test(manifest.id)) {
    errors.push(
      `Invalid extension ID "${manifest.id}": must match ${VALIDATION_PATTERNS.EXTENSION_ID}`
    );
  }
  if (manifest.id.length > MAX_LENGTHS.EXTENSION_ID) {
    errors.push(`Extension ID exceeds maximum length of ${MAX_LENGTHS.EXTENSION_ID}`);
  }
  if (!VALIDATION_PATTERNS.EXTENSION_NAME.test(manifest.name)) {
    errors.push(
      `Invalid extension name "${manifest.name}": must match ${VALIDATION_PATTERNS.EXTENSION_NAME}`
    );
  }
  if (manifest.displayName.length > MAX_LENGTHS.DISPLAY_NAME) {
    warnings.push(`Display name exceeds ${MAX_LENGTHS.DISPLAY_NAME} characters`);
  }
  if (manifest.description.length > MAX_LENGTHS.DESCRIPTION) {
    warnings.push(`Description exceeds ${MAX_LENGTHS.DESCRIPTION} characters`);
  }

  // 3. Semantic-version validation
  if (!VALIDATION_PATTERNS.SEMVER.test(manifest.version)) {
    errors.push(`Invalid version "${manifest.version}": must be valid SemVer 2.0.0`);
  }

  // 4. Permission validation
  validatePermissions(manifest.permissions, errors);

  // 5. Capability validation
  validateCapabilities(manifest.capabilities, errors, warnings);

  // 6. Contribution validation (surface format)
  validateContributionSurfaces(manifest, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// Permission Validation
// =============================================================================

function validatePermissions(permissions: PermissionEntry[] | undefined, errors: string[]): void {
  if (!permissions) return;

  const seen = new Set<string>();
  for (let i = 0; i < permissions.length; i++) {
    const perm = permissions[i];
    if (!perm.id || typeof perm.id !== "string") {
      errors.push(`Permission[${i}]: missing or invalid id`);
      continue;
    }
    if (!VALIDATION_PATTERNS.PERMISSION.test(perm.id)) {
      errors.push(`Permission[${i}]: invalid permission format "${perm.id}"`);
    }
    if (seen.has(perm.id)) {
      errors.push(`Permission[${i}]: duplicate permission "${perm.id}"`);
    }
    seen.add(perm.id);
  }
}

// =============================================================================
// Capability Validation
// =============================================================================

/**
 * Recognized system capabilities.
 * Extensions must declare their capabilities here to be acknowledged.
 * Unknown capabilities generate a warning but are not rejected.
 */
export const RECOGNIZED_CAPABILITIES = new Set([
  "steam-tool",
  "metadata-provider",
  "save-manager",
  "achievement-provider",
  "launcher-integration",
  "network-service",
  "overlay",
  "game-detection",
  "backup-provider",
  "media-provider",
  "lua-runtime",
]);

function validateCapabilities(
  capabilities: CapabilityEntry[] | undefined,
  errors: string[],
  warnings: string[] = [],
): void {
  if (!capabilities) return;

  const seen = new Set<string>();
  for (let i = 0; i < capabilities.length; i++) {
    const cap = capabilities[i];
    if (!cap.id || typeof cap.id !== "string") {
      errors.push(`Capability[${i}]: missing or invalid id`);
      continue;
    }
    if (!VALIDATION_PATTERNS.CAPABILITY.test(cap.id)) {
      errors.push(`Capability[${i}]: invalid capability format "${cap.id}"`);
    }
    if (seen.has(cap.id)) {
      errors.push(`Capability[${i}]: duplicate capability "${cap.id}"`);
    }
    if (!RECOGNIZED_CAPABILITIES.has(cap.id)) {
      warnings.push(`Capability[${i}]: unrecognized capability "${cap.id}"`);
    }
    seen.add(cap.id);
  }
}

// =============================================================================
// Contribution Surface Validation
// =============================================================================

function validateContributionSurfaces(
  manifest: ExtensionManifestV1,
  errors: string[],
  _warnings: string[],
): void {
  // Contribution surface validation is performed by the ContributionResolver.
  // Here we only validate that metadata.surfaces (if present) contains valid values.
  const meta = manifest.metadata as Record<string, unknown> | undefined;
  if (!meta) return;

  const surfaces = meta.surfaces;
  if (surfaces !== undefined) {
    if (!Array.isArray(surfaces)) {
      errors.push("metadata.surfaces must be an array");
      return;
    }
    const { VALID_SURFACES } = require("../contributions/types");
    for (const s of surfaces) {
      if (typeof s !== "string" || !VALID_SURFACES.has(s)) {
        errors.push(`Unknown surface "${s}"`);
      }
    }
  }
}
