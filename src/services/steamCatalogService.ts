/**
 * Local Steam Catalog Service — queries the SQLite catalog index for Discover/View All.
 *
 * This replaces the runtime metadata enrichment path for genre sections.
 * Genre queries are served from the local catalog (imported via Rust),
 * not from the remote Steam appdetails API.
 */

import {
  getCatalogMeta,
  importSteamCatalog,
  queryCatalogByGenre,
  queryCatalogSearch,
  queryCatalogGame,
  queryCatalogFeatured,
  queryCatalogNewNoteworthy,
  queryCatalogHiddenGems,
  queryCatalogTopRated,
  queryCatalogCultClassics,
  type CatalogMetaResult,
  type CatalogGameResult,
} from "./tauri";

const BUNDLED_CATALOG_PATH = "/data/catalog/steam-catalog-v1.json";
const BUNDLED_CATALOG_CHECKSUM_PATH = "/data/catalog/steam-catalog-v1.manifest.json";

// ── Types ──

export type LocalCatalogStatus = {
  available: boolean;
  catalogVersion: number;
  gameCount: number;
  importedAt: string;
  checksum: string;
};

export type CatalogQueryResult = {
  games: CatalogGameResult[];
  fromLocalCatalog: boolean;
};

// ── In-memory query cache (5 min TTL) ──

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const _genreCache = new Map<string, { ts: number; games: CatalogGameResult[] }>();
const _searchCache = new Map<string, { ts: number; games: CatalogGameResult[] }>();
const _featuredCache = new Map<string, { ts: number; games: CatalogGameResult[] }>();
const _newNoteworthyCache = new Map<string, { ts: number; games: CatalogGameResult[] }>();
const _hiddenGemsCache = new Map<string, { ts: number; games: CatalogGameResult[] }>();
const _topRatedCache = new Map<string, { ts: number; games: CatalogGameResult[] }>();
const _cultClassicsCache = new Map<string, { ts: number; games: CatalogGameResult[] }>();
const _metaCache = new Map<string, { ts: number; meta: CatalogMetaResult }>();

function isCacheFresh(entry: { ts: number } | undefined): entry is { ts: number } {
  return entry !== undefined && Date.now() - entry.ts < CATALOG_CACHE_TTL_MS;
}

// ── Public API ──

/**
 * Get catalog status — whether an imported catalog exists and its version.
 * Cached for 5 minutes.
 */
export async function getLocalCatalogStatus(): Promise<LocalCatalogStatus> {
  const cacheKey = "meta";
  const cached = _metaCache.get(cacheKey);
  if (isCacheFresh(cached)) {
    return {
      available: cached.meta.hasCatalog,
      catalogVersion: cached.meta.catalogVersion,
      gameCount: cached.meta.gameCount,
      importedAt: cached.meta.importedAt,
      checksum: cached.meta.checksum,
    };
  }

  try {
    const meta = await getCatalogMeta();
    _metaCache.set(cacheKey, { ts: Date.now(), meta });
    return {
      available: meta.hasCatalog,
      catalogVersion: meta.catalogVersion,
      gameCount: meta.gameCount,
      importedAt: meta.importedAt,
      checksum: meta.checksum,
    };
  } catch (err) {
    console.error("[CATALOG][STATUS] Failed to get catalog meta:", err);
    return { available: false, catalogVersion: 0, gameCount: 0, importedAt: "", checksum: "" };
  }
}

/**
 * Import a catalog artifact (JSON string) into SQLite.
 * Called by the catalog builder tool or boot-time import.
 */
export async function importCatalogArtifact(
  artifactJson: string,
  checksum: string,
): Promise<number> {
  const count = await importSteamCatalog(artifactJson, checksum);
  clearCatalogCaches();
  return count;
}

/**
 * Query games by genre (for genre rails in Discover and View All).
 * Returns cached results when available.
 */
export async function queryByGenre(
  genre: string,
  limit: number,
  offset: number,
): Promise<CatalogQueryResult> {
  const cacheKey = `${genre}:${limit}:${offset}`;
  const cached = _genreCache.get(cacheKey);
  if (isCacheFresh(cached)) {
    return { games: cached.games, fromLocalCatalog: true };
  }

  try {
    const games = await queryCatalogByGenre(genre, limit, offset);
    _genreCache.set(cacheKey, { ts: Date.now(), games });
    return { games, fromLocalCatalog: true };
  } catch (err) {
    console.error(`[CATALOG][GENRE] Query failed for ${genre}:`, err);
    return { games: [], fromLocalCatalog: false };
  }
}

/**
 * Search games by name (for search functionality).
 * Returns cached results when available.
 */
export async function querySearch(
  query: string,
  limit: number,
): Promise<CatalogQueryResult> {
  const cacheKey = `${query}:${limit}`;
  const cached = _searchCache.get(cacheKey);
  if (isCacheFresh(cached)) {
    return { games: cached.games, fromLocalCatalog: true };
  }

  try {
    const games = await queryCatalogSearch(query, limit);
    _searchCache.set(cacheKey, { ts: Date.now(), games });
    return { games, fromLocalCatalog: true };
  } catch (err) {
    console.error(`[CATALOG][SEARCH] Query failed for ${query}:`, err);
    return { games: [], fromLocalCatalog: false };
  }
}

/**
 * Get a single game by app ID from the local catalog.
 * No cache — single lookups are infrequent.
 */
export async function getCatalogGame(
  appId: number,
): Promise<CatalogGameResult | null> {
  try {
    return await queryCatalogGame(appId);
  } catch (err) {
    console.error(`[CATALOG][GAME] Query failed for ${appId}:`, err);
    return null;
  }
}

/**
 * Get featured/highly rated games (for Featured section).
 * Returns cached results when available.
 */
export async function queryFeaturedGames(
  limit: number,
): Promise<CatalogQueryResult> {
  const cacheKey = `featured:${limit}`;
  const cached = _featuredCache.get(cacheKey);
  if (isCacheFresh(cached)) {
    return { games: cached.games, fromLocalCatalog: true };
  }

  try {
    const games = await queryCatalogFeatured(limit);
    _featuredCache.set(cacheKey, { ts: Date.now(), games });
    return { games, fromLocalCatalog: true };
  } catch (err) {
    console.error("[CATALOG][FEATURED] Query failed:", err);
    return { games: [], fromLocalCatalog: false };
  }
}

/**
 * Get new & noteworthy games (for New & Noteworthy section).
 * Returns cached results when available.
 */
export async function queryNewNoteworthyGames(
  limit: number,
): Promise<CatalogQueryResult> {
  const cacheKey = `newnoteworthy:${limit}`;
  const cached = _newNoteworthyCache.get(cacheKey);
  if (isCacheFresh(cached)) {
    return { games: cached.games, fromLocalCatalog: true };
  }

  try {
    const games = await queryCatalogNewNoteworthy(limit);
    _newNoteworthyCache.set(cacheKey, { ts: Date.now(), games });
    return { games, fromLocalCatalog: true };
  } catch (err) {
    console.error("[CATALOG][NEW_NOTEWORTHY] Query failed:", err);
    return { games: [], fromLocalCatalog: false };
  }
}

/**
 * Get hidden gems — high review%, moderate review count, niche but beloved.
 * Returns cached results when available.
 */
export async function queryHiddenGems(
  limit: number,
): Promise<CatalogQueryResult> {
  const cacheKey = `hiddengems:${limit}`;
  const cached = _hiddenGemsCache.get(cacheKey);
  if (isCacheFresh(cached)) {
    return { games: cached.games, fromLocalCatalog: true };
  }

  try {
    const games = await queryCatalogHiddenGems(limit);
    _hiddenGemsCache.set(cacheKey, { ts: Date.now(), games });
    return { games, fromLocalCatalog: true };
  } catch (err) {
    console.error("[CATALOG][HIDDEN_GEMS] Query failed:", err);
    return { games: [], fromLocalCatalog: false };
  }
}

/**
 * Get top rated games — highest review% with significant review count.
 * Returns cached results when available.
 */
export async function queryTopRatedGames(
  limit: number,
): Promise<CatalogQueryResult> {
  const cacheKey = `toprated:${limit}`;
  const cached = _topRatedCache.get(cacheKey);
  if (isCacheFresh(cached)) {
    return { games: cached.games, fromLocalCatalog: true };
  }

  try {
    const games = await queryCatalogTopRated(limit);
    _topRatedCache.set(cacheKey, { ts: Date.now(), games });
    return { games, fromLocalCatalog: true };
  } catch (err) {
    console.error("[CATALOG][TOP_RATED] Query failed:", err);
    return { games: [], fromLocalCatalog: false };
  }
}

/**
 * Get cult classics — old games with sustained high quality.
 * Returns cached results when available.
 */
export async function queryCultClassics(
  limit: number,
): Promise<CatalogQueryResult> {
  const cacheKey = `cultclassics:${limit}`;
  const cached = _cultClassicsCache.get(cacheKey);
  if (isCacheFresh(cached)) {
    return { games: cached.games, fromLocalCatalog: true };
  }

  try {
    const games = await queryCatalogCultClassics(limit);
    _cultClassicsCache.set(cacheKey, { ts: Date.now(), games });
    return { games, fromLocalCatalog: true };
  } catch (err) {
    console.error("[CATALOG][CULT_CLASSICS] Query failed:", err);
    return { games: [], fromLocalCatalog: false };
  }
}

/**
 * Clear all caches — called on catalog re-import or app restart.
 */
function clearCatalogCaches(): void {
  _genreCache.clear();
  _searchCache.clear();
  _featuredCache.clear();
  _newNoteworthyCache.clear();
  _hiddenGemsCache.clear();
  _topRatedCache.clear();
  _cultClassicsCache.clear();
  _metaCache.clear();
  _localGenreGroups.clear();
  _localCatalogReady = false;
}

// ── Pre-fetched genre groups for Store Discover ──

let _importInFlight: Promise<boolean> | null = null;

/**
 * Ensure the bundled catalog artifact is imported into SQLite.
 * Checks if catalog exists; if not, fetches bundled JSON and imports.
 * Returns true if catalog is available after this call.
 * Deduplicates concurrent callers via a shared promise.
 */
export async function ensureCatalogImported(): Promise<boolean> {
  const status = await getLocalCatalogStatus();
  if (status.available) return true;
  if (_importInFlight) return _importInFlight;

  _importInFlight = (async () => {
    try {
      console.log("[CATALOG][AUTO_IMPORT] No catalog found, loading bundled artifact...");
      const [artifactRes, manifestRes] = await Promise.all([
        fetch(BUNDLED_CATALOG_PATH),
        fetch(BUNDLED_CATALOG_CHECKSUM_PATH),
      ]);

      if (!artifactRes.ok) {
        console.warn("[CATALOG][AUTO_IMPORT] Bundled artifact not found:", artifactRes.status);
        return false;
      }

      const artifactJson = await artifactRes.text();
      let checksum = "";
      if (manifestRes.ok) {
        try {
          const manifest = await manifestRes.json();
          checksum = manifest.checksum || "";
        } catch {}
      }

      const count = await importCatalogArtifact(artifactJson, checksum);
      console.log(`[CATALOG][AUTO_IMPORT] Imported ${count} records`);
      return count > 0;
    } catch (err) {
      console.error("[CATALOG][AUTO_IMPORT] Failed:", err);
      return false;
    } finally {
      _importInFlight = null;
    }
  })();

  return _importInFlight;
}

/**
 * Module-level cache of genre → games[] populated by preFetchGenreGroups().
 * Store.tsx calls preFetchGenreGroups(genres) on mount; the discoverSections
 * useMemo reads synchronously via getLocalGenreGroups().
 */
let _localCatalogReady = false;
const _localGenreGroups = new Map<string, CatalogGameResult[]>();

/**
 * Pre-fetch all requested genres from the local catalog in parallel.
 * Populates _localGenreGroups for synchronous reads in discoverSections.
 * Returns true if the catalog was available and populated.
 */
export async function preFetchGenreGroups(genres: string[], limit = 20): Promise<boolean> {
  const status = await getLocalCatalogStatus();
  if (!status.available) {
    _localCatalogReady = false;
    return false;
  }

  try {
    const results = await Promise.all(genres.map(async (genre) => {
      const { games } = await queryByGenre(genre, limit, 0);
      return { genre, games };
    }));

    _localGenreGroups.clear();
    for (const { genre, games } of results) {
      if (games.length > 0) {
        _localGenreGroups.set(genre, games);
      }
    }
    _localCatalogReady = true;
    console.log(
      `[CATALOG][PREFETCH] genres=${_localGenreGroups.size} ready=true`,
    );
    return true;
  } catch (err) {
    console.error("[CATALOG][PREFETCH] Failed:", err);
    _localCatalogReady = false;
    return false;
  }
}

/**
 * Get pre-fetched genre groups (synchronous read).
 * Returns the Map if the catalog was pre-fetched, or null if not ready.
 */
export function getLocalGenreGroups(): Map<string, CatalogGameResult[]> | null {
  return _localCatalogReady ? _localGenreGroups : null;
}

/**
 * Check if the local catalog genre groups are ready.
 */
export function isLocalCatalogReady(): boolean {
  return _localCatalogReady;
}
