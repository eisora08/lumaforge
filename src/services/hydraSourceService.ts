/**
 * Hydra Source Service — manages Hydra JSON sources for the Debrid repack ecosystem.
 *
 * Users add Hydra source URLs in Settings → Debrid Providers.
 * The service fetches, validates, and persists source configurations.
 * Source configs live in AppData/debrid/hydra-sources.json via Rust commands.
 */

import type {
  HydraSourceConfig,
  HydraImportResult,
  ImportedFeedSummary,
} from "../types/hydraSource";
import { invoke } from "@tauri-apps/api/core";
import { clearRepackCatalogCaches } from "./repackCatalogService";

/** Result of validating a Hydra source URL. */
interface HydraFetchResult {
  success: boolean;
  source_name?: string;
  game_count?: number;
  error?: string;
}

// ── Module-level cache ──

let _cachedSources: HydraSourceConfig[] | null = null;
let _cachedFeeds: ImportedFeedSummary[] | null = null;

// ── Tauri bindings ──

async function tauriListSources(): Promise<HydraSourceConfig[]> {
  return await invoke<HydraSourceConfig[]>("list_hydra_sources");
}

async function tauriAddSource(id: string, name: string, url: string): Promise<void> {
  await invoke("add_hydra_source", { id, name, url });
}

async function tauriRemoveSource(id: string): Promise<void> {
  await invoke("remove_hydra_source", { id });
}

async function tauriToggleSource(id: string, enabled: boolean): Promise<void> {
  await invoke("toggle_hydra_source", { id, enabled });
}

async function tauriValidateUrl(url: string): Promise<HydraFetchResult> {
  return await invoke<HydraFetchResult>("validate_hydra_source_url", { url });
}

/**
 * Fetch a URL via hidden webview (bypasses Cloudflare JS challenges).
 * Used internally by the Hydra source fetcher; exposed for debugging.
 */
export async function fetchUrlViaWebview(
  url: string,
  timeoutSecs?: number,
): Promise<string> {
  return await invoke<string>("fetch_url_via_webview", { url, timeoutSecs });
}

async function tauriFetchAndImport(
  sourceId: string,
  sourceUrl: string,
  sourceName: string,
): Promise<HydraImportResult> {
  return await invoke<HydraImportResult>("fetch_and_import_hydra_source", {
    sourceId,
    sourceUrl,
    sourceName,
  });
}

async function tauriRefreshAll(): Promise<HydraImportResult[]> {
  return await invoke<HydraImportResult[]>("refresh_all_hydra_sources");
}

async function tauriClearCache(): Promise<void> {
  await invoke("clear_hydra_cache");
}

async function tauriImportRepackFeed(
  contents: string,
  sourceName?: string,
  sourceUrl?: string,
): Promise<HydraImportResult> {
  return await invoke<HydraImportResult>("import_repack_feed", {
    contents,
    sourceName,
    sourceUrl,
  });
}

async function tauriListImportedFeeds(): Promise<ImportedFeedSummary[]> {
  return await invoke<ImportedFeedSummary[]>("list_imported_feeds");
}

async function tauriRemoveImportedFeed(name: string): Promise<number> {
  return await invoke<number>("remove_imported_feed", { name });
}

// ── Public API ──

/**
 * Get all configured Hydra sources. Cached in memory.
 */
export async function getHydraSources(forceRefresh = false): Promise<HydraSourceConfig[]> {
  if (!_cachedSources || forceRefresh) {
    _cachedSources = await tauriListSources();
  }
  return _cachedSources;
}

/**
 * Validate a Hydra source URL by fetching and parsing it.
 * Returns the source name and game count if valid.
 */
export async function validateHydraSourceUrl(
  url: string,
): Promise<HydraFetchResult> {
  return await tauriValidateUrl(url);
}

/**
 * Add a new Hydra source. Generates a unique ID from the URL hash.
 */
export async function addHydraSource(
  name: string,
  url: string,
): Promise<void> {
  const id = `hydra-${urlToId(url)}`;

  // Validate before adding
  const validation = await tauriValidateUrl(url);
  if (!validation.success) {
    throw new Error(validation.error || "Failed to validate Hydra source URL");
  }

  await tauriAddSource(id, name, url);
  _cachedSources = null; // invalidate cache

  // Import entries into SQLite immediately so games are visible right away
  try {
    await fetchAndImportHydraSource(id, url, name);
    clearRepackCatalogCaches();
  } catch {
    // Source config saved even if import fails — user can retry via "Actualizar"
  }
}

/**
 * Remove a Hydra source by ID.
 */
export async function removeHydraSource(id: string): Promise<void> {
  await tauriRemoveSource(id);
  _cachedSources = null;
}

/**
 * Toggle a Hydra source enabled/disabled.
 */
export async function toggleHydraSource(id: string, enabled: boolean): Promise<void> {
  await tauriToggleSource(id, enabled);
  _cachedSources = null;
}

/**
 * Fetch a specific Hydra source and import its entries into the repack catalog.
 */
export async function fetchAndImportHydraSource(
  sourceId: string,
  sourceUrl: string,
  sourceName: string,
): Promise<HydraImportResult> {
  return await tauriFetchAndImport(sourceId, sourceUrl, sourceName);
}

/**
 * Refresh all enabled Hydra sources.
 */
export async function refreshAllHydraSources(): Promise<HydraImportResult[]> {
  return await tauriRefreshAll();
}

/**
 * Clear the Hydra source JSON cache from disk.
 */
export async function clearHydraCache(): Promise<void> {
  await tauriClearCache();
  _cachedSources = null;
}

/**
 * Import a pasted repack feed (raw JSON) directly into the repack catalog.
 * Supports Hydra (`games`), official artifact (`records`), and scraped
 * (`downloads`) formats. Download links from the feed are preserved as-is
 * so the Debrid installer can use them.
 */
export async function importRepackFeed(
  contents: string,
  options?: { sourceName?: string; sourceUrl?: string },
): Promise<HydraImportResult> {
  const result = await tauriImportRepackFeed(
    contents,
    options?.sourceName,
    options?.sourceUrl,
  );
  _cachedFeeds = null; // invalidate imported-feeds cache
  clearRepackCatalogCaches(); // invalidate SQLite-backed search caches so new rows are immediately searchable
  return result;
}

/**
 * List pasted repack feeds (catalog rows with an empty sourceUrl),
 * grouped by feed name. Cached in memory.
 */
export async function getImportedFeeds(forceRefresh = false): Promise<ImportedFeedSummary[]> {
  if (!_cachedFeeds || forceRefresh) {
    _cachedFeeds = await tauriListImportedFeeds();
  }
  return _cachedFeeds;
}

/**
 * Remove a pasted repack feed, purging all of its rows from the repack catalog.
 * Returns the number of rows deleted.
 */
export async function removeImportedFeed(name: string): Promise<number> {
  const deleted = await tauriRemoveImportedFeed(name);
  _cachedFeeds = null;
  clearRepackCatalogCaches(); // invalidate SQLite-backed search caches after feed rows are purged
  return deleted;
}

/**
 * Fetch and validate a Hydra source JSON file (client-side).
 * Useful for previewing before adding.
 */
export async function previewHydraSource(url: string): Promise<{
  valid: boolean;
  name?: string;
  gameCount?: number;
  error?: string;
}> {
  try {
    const validation = await tauriValidateUrl(url);
    if (!validation.success) {
      return { valid: false, error: validation.error || "Invalid source" };
    }
    return {
      valid: true,
      name: validation.source_name,
      gameCount: validation.game_count,
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Helpers ──

function urlToId(url: string): string {
  // Create a stable ID from URL
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
