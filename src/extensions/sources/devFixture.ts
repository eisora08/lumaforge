/**
 * Development Fixture Extension Source — Safe, deterministic test extensions.
 *
 * Available only in development mode (import.meta.env.DEV).
 * Explicitly enabled. Isolated. Not included in production projection.
 *
 * Fixtures request safe metadata or UI permissions only.
 * They contain no installer, no updater, no managed external binaries,
 * no Steam modification behavior, and are clearly marked as development fixtures.
 */

import type { ExtensionManifestV1 } from "../types";
import type { SourceExtension, SourceQueryResult } from "./index";

// =============================================================================
// Development Mode Detection
// =============================================================================

let _devModeOverride: boolean | null = null;

/**
 * Override dev mode detection (for testing only).
 */
export function setDevModeOverride(value: boolean | null): void {
  _devModeOverride = value;
}

/**
 * Check if running in development mode.
 */
export function isDevMode(): boolean {
  if (_devModeOverride !== null) return _devModeOverride;
  try {
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
}

// =============================================================================
// Safe Development Fixtures
// =============================================================================

/**
 * Safe development fixture manifests.
 * Each requests only safe metadata or UI permissions.
 * None contain installers, updaters, or managed external binaries.
 */
const DEV_FIXTURE_MANIFESTS: ExtensionManifestV1[] = [
  {
    schemaVersion: 1,
    id: "dev-sample-metadata-provider",
    name: "dev-sample-metadata-provider",
    displayName: "Sample Metadata Provider",
    description: "Development fixture that demonstrates metadata provider contributions.",
    version: "0.1.0-dev",
    author: "LumaForge Dev",
    license: "MIT",
    managedFiles: [],
    permissions: [
      { id: "ui.settings", reason: "Add settings surface contribution", optional: true },
    ],
    capabilities: [
      { id: "metadata-provider", version: "0.1.0", description: "Sample metadata provider" },
    ],
    metadata: {
      surfaces: ["settings", "library"],
      devFixture: true,
    },
  },
  {
    schemaVersion: 1,
    id: "dev-sample-artwork-provider",
    name: "dev-sample-artwork-provider",
    displayName: "Sample Artwork Provider",
    description: "Development fixture that demonstrates artwork provider contributions.",
    version: "0.1.0-dev",
    author: "LumaForge Dev",
    license: "MIT",
    managedFiles: [],
    permissions: [
      { id: "ui.settings", reason: "Add settings surface contribution", optional: true },
    ],
    capabilities: [
      { id: "media-provider", version: "0.1.0", description: "Sample artwork provider" },
    ],
    metadata: {
      surfaces: ["settings"],
      devFixture: true,
    },
  },
  {
    schemaVersion: 1,
    id: "dev-sample-save-profile-provider",
    name: "dev-sample-save-profile-provider",
    displayName: "Sample Save Profile Provider",
    description: "Development fixture that demonstrates save profile contributions.",
    version: "0.1.0-dev",
    author: "LumaForge Dev",
    license: "MIT",
    managedFiles: [],
    permissions: [
      { id: "ui.settings", reason: "Add settings surface contribution", optional: true },
    ],
    capabilities: [
      { id: "save-manager", version: "0.1.0", description: "Sample save profile provider" },
    ],
    metadata: {
      surfaces: ["settings", "cloud-backup"],
      devFixture: true,
    },
  },
  {
    schemaVersion: 1,
    id: "dev-sample-tools-extension",
    name: "dev-sample-tools-extension",
    displayName: "Sample Tools Information Extension",
    description: "Development fixture that demonstrates tools surface contributions.",
    version: "0.1.0-dev",
    author: "LumaForge Dev",
    license: "MIT",
    managedFiles: [],
    permissions: [
      { id: "ui.settings", reason: "Add settings surface contribution", optional: true },
    ],
    capabilities: [
      { id: "launcher-integration", version: "0.1.0", description: "Sample tools extension" },
    ],
    metadata: {
      surfaces: ["settings", "tools"],
      devFixture: true,
    },
  },
];

// =============================================================================
// DevFixtureSource
// =============================================================================

/**
 * Development Fixture Source — provides safe, deterministic test extensions.
 *
 * Only available in development mode.
 * Explicitly enabled. Isolated from production.
 * Fixtures request safe permissions only.
 */
export class DevFixtureSource {
  readonly id = "dev-fixture";
  readonly displayName = "Development Fixtures";
  readonly priority = 1000; // Lowest priority
  readonly enabled = true;

  async discover(): Promise<SourceQueryResult> {
    if (!isDevMode()) {
      return { extensions: [], success: true, queriedAt: Date.now() };
    }

    const extensions: SourceExtension[] = DEV_FIXTURE_MANIFESTS.map((manifest) => ({
      manifest,
      sourceId: this.id,
      metadata: { devFixture: true },
    }));

    return {
      extensions,
      success: true,
      queriedAt: Date.now(),
    };
  }

  async findById(extensionId: string): Promise<SourceExtension | null> {
    if (!isDevMode()) return null;
    const manifest = DEV_FIXTURE_MANIFESTS.find((m) => m.id === extensionId);
    if (!manifest) return null;
    return {
      manifest,
      sourceId: this.id,
      metadata: { devFixture: true },
    };
  }

  async isAvailable(extensionId: string): Promise<boolean> {
    if (!isDevMode()) return false;
    return DEV_FIXTURE_MANIFESTS.some((m) => m.id === extensionId);
  }

  async initialize(): Promise<void> {}
  async destroy(): Promise<void> {}
}

/**
 * Get all dev fixture manifests (for testing).
 */
export function getDevFixtureManifests(): ExtensionManifestV1[] {
  return [...DEV_FIXTURE_MANIFESTS];
}
