// ---------------------------------------------------------------------------
// Module-level persistent cache for Store Discover derived state.
// Survives component mount/unmount cycles so re-entering Store is instant.
// ---------------------------------------------------------------------------

// Using loose types for cache items to avoid import/re-export incompatibilities
/* eslint-disable @typescript-eslint/no-explicit-any */

/** A single game item used across all Discover sections. */
export type StoreGame = {
  appId: string;
  title: string;
  imageUrl?: string;
  platforms: string[];
  sources: any[];
};

/** Section source tag for honest labeling. */
export type SectionSource = "catalog" | "personalized" | "genre" | "lua" | "fallback";

/** New model for a single Discover section rail. */
export type StoreDiscoverSection = {
  id: string;
  title: string;
  type: "hero" | "featured" | "rail" | "genre" | "more";
  items: StoreGame[];
  source: SectionSource;
};

export interface StoreSectionModel {
  id: string;
  title: string;
  description: string;
  games: { appId: string; title: string; imageUrl?: string; platforms: string[]; sources: any[] }[];
}

export type CacheStatus = "empty" | "partial" | "complete";

export interface CacheEntry {
  catalogFingerprint: string;
  rankedSteamCatalog: { appid: number; name: string }[];
  highQualityPool: { appId: string; title: string; score: number; hasSource: boolean; hasMeta: boolean }[];
  dynamicDiscoverSections: StoreSectionModel[];
  discoverSections: StoreDiscoverSection[];
  lumaForgeSections: StoreSectionModel[];
  allStoreSections: StoreSectionModel[];
  featuredGames: { appId: string; title: string; imageUrl?: string; platforms: string[]; sources: any[] }[];
  browseGames: { appId: string; title: string; imageUrl?: string; platforms: string[]; sources: any[] }[];
  luaReadyGames: { appId: string; title: string; imageUrl?: string; platforms: string[]; sources: any[] }[];
  builtAt: number;
  /** If true, the cached Discover sections are incomplete and should be rebuilt. */
  isPartialCache?: boolean;
  /** Explicit cache completeness status. Derived from isPartialCache + thresholds. */
  status?: CacheStatus;
}

let _cachedDiscover: CacheEntry | null = null;
let _cachedDiscoverVersion = 0;

function computeFingerprint(catalog: { appid: number; name: string }[]): string {
  if (catalog.length === 0) return "empty";
  const len = catalog.length;
  return `${len}:${catalog[0].appid}:${catalog[len - 1].appid}`;
}

export function invalidateStoreDiscoverCache(): void {
  _cachedDiscover = null;
  _cachedDiscoverVersion++;
}

export function getStoreDiscoverCacheVersion(): number {
  return _cachedDiscoverVersion;
}

export function getCachedStoreDiscover(): CacheEntry | null {
  return _cachedDiscover;
}

export function isCacheComplete(entry: CacheEntry | null): boolean {
  if (!entry) return false;
  if (entry.isPartialCache) return false;
  return (
    entry.featuredGames.length >= 4 &&
    entry.discoverSections.length >= 5 &&
    entry.allStoreSections.length > 0
  );
}

export function setCachedStoreDiscover(entry: CacheEntry): void {
  // If the incoming cache is incomplete, do NOT overwrite a valid existing cache.
  // A cache is complete when featured games >= 4, discover sections >= 5, and it's not partial.
  const isComplete =
    entry.featuredGames.length >= 4 &&
    entry.discoverSections.length >= 5 &&
    !entry.isPartialCache;
  // Phase 3+4+7: Complete cache priority — never overwrite complete with partial
  if (!isComplete) {
    const existing = getCachedStoreDiscover();
    if (existing && isCacheComplete(existing)) {
      console.log(`[STORE][DISCOVER_CACHE_WRITE_SKIP] reason=complete-cache-exists currentPartial=${!!entry.isPartialCache} currentFeatured=${entry.featuredGames.length} currentSections=${entry.discoverSections.length} existingSections=${existing.discoverSections.length}`);
      return;
    }
    if (existing && isCacheComplete(existing) && existing.catalogFingerprint === entry.catalogFingerprint) {
      console.log(`[STORE][DISCOVER_CACHE_WRITE_SKIP] reason=complete-cache-exists fingerprint=matched`);
      return;
    }
  }
  entry.status = isComplete ? "complete" : "partial";
  _cachedDiscover = entry;
}

export function isDiscoverCacheComplete(entry: CacheEntry | null): boolean {
  if (!entry) return false;
  if (entry.isPartialCache) return false;
  return (
    entry.featuredGames.length >= 4 &&
    entry.discoverSections.length >= 5
  );
}



export function buildCatalogFingerprint(catalog: { appid: number; name: string }[]): string {
  return computeFingerprint(catalog);
}

/**
 * Build a composite fingerprint for Discover sections.
 * Combines catalog version, library preferences, and filters so the
 * section cache can be invalidated when any input changes.
 */
export function buildDiscoverSectionsFingerprint(
  catalogVersion: string,
  libraryFingerprint: string,
  filtersVersion: string,
  userPreferenceVersion: string,
): string {
  return `${catalogVersion}:${libraryFingerprint}:${filtersVersion}:${userPreferenceVersion}`;
}

// ── Store UI state cache (tab, search, filters, visibleCount) ──

export interface StoreUIState {
  activeStoreTab: string;
  storeSearchQuery: string;
  submittedSearchQuery: string;
  browseFilters: Record<string, unknown>;
  visibleCount: number;
  selectedHeroIndex: number;
  selectedDetailAppId: string | null;
  browsePage: number;
  activeGenreSectionId: string | null;
  discoverMoreVisibleCount: number;
}

let _cachedStoreUI: StoreUIState | null = null;

export function setCachedStoreUI(state: StoreUIState): void {
  _cachedStoreUI = state;
}

export function getCachedStoreUI(): StoreUIState | null {
  return _cachedStoreUI;
}

export type { CacheEntry as StoreDiscoverCacheEntry };

// ── Module-level Store metadata cache (survives mount/unmount) ──
// Because storeMetadataByAppId resets to {} on remount, causing hero/featured
// images to flash placeholder until the effect re-fetches metadata.
let _cachedStoreMetadata: Record<number, Record<string, unknown>> | null = null;

export function getCachedStoreMetadata(): Record<number, Record<string, unknown>> | null {
  return _cachedStoreMetadata;
}

export function setCachedStoreMetadata(meta: Record<number, Record<string, unknown>>): void {
  _cachedStoreMetadata = meta;
}

export function clearCachedStoreMetadata(): void {
  _cachedStoreMetadata = null;
}
