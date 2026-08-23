/**
 * Extension Surface Contribution Types — Normalized contribution model.
 *
 * Runtime-only types for describing what an extension contributes to each surface.
 * These types are derived from manifests at registration time and stored in
 * ExtensionRuntimeRecord.activeContributions.
 *
 * Contributions contain metadata only. They cannot inject React components,
 * execute code, or carry executable payloads.
 */

// =============================================================================
// Supported Surfaces
// =============================================================================

/**
 * Surfaces where extensions can contribute metadata.
 * Unknown surface IDs are rejected at registration time.
 */
export type ExtensionSurface =
  | "settings"
  | "tools"
  | "library"
  | "home"
  | "store"
  | "search"
  | "game-details"
  | "console"
  | "cloud-backup";

/** Set of all valid surface IDs for O(1) lookup. */
export const VALID_SURFACES: ReadonlySet<string> = new Set<ExtensionSurface>([
  "settings",
  "tools",
  "library",
  "home",
  "store",
  "search",
  "game-details",
  "console",
  "cloud-backup",
]);

// =============================================================================
// Contribution
// =============================================================================

/**
 * A single surface contribution from an extension.
 *
 * Contributions are metadata-only. They carry display information
 * that the launcher can render in its own UI framework. They cannot
 * inject React components, execute JavaScript, or reference external binaries.
 */
export interface ExtensionSurfaceContribution {
  /** Which surface this contribution targets. */
  surface: ExtensionSurface;

  /** Unique contribution ID within the extension. */
  id: string;

  /** Human-readable display name. */
  displayName: string;

  /** Short description. */
  description?: string;

  /** Icon identifier (lucide icon name or extension-specific key). */
  icon?: string;

  /** Display priority (lower = higher priority, default 100). */
  priority?: number;

  /** Capabilities required to activate this contribution. */
  requiredCapabilities?: string[];

  /** Permissions required to activate this contribution. */
  requiredPermissions?: string[];

  /** Arbitrary metadata for the surface to interpret. */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Contribution Source
// =============================================================================

/**
 * Extracted contribution-like entries from an ExtensionManifestV1.
 * This is the raw input that the ContributionResolver normalizes.
 */
export interface ManifestContributionSource {
  /** Extension ID that owns this contribution. */
  extensionId: string;

  /** Extension display name. */
  extensionDisplayName: string;

  /** Source surface from metadata or category hints. */
  surface: ExtensionSurface;

  /** Contribution ID (derived from extension ID + surface). */
  id: string;

  /** Display name for the contribution. */
  displayName: string;

  /** Description. */
  description?: string;

  /** Icon. */
  icon?: string;

  /** Priority. */
  priority?: number;

  /** Required capabilities. */
  requiredCapabilities?: string[];

  /** Required permissions. */
  requiredPermissions?: string[];
}
