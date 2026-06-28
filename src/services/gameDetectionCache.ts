import type { LauncherGame } from "../types/launcherGame";

const CACHE_KEY = "lumaforge-detected-games-cache-v2";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type DetectedGamesCache = {
  savedAt: number;
  games: LauncherGame[];
  warnings?: string[];
  errors?: string[];
};

export function loadCachedGames(): DetectedGamesCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache: DetectedGamesCache = JSON.parse(raw);
    if (!Array.isArray(cache.games) || typeof cache.savedAt !== "number") {
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

export function saveCachedGames(
  games: LauncherGame[],
  warnings?: string[],
  errors?: string[]
): void {
  try {
    const cache: DetectedGamesCache = {
      savedAt: Date.now(),
      games,
      warnings,
      errors,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage full or unavailable
  }
}

export function isCacheExpired(cache: DetectedGamesCache): boolean {
  return Date.now() - cache.savedAt > CACHE_TTL_MS;
}

export function clearCachedGames(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}
