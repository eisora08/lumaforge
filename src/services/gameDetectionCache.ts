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
    const json = await invoke<string | null>("read_library_cache", { key: CACHE_KEY });
    if (!json) return null;
    const parsed: DetectedGamesCache = JSON.parse(json);
    if (!Array.isArray(parsed.games) || typeof parsed.savedAt !== "number") {
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
