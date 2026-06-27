import { resolveSteamStoreSearch } from "./tauri";
import type { SteamStoreSearchItem } from "../types/steamStoreSearch";

const CACHE_KEY = "lumaforge-steam-store-search-cache";
const CACHE_TTL_MS = 1000 * 60 * 10;

type SearchCacheItem = {
  savedAt: number;
  items: SteamStoreSearchItem[];
};

type SearchCache = Record<string, SearchCacheItem>;

function getCacheKey(term: string) {
  return term.trim().toLowerCase();
}

function loadCache(): SearchCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);

    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as SearchCache;
  } catch {
    return {};
  }
}

function saveCache(cache: SearchCache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

function isCacheValid(item?: SearchCacheItem) {
  if (!item) {
    return false;
  }

  return Date.now() - item.savedAt < CACHE_TTL_MS;
}

export async function searchSteamStore(
  term: string
): Promise<SteamStoreSearchItem[]> {
  const normalizedTerm = term.trim();

  if (normalizedTerm.length < 2) {
    return [];
  }

  const cacheKey = getCacheKey(normalizedTerm);
  const cache = loadCache();
  const cached = cache[cacheKey];

  if (isCacheValid(cached)) {
    return cached.items;
  }

  const items = await resolveSteamStoreSearch({
    term: normalizedTerm,
    countryCode: "US",
    language: "english",
    limit: 8,
  });

  cache[cacheKey] = {
    savedAt: Date.now(),
    items,
  };

  saveCache(cache);

  return items;
}

export function clearSteamStoreSearchCache() {
  localStorage.removeItem(CACHE_KEY);
}