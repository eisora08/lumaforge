// ---------------------------------------------------------------------------
// Module-level persistent cache for Store Discover derived state.
// Survives component mount/unmount cycles so re-entering Store is instant.
// ---------------------------------------------------------------------------

/** Increment when scoring/filtering logic changes to force cache rebuild. */
export const DISCOVER_SCORING_VERSION = 5;

/**
 * Increment when Discovery Index format or scoring changes.
 * Must stay aligned with DISCOVER_SCORING_VERSION so the index is always
 * rebuilt when scoring logic changes.
 */
export const DISCOVERY_INDEX_VERSION = 5;

/** Steam genre ID → display name mapping. Used by discovery index for normalization. */
export const STEAM_GENRE_IDS: Record<string, string> = {
  "1": "Action",
  "2": "Strategy",
  "3": "RPG",
  "4": "Casual",
  "5": "VR",
  "6": "Simulation",
  "7": "Racing",
  "8": "Sports",
  "9": "Racing",
  "18": "Sports",
  "23": "Indie",
  "24": "Adventure",
  "25": "Adventure",
  "28": "Simulation",
  "29": "Massively Multiplayer",
  "30": "Free to Play",
  "37": "Free to Play",
  "70": "Early Access",
};

/** Display genres used for Store genre rails. */
export const DISPLAY_GENRES = ["Action", "Indie", "Racing", "Shooter", "RPG", "Adventure"];

/**
 * Quality-gate thresholds for Store Discovery sections.
 * Prevents low-quality / no-data games from appearing in curated sections.
 */
export const QG_TOP_PICK_MIN_REVIEWS = 100;
export const QG_TOP_PICK_MIN_SCORE = 7;
export const QG_TOP_PICK_MIN_PCT = 80;

export const QG_FEATURED_MIN_REVIEWS = 50;
export const QG_FEATURED_MIN_PCT = 75;

export const QG_GENRE_MIN_REVIEWS = 50;
export const QG_GENRE_MIN_SCORE = 6;
export const QG_GENRE_MIN_PCT = 70;

export const QG_TOP_RATED_MIN_REVIEWS = 500;
export const QG_TOP_RATED_MIN_SCORE = 8;
export const QG_TOP_RATED_MIN_PCT = 85;

export const QG_NEW_RELEASE_DAYS = 90;

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

/**
 * Per-app score breakdown stored in the Discovery Index.
 * Used for quality-gated section queries and diagnostics.
 */
export type DiscoveryAppScore = {
  final: number;
  reviewScore: number;
  reviewCount: number;
  positivePct: number | null;
  popularityProxy: number;
  metadataCompleteness: number;
  genreMatches: string[];
  reasons: string[];
};

/**
 * A single enriched app entry in the Discovery Index.
 * Compiled from available metadata + reviews, never fetched fresh for index builds.
 */
export type DiscoveryAppEntry = {
  appid: string;
  name: string;
  type?: string;
  genres?: string[];
  genreIds?: string[];
  categories?: string[];
  developers?: string[];
  publishers?: string[];
  releaseDate?: string | null;
  images: {
    header?: string;
    capsule?: string;
    background?: string;
  };
  reviews?: {
    resolved: boolean;
    total: number;
    score: number;
    label: string;
    positivePct: number | null;
  };
  updatedAt: number;
};

/**
 * The derived Discovery Index — a snapshot of enriched metadata + scores
 * for the top discovery candidates. Built progressively from cached data.
 */
export type StoreDiscoveryIndex = {
  version: number;
  builtAt: number;
  source: string;
  catalogSize: number;
  maxCandidates: number;
  stats: {
    enrichedApps: number;
    withGenres: number;
    withReviews: number;
    withImages: number;
    withReleaseDate: number;
  };
  sections: {
    topPicks: string[];
    featured: string[];
    forYou: string[];
    genres: Record<string, string[]>;
  };
  scores: Record<string, DiscoveryAppScore>;
};

/** Section source tag for honest labeling. */
export type SectionSource = "catalog" | "personalized" | "genre" | "lua" | "fallback" | "curated";

/** New model for a single Discover section rail. */
export type StoreDiscoverSection = {
  id: string;
  title: string;
  type: "hero" | "featured" | "rail" | "genre" | "genre-collection" | "more";
  items: StoreGame[];
  source: SectionSource;
  /** Genre collection cards — each entry is a genre with its top games for the mosaic. */
  genreGroups?: { genre: string; items: StoreGame[] }[];
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
  scoringVersion: number;
  rankedSteamCatalog: { appid: number; name: string }[];
  highQualityPool: { appId: string; title: string; score: number; hasSource: boolean; hasMeta: boolean }[];
  dynamicDiscoverSections: StoreSectionModel[];
  discoverSections: StoreDiscoverSection[];
  lumaForgeSections: StoreSectionModel[];
  allStoreSections: StoreSectionModel[];
  featuredGames: { appId: string; title: string; imageUrl?: string; platforms: string[]; sources: any[] }[];
  browseGames: { appId: string; title: string; imageUrl?: string; platforms: string[]; sources: any[] }[];
  luaReadyGames?: { appId: string; title: string; imageUrl?: string; platforms: string[]; sources: any[] }[];
  builtAt: number;
  /** The compiled Discovery Index (enriched metadata + quality-gated scores). */
  discoveryIndex?: StoreDiscoveryIndex;
  /** If true, the cached Discover sections are incomplete and should be rebuilt. */
  isPartialCache?: boolean;
  /** Explicit cache completeness status. Derived from isPartialCache + thresholds. */
  status?: CacheStatus;
}

let _cachedDiscover: CacheEntry | null = null;
let _cachedDiscoverVersion = 0;

// Persistent hero source of truth. The module-level _cachedDiscover dies on app
// restart, so a cold boot used to fall through to the curated baseline while the
// enriched pool hydrated -> boot != return. This localStorage copy (featured only,
// <= 8 tiny StoreGame items) survives the restart so boot restores the SAME hero.
const FEATURED_PERSIST_KEY = "lumaforge-store-featured-v1";

function persistDiscoverFeatured(featured: StoreGame[]): void {
  if (!featured || featured.length < 4) return;
  const compact = featured.map((g) => ({
    appId: g.appId,
    title: g.title,
    imageUrl: g.imageUrl,
    platforms: g.platforms ?? [],
  }));
  try {
    localStorage.setItem(FEATURED_PERSIST_KEY, JSON.stringify(compact));
  } catch {
    // Quota/security exceptions must never break the store render path.
  }
}

export function getPersistedDiscoverFeatured(): StoreGame[] | null {
  try {
    const raw = localStorage.getItem(FEATURED_PERSIST_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 4) return null;
    const items = parsed.filter(
      (it): it is { appId: string; title: string; imageUrl?: string; platforms: string[] } =>
        typeof it === "object" && it !== null &&
        typeof (it as { appId?: unknown }).appId === "string" &&
        typeof (it as { title?: unknown }).title === "string",
    );
    if (items.length < 4) return null;
    return items.map((g) => ({
      appId: g.appId,
      title: g.title,
      imageUrl: g.imageUrl,
      platforms: Array.isArray(g.platforms) ? g.platforms : [],
      sources: [],
    }));
  } catch {
    return null;
  }
}

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
  }
  entry.status = isComplete ? "complete" : "partial";
  _cachedDiscover = entry;
  persistDiscoverFeatured(entry.featuredGames);
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

// ── Module-level review summary cache (survives mount/unmount) ──
// Same pattern as metadata — prevents a full discoverSections rebuild on remount
// when the fingerprint jumps from 0 reviews to N reviews.
let _cachedReviewSummaries: Record<number, Record<string, unknown>> | null = null;

export function getCachedReviewSummaries(): Record<number, Record<string, unknown>> | null {
  return _cachedReviewSummaries;
}

export function setCachedReviewSummaries(summaries: Record<number, Record<string, unknown>>): void {
  _cachedReviewSummaries = summaries;
}

export function clearCachedReviewSummaries(): void {
  _cachedReviewSummaries = null;
}
