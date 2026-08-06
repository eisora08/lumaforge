// ---------------------------------------------------------------------------
// StoreCatalogProvider — provider-agnostic abstraction for enriched catalog data.
// Provides typed game items and section models that replace steamdb.json fallback.
// Supports multiple providers: RAWG, IGDB, SteamSpy, steamdb, curated.
// ---------------------------------------------------------------------------

/** Available catalog data providers. */
export type CatalogProviderId = "rawg" | "igdb" | "steamspy" | "steamdb" | "curated";

/** A single catalog game with enriched metadata from any provider. */
export type StoreCatalogGame = {
  id: string;
  title: string;
  source: CatalogProviderId | "cache";
  /** Provider-specific IDs */
  rawgId?: number;
  igdbId?: number;
  steamAppId?: string;
  steamSpyAppId?: string;
  /** Release */
  releaseDate?: string;
  releaseTimestamp?: number;
  /** Metadata */
  genres?: string[];
  tags?: string[];
  rating?: number;
  metacritic?: number;
  popularity?: number;
  /** Media */
  imageUrl?: string;
  backgroundImageUrl?: string;
  screenshotUrls?: string[];
  storeUrl?: string;
  /** Credits */
  developers?: string[];
  publishers?: string[];
  description?: string;
  /** Quality score assigned by the scoring function (0–1). */
  score?: number;
};

/** A curated section of games for a specific Store discovery rail. */
export type StoreCatalogSection = {
  sectionId: string;
  title: string;
  games: StoreCatalogGame[];
  updatedAt: number;
  provider: CatalogProviderId;
  stale?: boolean;
};

/** Status of a single catalog provider. */
export type CatalogProviderStatus = {
  id: CatalogProviderId;
  configured: boolean;
  available: boolean;
  lastRefreshAt?: number;
  lastError?: string;
  gameCount?: number;
};

/** Full cached catalog data written to disk. */
export type StoreCatalogCache = {
  version: number;
  builtAt: number;
  sections: StoreCatalogSection[];
  allGames: StoreCatalogGame[];
  providers: CatalogProviderStatus[];
  sourceStats: Record<CatalogProviderId, number> & { total: number };
};

/** Cache version — increment when schema changes. */
export const STORE_CATALOG_CACHE_VERSION = 2;

/** How long (ms) before cached sections are considered stale. */
export const STORE_CATALOG_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Maximum games per section. */
export const MAX_SECTION_GAMES = 30;

// ---------------------------------------------------------------------------
// Section ID normalization
// Provider services use kebab-case IDs. Store.tsx Discover sections use
// different kebab-case IDs. normalizeCatalogSectionId maps provider IDs
// to canonical Store Discover section IDs so merge lookups always match.
// ---------------------------------------------------------------------------

const SECTION_ID_MAP: Record<string, string> = {
  "new-noteworthy": "new-noteworthy",
  "top-picks": "top-picks",
  "featured": "featured",
  "popular-year": "top-picks",       // RAWG popular-year → Store top-picks
  "top-rated": "featured",           // RAWG top-rated → Store featured
};

/**
 * Normalize a provider section ID to the canonical Store Discover section ID.
 * Returns the original ID if no mapping exists.
 */
export function normalizeCatalogSectionId(id: string): string {
  return SECTION_ID_MAP[id] ?? id;
}

/** Section replacement thresholds — enriched sections must meet these minimums
 *  to REPLACE the steamdb fallback. Only sections that have a steamdb
 *  counterpart are checked. Sections without a steamdb counterpart (e.g.,
 *  "popular-year", "top-rated") are mapped via normalizeCatalogSectionId. */
export const SECTION_MINIMUMS: Record<string, number> = {
  "new-noteworthy": 6,
  "top-picks": 6,
  "featured": 6,
};
