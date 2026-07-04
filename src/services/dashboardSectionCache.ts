// ---------------------------------------------------------------------------
// Module-level persisted cache for dashboard sections (recommended, featured,
// new noteworthy). Survives component mount/unmount cycles so navigation back
// to the Dashboard does not recalculate all sections from scratch.
// ---------------------------------------------------------------------------

const DEBUG_DASH_CACHE = false;

export interface DashboardCacheKey {
  libraryFingerprint: string;
  catalogVersion: number;
  favoriteIdsHash: string;
  playtimeHash: string;
}

export interface DashboardCachedData {
  recommendedAppIds: string[];
  featuredAppIds: string[];
  newNoteworthyAppIds: string[];
  builtAt: number;
}

let _cacheKey: DashboardCacheKey | null = null;
let _cachedData: DashboardCachedData | null = null;

export function buildLibraryFingerprint(games: { appId?: string; title?: string }[]): string {
  const count = games.length;
  if (count === 0) return "empty";
  const first = games[0]?.appId ?? "?";
  const last = games[count - 1]?.appId ?? "?";
  return `${count}:${first}:${last}`;
}

export function buildFavoriteHash(favoriteIds: Set<string>): string {
  const sorted = Array.from(favoriteIds).sort().join(",");
  return sorted.length > 0 ? `fav:${sorted.length}:${sorted.slice(0, 40)}` : "fav:0";
}

export function buildPlaytimeHash(_playtimeStore: unknown): string {
  return "playtime:v1";
}

export function buildCatalogVersionHash(catalogEntries: { appId?: string }[]): string {
  const count = catalogEntries.length;
  if (count === 0) return "cat:empty";
  const first = catalogEntries[0]?.appId ?? "?";
  const last = catalogEntries[count - 1]?.appId ?? "?";
  return `cat:${count}:${first}:${last}`;
}

export function getCachedDashboardSections(key: DashboardCacheKey): DashboardCachedData | null {
  if (!_cacheKey || !_cachedData) return null;

  if (
    _cacheKey.libraryFingerprint !== key.libraryFingerprint ||
    _cacheKey.catalogVersion !== key.catalogVersion ||
    _cacheKey.favoriteIdsHash !== key.favoriteIdsHash ||
    _cacheKey.playtimeHash !== key.playtimeHash
  ) {
    return null;
  }

  // Expire after 5 minutes
  if (Date.now() - _cachedData.builtAt > 5 * 60 * 1000) {
    _cachedData = null;
    _cacheKey = null;
    return null;
  }

  if (DEBUG_DASH_CACHE) {
    console.log(`[DASH][DERIVED_CACHE_HIT] key=${JSON.stringify(key)} elapsed=${Date.now() - _cachedData.builtAt}ms`);
  }
  return _cachedData;
}

export function setCachedDashboardSections(key: DashboardCacheKey, data: DashboardCachedData): void {
  _cacheKey = { ...key };
  _cachedData = { ...data, builtAt: Date.now() };
  if (DEBUG_DASH_CACHE) {
    console.log(`[DASH][DERIVED_CACHE_BUILD] key=${JSON.stringify(key)} elapsedMs=${Date.now() - data.builtAt}`);
  }
}

export function invalidateDashboardCache(): void {
  _cacheKey = null;
  _cachedData = null;
}
