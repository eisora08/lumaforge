/**
 * Extension Runtime Manager — Registration pipeline orchestrator.
 *
 * Connects validation, compatibility, contribution resolution, and store insertion.
 * Pure pipeline: no file I/O, no network calls, no side effects beyond the RuntimeStore.
 *
 * Pipeline:
 * manifest → schema validation → identity validation → semver validation
 * → compatibility evaluation → permission declaration → capability validation
 * → contribution resolution → registry insertion → runtime-state publication
 */

import type { ExtensionManifestV1 } from "../types";
import type { ExtensionRuntimeRecord } from "../runtime/types";
import { validateManifest } from "../runtime/validation";
import { evaluateCompatibility } from "../runtime/compatibility";
import { resolveContributions, filterActiveContributions } from "../contributions/resolver";
import {
  registerExtensionRuntime,
  setResolvedContributions,
  enableExtension,
  disableExtension,
  snapshot,
} from "../runtime/store";

// =============================================================================
// Types
// =============================================================================

export interface RegistrationResult {
  record: ExtensionRuntimeRecord;
  stage: string;
  success: boolean;
  error?: string;
}

// =============================================================================
// Registration Pipeline
// =============================================================================

/**
 * Register a manifest through the full pipeline.
 *
 * Pipeline stages:
 * 1. Schema validation
 * 2. Identity validation
 * 3. Semantic-version validation
 * 4. Compatibility evaluation
 * 5. Permission declaration validation
 * 6. Capability validation
 * 7. Contribution validation
 * 8. Registry insertion
 * 9. Runtime-state publication
 */
export function registerManifest(
  manifest: ExtensionManifestV1,
  options: {
    sourceId: string;
    builtIn: boolean;
  },
): RegistrationResult {
  // Stage 1-3: Validation (schema, identity, semver, permissions, capabilities)
  const validation = validateManifest(manifest);

  // Stage 4: Compatibility
  const compatibility = evaluateCompatibility(manifest);

  // Stage 5-6: Permissions — granted = all declared permissions
  const grantedPermissions = (manifest.permissions ?? []).map((p) => p.id);

  // Stage 6b: Active capabilities — only when valid + compatible
  const activeCapabilities =
    validation.valid && compatibility.compatible
      ? (manifest.capabilities ?? []).map((c) => c.id)
      : [];

  // Stage 7: Contribution resolution
  const contributionResult = resolveContributions(manifest, grantedPermissions);
  const allContributions = contributionResult.contributions;

  // Filter active contributions (only when valid + compatible)
  const activeContributions =
    validation.valid && compatibility.compatible
      ? filterActiveContributions(allContributions, activeCapabilities, grantedPermissions)
      : [];

  // Stage 8-9: Registry insertion + publication
  const record = registerExtensionRuntime(manifest, {
    sourceId: options.sourceId,
    builtIn: options.builtIn,
    compatibility,
    validation,
    grantedPermissions,
    activeCapabilities,
    activeContributions,
  });

  // Store resolved contributions for enable/disable toggle
  setResolvedContributions(manifest.id, allContributions);

  // Determine stage
  let stage = "complete";
  if (!validation.valid) stage = "validation-failed";
  else if (!compatibility.compatible) stage = "incompatible";

  return {
    record,
    stage,
    success: validation.valid && compatibility.compatible,
    error: validation.errors.length > 0 ? validation.errors.join("; ") : undefined,
  };
}

// =============================================================================
// Bulk Registration
// =============================================================================

/**
 * Register multiple manifests in order.
 * Each manifest is independent — one failure does not block others.
 */
export function registerManifests(
  manifests: ExtensionManifestV1[],
  options: {
    sourceId: string;
    builtIn: boolean;
  },
): RegistrationResult[] {
  return manifests.map((m) => registerManifest(m, options));
}

// =============================================================================
// Enable / Disable
// =============================================================================

/**
 * Enable an extension by ID.
 * Requires valid and compatible record.
 * Activates eligible metadata contributions.
 * Does not activate external software.
 */
export function enableExtensionById(extensionId: string): ExtensionRuntimeRecord | null {
  return enableExtension(extensionId);
}

/**
 * Disable an extension by ID.
 * Removes active contributions. Preserves registration and preferences.
 * Does not uninstall anything.
 */
export function disableExtensionById(extensionId: string): ExtensionRuntimeRecord | null {
  return disableExtension(extensionId);
}

// =============================================================================
// Tools Projection
// =============================================================================

export interface ToolsProjectionItem {
  id: string;
  extensionId: string;
  extensionName: string;
  displayName: string;
  description?: string;
  icon?: string;
  priority?: number;
  source: string;
  builtIn: boolean;
}

/**
 * Project active tools contributions from the RuntimeStore.
 * Returns only active tools contributions from enabled, valid, compatible extensions.
 * Development fixtures are excluded in production mode.
 */
export function projectToolsContributions(isProduction: boolean = false): ToolsProjectionItem[] {
  const snap = snapshot();
  const items: ToolsProjectionItem[] = [];

  for (const record of snap.records.values()) {
    // Skip non-enabled
    if (record.status !== "enabled") continue;

    // Skip invalid and incompatible
    if (!record.validation.valid || !record.compatibility.compatible) continue;

    // Skip dev fixtures in production
    if (isProduction && record.sourceId === "dev-fixture") continue;

    // Filter contributions to tools surface only
    const toolContributions = record.activeContributions.filter(
      (c) => c.surface === "tools"
    );

    for (const contrib of toolContributions) {
      items.push({
        id: contrib.id,
        extensionId: record.manifest.id,
        extensionName: record.manifest.displayName,
        displayName: contrib.displayName,
        description: contrib.description,
        icon: contrib.icon,
        priority: contrib.priority,
        source: record.sourceId,
        builtIn: record.builtIn,
      });
    }
  }

  // Sort by priority
  items.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  return items;
}

// =============================================================================
// Overview Counts
// =============================================================================

export interface RuntimeOverview {
  total: number;
  enabled: number;
  disabled: number;
  incompatible: number;
  invalid: number;
  sourceCount: number;
}

/**
 * Derive overview counts from the current RuntimeStore snapshot.
 */
export function getRuntimeOverview(sourceIds: string[]): RuntimeOverview {
  const snap = snapshot();
  return {
    total: snap.total,
    enabled: snap.enabledCount,
    disabled: snap.disabledCount,
    incompatible: snap.incompatibleCount,
    invalid: snap.invalidCount + snap.errorCount,
    sourceCount: sourceIds.length,
  };
}
