/**
 * Source Manager — Orchestrates extension discovery across multiple sources.
 *
 * Manages a list of sources (BuiltInSource, RepositorySource, etc.).
 * Queries all sources in priority order, merges results, and registers
 * discovered extensions with the ExtensionManager.
 *
 * Adding a new source type (Directory, Git, URL, Repository) requires
 * ONLY implementing a new Source class and registering it here.
 * No changes to ExtensionManager or Settings UI needed.
 */

import type { ExtensionSource } from "./index";
import type { SourceQueryResult } from "./index";
import { registerLoadedExtension, getRegisteredExtension } from "../manager";
import { registerExtension, hasExtension } from "../registry";
import { SourceLoadError } from "../errors";
import { tryCreateDeclarativeExtension } from "../declarative/wireExtensionRuntime";

const DEBUG_SOURCE_MANAGER = false;

// =============================================================================
// Types
// =============================================================================

export interface SourceManagerResult {
  registered: number;
  skipped: number;
  errors: Array<{ sourceId: string; path: string; error: string }>;
  queriedAt: number;
}

// =============================================================================
// SourceManager (singleton)
// =============================================================================

const _sources: ExtensionSource[] = [];

/**
 * Register a source with the SourceManager.
 */
export function registerSource(source: ExtensionSource): void {
  // Prevent duplicate registrations
  if (_sources.some((s) => s.id === source.id)) return;
  _sources.push(source);
  // Keep sorted by priority (lower = higher priority)
  _sources.sort((a, b) => a.priority - b.priority);
}

/**
 * Get all registered sources.
 */
export function getSources(): readonly ExtensionSource[] {
  return _sources;
}

/**
 * Discover extensions from all sources and register them.
 * Extensions with IDs that are already registered are skipped.
 */
export async function discoverAllSources(): Promise<SourceManagerResult> {
  const registered: number[] = [];
  const skipped: number[] = [];
  const errors: Array<{ sourceId: string; path: string; error: string }> = [];
  const queriedAt = Date.now();

  for (const source of _sources) {
    if (!source.enabled) continue;

    let result: SourceQueryResult;
    try {
      result = await source.discover();
    } catch (err) {
      errors.push({
        sourceId: source.id,
        path: "",
        error: err instanceof SourceLoadError ? err.message : String(err),
      });
      continue;
    }

    // Collect errors from the source
    for (const e of result.errors ?? []) {
      errors.push({ sourceId: source.id, path: e.path, error: e.error });
    }

    // Register extensions (skip duplicates)
    for (const ext of result.extensions) {
      // Wire DeclarativeExtension fallback when source didn't provide a runtime.
      // This covers RepositorySource (and any future source) that discovers
      // manifests but doesn't create Extension instances.
      if (!ext.extension) {
        ext.extension = await tryCreateDeclarativeExtension(ext.manifest) ?? undefined;
      }

      const existing = getRegisteredExtension(ext.manifest.id);
      if (existing) {
        skipped.push(1);
        // Even if manifest is skipped, register Extension runtime if present
        // (higher-priority source may have the runtime while a lower-priority had the manifest first)
        if (ext.extension && !hasExtension(ext.manifest.id)) {
          if (DEBUG_SOURCE_MANAGER) console.log(`[SOURCE_MANAGER][DEBUG] Skipped manifest "${ext.manifest.id}" but registering runtime from "${source.id}"`);
          try {
            registerExtension(ext.extension);
          } catch (err) {
            errors.push({
              sourceId: source.id,
              path: ext.manifest.id,
              error: `Runtime registration failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        } else {
          if (DEBUG_SOURCE_MANAGER) console.log(`[SOURCE_MANAGER][DEBUG] Skipped "${ext.manifest.id}" from "${source.id}": existing=${!!existing}, ext.extension=${!!ext.extension}, hasExt=${hasExtension(ext.manifest.id)}`);
        }
        continue;
      }
      registerLoadedExtension(ext.manifest, source.id);
      registered.push(1);
      if (DEBUG_SOURCE_MANAGER) console.log(`[SOURCE_MANAGER][DEBUG] Registered "${ext.manifest.id}" from "${source.id}", ext.extension=${!!ext.extension}`);

      // Register Extension runtime into Registry if provided by the source
      if (ext.extension && !hasExtension(ext.manifest.id)) {
        try {
          registerExtension(ext.extension);
          if (DEBUG_SOURCE_MANAGER) console.log(`[SOURCE_MANAGER][DEBUG] Registered runtime for "${ext.manifest.id}" into Registry`);
        } catch (err) {
          errors.push({
            sourceId: source.id,
            path: ext.manifest.id,
            error: `Runtime registration failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }
  }

  return {
    registered: registered.length,
    skipped: skipped.length,
    errors,
    queriedAt,
  };
}

/**
 * Reset the SourceManager (for testing).
 */
export function resetSourceManager(): void {
  _sources.length = 0;
}
