/**
 * Repository Source — Discovers extensions from a remote index.json over HTTP.
 *
 * Fetches a repository index (index.json) from a configured URL,
 * resolves each extension entry to its manifest.json, validates them,
 * and returns a SourceQueryResult.
 *
 * Caching:
 * - index.json cached in memory for 1 hour (configurable via cacheTtlMs)
 * - individual manifest.json responses cached with the same TTL
 * - on network failure, returns stale cache if available
 *
 * This source does NOT install, update, or manage extensions.
 * It only discovers available extensions and provides manifests.
 */

import type { ExtensionManifestV1, ExtensionId } from "../types";
import type { ExtensionSource, SourceExtension, SourceQueryResult } from "./index";
import { parseRepositoryIndex } from "../repository";
import { loadManifestFromObject } from "../manifests";
import { ManifestParseError, ManifestValidationError, SchemaVersionUnsupportedError, RepositoryIndexError } from "../errors";

// =============================================================================
// Types
// =============================================================================

export interface RepositorySourceConfig {
  /** URL to the index.json file. */
  url: string;
  /** Cache time-to-live in milliseconds (default: 1 hour). */
  cacheTtlMs?: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// =============================================================================
// RepositorySource
// =============================================================================

/**
 * RepositorySource discovers extensions from a remote index.json over HTTP.
 *
 * Usage:
 * ```typescript
 * const source = new RepositorySource({
 *   id: "official",
 *   displayName: "Official Extensions",
 *   priority: 10,
 *   config: { url: "https://extensions.lumaforge.com/official/index.json" }
 * });
 * await source.initialize();
 * const result = await source.discover();
 * ```
 */
export class RepositorySource implements ExtensionSource {
  readonly id: string;
  readonly displayName: string;
  readonly priority: number;
  readonly enabled: boolean;

  private readonly _url: string;
  private readonly _cacheTtlMs: number;
  private _indexCache: CacheEntry<unknown> | null = null;
  private _manifestCache: Map<string, CacheEntry<ExtensionManifestV1>> = new Map();
  private _initialized = false;

  constructor(opts: {
    id: string;
    displayName: string;
    priority?: number;
    enabled?: boolean;
    config: RepositorySourceConfig;
  }) {
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.priority = opts.priority ?? 100;
    this.enabled = opts.enabled ?? true;
    this._url = opts.config.url;
    this._cacheTtlMs = opts.config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  /**
   * Initialize the source (validate URL, warm cache if possible).
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;
  }

  /**
   * Discover all available extensions from this repository.
   *
   * Flow:
   * 1. Fetch index.json (with cache)
   * 2. Parse via parseRepositoryIndex
   * 3. For each entry, fetch manifest.json (with cache)
   * 4. Validate each manifest via loadManifestFromObject
   * 5. Return SourceQueryResult
   */
  async discover(): Promise<SourceQueryResult> {
    const extensions: SourceExtension[] = [];
    const errors: Array<{ path: string; error: string }> = [];
    const queriedAt = Date.now();

    // Step 1: Fetch index.json
    let indexRaw: unknown;
    try {
      indexRaw = await this._fetchWithCache(this._url, "_index");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ path: this._url, error: `Failed to fetch index: ${errorMsg}` });
      return {
        extensions: [],
        success: false,
        error: `Failed to fetch index: ${errorMsg}`,
        queriedAt,
      };
    }

    // Step 2: Parse index
    let index: ReturnType<typeof parseRepositoryIndex>;
    try {
      index = parseRepositoryIndex(indexRaw, { path: this._url });
    } catch (err) {
      const errorMsg = err instanceof RepositoryIndexError ? err.message : String(err);
      errors.push({ path: this._url, error: `Invalid index: ${errorMsg}` });
      return {
        extensions: [],
        success: false,
        error: `Invalid index: ${errorMsg}`,
        queriedAt,
      };
    }

    // Step 3: Resolve base URL for manifest fetching
    const baseUrl = this._url.replace(/\/[^/]*$/, "");

    // Step 4: Fetch and validate each manifest
    for (const entry of index.extensions) {
      const manifestUrl = `${baseUrl}/${entry.manifestUrl}`;

      try {
        // Fetch manifest (with cache)
        const manifestRaw = await this._fetchWithCache(manifestUrl, entry.id);

        // Validate via loadManifestFromObject
        const manifest = loadManifestFromObject(manifestRaw, { path: manifestUrl });

        extensions.push({
          manifest,
          sourceId: this.id,
          metadata: {
            repositoryId: index.id,
            repositoryName: index.name,
            manifestUrl,
            verified: entry.verified ?? false,
          },
        });
      } catch (err) {
        if (
          err instanceof ManifestParseError ||
          err instanceof ManifestValidationError ||
          err instanceof SchemaVersionUnsupportedError
        ) {
          errors.push({ path: manifestUrl, error: err.message });
        } else {
          errors.push({ path: manifestUrl, error: String(err) });
        }
      }
    }

    return {
      extensions,
      success: errors.length === 0,
      errors,
      queriedAt,
    };
  }

  /**
   * Find a specific extension by ID.
   */
  async findById(extensionId: ExtensionId): Promise<SourceExtension | null> {
    const result = await this.discover();
    return result.extensions.find((e) => e.manifest.id === extensionId) ?? null;
  }

  /**
   * Check if a specific extension is available from this source.
   */
  async isAvailable(extensionId: ExtensionId): Promise<boolean> {
    return (await this.findById(extensionId)) !== null;
  }

  /**
   * Release resources (clear caches).
   */
  async destroy(): Promise<void> {
    this._indexCache = null;
    this._manifestCache.clear();
    this._initialized = false;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Fetch a URL with in-memory caching.
   * Uses cache key to store/retrieve responses.
   */
  private async _fetchWithCache(url: string, cacheKey: string): Promise<unknown> {
    const now = Date.now();

    // Check cache
    if (cacheKey === "_index" && this._indexCache) {
      if (now - this._indexCache.timestamp < this._cacheTtlMs) {
        return this._indexCache.data;
      }
    }

    const manifestCache = this._manifestCache.get(cacheKey);
    if (manifestCache && now - manifestCache.timestamp < this._cacheTtlMs) {
      return manifestCache.data;
    }

    // Fetch from network
    const response = await fetch(url);
    if (!response.ok) {
      // Try stale cache on network error
      if (cacheKey === "_index" && this._indexCache) {
        console.warn(`[REPO_SOURCE] Network failed for ${url}, using stale cache`);
        return this._indexCache.data;
      }
      const staleManifest = this._manifestCache.get(cacheKey);
      if (staleManifest) {
        console.warn(`[REPO_SOURCE] Network failed for ${url}, using stale cache`);
        return staleManifest.data;
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Update cache
    if (cacheKey === "_index") {
      this._indexCache = { data, timestamp: now };
    } else {
      this._manifestCache.set(cacheKey, { data, timestamp: now });
    }

    return data;
  }
}
