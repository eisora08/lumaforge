import { invoke } from "@tauri-apps/api/core";
import type { LibraryGame } from "../types/libraryGame";
import { dedupeLibraryGames } from "./gameCacheService";

const CACHE_KEY = "lumaforge-library-games-v3";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type DetectedGamesCache = {
  savedAt: number;
  games: LibraryGame[];
  warnings?: string[];
  errors?: string[];
};

let inMemoryCache: DetectedGamesCache | null = null;
let loadPromise: Promise<DetectedGamesCache | null> | null = null;

async function readFromSqlite(): Promise<DetectedGamesCache | null> {
  try {
    // Rust returns Option<LibraryCacheEntry> = { cache_key, cache_value, saved_at }
    // We need the inner cache_value string which holds the JSON-serialized DetectedGamesCache.
    const entry = await invoke<{ cache_key?: string; cache_value?: string; saved_at?: number } | null>(
      "read_library_cache",
      { key: CACHE_KEY },
    );
    if (!entry) return null;
    // Handle both snake_case (Rust serde default) and camelCase (renamed)
    const jsonStr = entry.cache_value ?? (entry as Record<string, unknown>)["cacheValue"] as string | undefined;
    if (!jsonStr) return null;
    const parsed: DetectedGamesCache = JSON.parse(jsonStr);
    if (!Array.isArray(parsed.games) || typeof parsed.savedAt !== "number") {
      return null;
    }
    // An empty games list is a poisoned cache (e.g. a scan wrote [] over a real
    // library). Treat it as a miss so boot falls back to reconciled/snapshot
    // data and a fresh scan runs to repopulate the cache.
    if (parsed.games.length === 0) {
      console.log("[LIBRARY_CACHE][EMPTY_MISS] empty cache ignored — will rescan");
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function loadCachedGames(): Promise<DetectedGamesCache | null> {
  if (inMemoryCache) return inMemoryCache;
  if (loadPromise) return loadPromise;
  loadPromise = readFromSqlite().then((cache) => {
    inMemoryCache = cache;
    loadPromise = null;
    return cache;
  });
  return loadPromise;
}

export async function saveCachedGames(
  games: LibraryGame[],
  warnings?: string[],
  errors?: string[],
): Promise<void> {
  const deduped = dedupeLibraryGames(games);
  if (deduped.length !== games.length) {
    console.log(`[LIBRARY_CACHE][DEDUP] before=${games.length} after=${deduped.length}`);
  }
  // Never persist an empty library over a real one — an empty write poisons the
  // cache (it is memoized as fresh and blocks future scans). Existing in-memory
  // cache is preserved so reads keep returning real data.
  if (deduped.length === 0) {
    console.log("[LIBRARY_CACHE][EMPTY_SKIP] refusing to persist empty library");
    return;
  }
  const cache: DetectedGamesCache = {
    savedAt: Date.now(),
    games: deduped,
    warnings,
    errors,
  };
  inMemoryCache = cache;
  try {
    await invoke("write_library_cache", { key: CACHE_KEY, value: JSON.stringify(cache) });
  } catch {
    // SQLite unavailable
  }
}

export function isCacheExpired(cache: DetectedGamesCache): boolean {
  return Date.now() - cache.savedAt > CACHE_TTL_MS;
}

export async function clearCachedGames(): Promise<void> {
  inMemoryCache = null;
  try {
    await invoke("delete_library_cache", { key: CACHE_KEY });
  } catch {
    // ignore
  }
}
