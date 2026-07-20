/**
 * Built-In Source — Discovers extensions from a local directory.
 *
 * This is the only Source implementation in Phase 1.
 * It reads manifest.json files from a known local path
 * (served by Vite from the `public/` directory).
 *
 * No network calls — fetch() here is local file serving.
 */

import type { Extension, ExtensionId } from "../types";
import type { SourceExtension, SourceQueryResult } from "./index";
import { loadManifestFromObject } from "../manifests";
import { ManifestParseError, ManifestValidationError, SchemaVersionUnsupportedError } from "../errors";
import { tryCreateDeclarativeExtension } from "../declarative/wireExtensionRuntime";

// =============================================================================
// Known built-in Extension runtime factories
// =============================================================================

/**
 * Maps built-in extension directory names to their runtime factories.
 * When a factory is present, SourceManager will register the Extension
 * instance into the Registry alongside the manifest.
 *
 * Adding a new built-in extension: add its dirName here and import the factory.
 * No changes to SourceManager, ExtensionManager, or Settings UI needed.
 */
const BUILTIN_EXTENSION_FACTORIES: Record<string, () => Promise<Extension>> = {
  opensteamtool: async () => {
    const { getOpenSteamToolExtension } = await import("../builtin/opensteamtool");
    return getOpenSteamToolExtension();
  },
};

// =============================================================================
// BuiltInSource
// =============================================================================

/** Base path for built-in extensions (served by Vite from public/). */
const BUILTIN_BASE_PATH = "/extensions/builtin";

/** Known built-in extension directory names. */
const BUILTIN_EXTENSION_DIRS = ["placeholder", "opensteamtool"];

/**
 * BuiltInSource discovers extensions from a known local directory.
 * It does NOT scan — it uses a hardcoded list of built-in extension
 * directory names and fetches their manifest.json files.
 */
export class BuiltInSource {
  readonly id = "builtin";
  readonly displayName = "Built-in Extensions";
  readonly priority = 0;
  readonly enabled = true;

  /**
   * Discover all built-in extensions by loading their manifest.json files.
   */
  async discover(): Promise<SourceQueryResult> {
    const extensions: SourceExtension[] = [];
    const errors: Array<{ path: string; error: string }> = [];

    for (const dirName of BUILTIN_EXTENSION_DIRS) {
      const manifestPath = `${BUILTIN_BASE_PATH}/${dirName}/manifest.json`;
      try {
        const response = await fetch(manifestPath);
        if (!response.ok) {
          errors.push({ path: manifestPath, error: `HTTP ${response.status}` });
          continue;
        }
        const raw = await response.json();
        const manifest = loadManifestFromObject(raw, { path: manifestPath });

        // Attach Extension runtime if a factory is registered for this dirName.
        // Otherwise, fall back to DeclarativeExtension via shared helper.
        let extension: Extension | undefined;
        const factory = BUILTIN_EXTENSION_FACTORIES[dirName];
        if (factory) {
          try {
            extension = await factory();
          } catch (err) {
            // Runtime factory failure is non-fatal — manifest still registered
            console.warn(`[BUILTIN_SOURCE] Failed to load runtime for ${dirName}:`, err);
          }
        } else {
          extension = await tryCreateDeclarativeExtension(manifest);
        }

        extensions.push({
          manifest,
          sourceId: this.id,
          metadata: { dirName, manifestPath },
          extension,
        });
      } catch (err) {
        if (err instanceof ManifestParseError || err instanceof ManifestValidationError || err instanceof SchemaVersionUnsupportedError) {
          errors.push({ path: manifestPath, error: err.message });
        } else {
          errors.push({ path: manifestPath, error: String(err) });
        }
      }
    }

    return {
      extensions,
      success: errors.length === 0,
      errors,
      queriedAt: Date.now(),
    };
  }

  /**
   * Find a specific built-in extension by ID.
   */
  async findById(extensionId: ExtensionId): Promise<SourceExtension | null> {
    const result = await this.discover();
    return result.extensions.find((e) => e.manifest.id === extensionId) ?? null;
  }

  /**
   * Check if a specific built-in extension is available.
   */
  async isAvailable(extensionId: ExtensionId): Promise<boolean> {
    return (await this.findById(extensionId)) !== null;
  }

  /**
   * Initialize (no-op for built-in source).
   */
  async initialize(): Promise<void> {}

  /**
   * Destroy (no-op for built-in source).
   */
  async destroy(): Promise<void> {}
}
