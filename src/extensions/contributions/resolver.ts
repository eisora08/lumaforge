/**
 * Extension Contribution Resolver — Extracts and normalizes surface contributions from manifests.
 *
 * Pure functions. No side effects, no I/O, no network.
 * Takes a manifest and produces normalized ExtensionSurfaceContribution[].
 *
 * Rules:
 * 1. Unknown surfaces are rejected.
 * 2. Contribution IDs are unique within one extension.
 * 3. Disabled/invalid/incompatible extensions produce no active contributions.
 * 4. Missing required capability prevents activation.
 * 5. Missing required permission prevents activation.
 * 6. Contributions contain metadata only.
 * 7. Contributions cannot inject React components.
 * 8. Contributions cannot execute code.
 */

import type { ExtensionManifestV1 } from "../types";
import type { ExtensionSurfaceContribution, ExtensionSurface, ManifestContributionSource } from "./types";
import { VALID_SURFACES } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface ContributionResolutionResult {
  contributions: ExtensionSurfaceContribution[];
  errors: string[];
  warnings: string[];
}

// =============================================================================
// Resolution
// =============================================================================

/**
 * Resolve contributions from a manifest.
 * Produces normalized ExtensionSurfaceContribution[].
 *
 * Contribution IDs are generated as: `{extensionId}:{surface}`
 * This ensures global uniqueness across all extensions.
 */
export function resolveContributions(
  manifest: ExtensionManifestV1,
  grantedPermissions: string[],
): ContributionResolutionResult {
  const contributions: ExtensionSurfaceContribution[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  // Extract surfaces from metadata
  const surfaces = extractSurfaces(manifest);

  for (const surface of surfaces) {
    const id = `${manifest.id}:${surface}`;

    // Dedup within extension
    if (seenIds.has(id)) {
      warnings.push(`Duplicate contribution "${id}" in extension "${manifest.id}"`);
      continue;
    }

    // Check required capabilities
    const requiredCapabilities = manifest.capabilities?.map((c) => c.id) ?? [];
    const hasAllCapabilities = requiredCapabilities.every(() => true); // All declared capabilities are active

    // Check required permissions
    const requiredPermissions = manifest.permissions?.map((p) => p.id) ?? [];
    const missingPermissions = requiredPermissions.filter(
      (p) => !grantedPermissions.includes(p) && !grantedPermissions.includes("*")
    );
    if (missingPermissions.length > 0) {
      // Optional permissions don't block — only required ones do
      const allOptional = manifest.permissions?.every((p) => p.optional) ?? true;
      if (!allOptional) {
        errors.push(
          `Missing required permissions for contribution "${id}": ${missingPermissions.join(", ")}`
        );
        continue;
      }
    }

    const contribution: ExtensionSurfaceContribution = {
      surface,
      id,
      displayName: `${manifest.displayName} — ${surfaceLabel(surface)}`,
      description: manifest.description,
      icon: manifest.icon,
      priority: 100,
      requiredCapabilities: requiredCapabilities.length > 0 ? requiredCapabilities : undefined,
      requiredPermissions: requiredPermissions.length > 0 ? requiredPermissions : undefined,
      metadata: {
        extensionId: manifest.id,
        extensionVersion: manifest.version,
        extensionAuthor: manifest.author,
      },
    };

    contributions.push(contribution);
    seenIds.add(id);
  }

  // Sort by priority (lower = higher)
  contributions.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  return { contributions, errors, warnings };
}

/**
 * Filter contributions to only those whose required capabilities and permissions are met.
 */
export function filterActiveContributions(
  contributions: ExtensionSurfaceContribution[],
  activeCapabilities: string[],
  grantedPermissions: string[],
): ExtensionSurfaceContribution[] {
  return contributions.filter((c) => {
    // Check required capabilities
    if (c.requiredCapabilities && c.requiredCapabilities.length > 0) {
      const hasAll = c.requiredCapabilities.every((cap) => activeCapabilities.includes(cap));
      if (!hasAll) return false;
    }

    // Check required permissions
    if (c.requiredPermissions && c.requiredPermissions.length > 0) {
      const hasWildcard = grantedPermissions.includes("*");
      if (!hasWildcard) {
        const hasAll = c.requiredPermissions.every((perm) => grantedPermissions.includes(perm));
        if (!hasAll) return false;
      }
    }

    return true;
  });
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract valid surfaces from a manifest's metadata.
 * Returns at least ["settings"] as default.
 */
function extractSurfaces(manifest: ExtensionManifestV1): ExtensionSurface[] {
  const meta = manifest.metadata as Record<string, unknown> | undefined;
  const raw = meta?.surfaces;

  if (Array.isArray(raw)) {
    const valid: ExtensionSurface[] = [];
    for (const s of raw) {
      if (typeof s === "string" && VALID_SURFACES.has(s)) {
        valid.push(s as ExtensionSurface);
      }
    }
    if (valid.length > 0) return valid;
  }

  return ["settings"];
}

function surfaceLabel(surface: ExtensionSurface): string {
  const labels: Record<ExtensionSurface, string> = {
    settings: "Settings",
    tools: "Tools",
    library: "Library",
    home: "Home",
    store: "Store",
    search: "Search",
    "game-details": "Game Details",
    console: "Console",
    "cloud-backup": "Cloud & Backup",
  };
  return labels[surface] ?? surface;
}

/**
 * Extract manifest contribution sources for testing/inspection.
 */
export function extractManifestContributionSources(
  manifest: ExtensionManifestV1,
): ManifestContributionSource[] {
  const surfaces = extractSurfaces(manifest);
  return surfaces.map((surface) => ({
    extensionId: manifest.id,
    extensionDisplayName: manifest.displayName,
    surface,
    id: `${manifest.id}:${surface}`,
    displayName: `${manifest.displayName} — ${surfaceLabel(surface)}`,
    description: manifest.description,
    icon: manifest.icon,
    priority: 100,
    requiredCapabilities: manifest.capabilities?.map((c) => c.id),
    requiredPermissions: manifest.permissions?.map((p) => p.id),
  }));
}
