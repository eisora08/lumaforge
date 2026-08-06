/**
 * Hybrid catalog service — SteamSpy for real-time player data (top-by-players),
 * local SQLite catalog for quality-curated sections (trending, featured, leaderboard,
 * hidden gems, cult classics). This eliminates duplicate games across sections
 * by using different algorithms on different data sources.
 *
 * SteamSpy rate limit: ~4 req/sec. We throttle to 1/sec.
 */

import type { StoreGame } from "./storeDiscoverCache";
import type { CatalogGameResult } from "./tauri";
import {
  queryFeaturedGames,
  queryHiddenGems,
  queryTopRatedGames,
  queryCultClassics,
} from "./steamCatalogService";

// ── SteamSpy response types (subset) ──
interface SteamSpyEntry {
  appid: number;
  name: string;
  developer: string;
  publisher: string;
  owners: string;
  owners_variance: number;
  players_forever: number;
  players_forever_variance: number;
  players_2weeks: number;
  players_2weeks_variance: number;
  average_forever: number;
  average_2weeks: number;
  median_forever: number;
  median_2weeks: number;
  ccu: number;
  price: string;
  initialprice: string;
  discount: string;
  tags: Record<string, number>;
  languages: string;
  genre: string;
  score_rank: string;
  positive: number;
  negative: number;
  userscore: number;
}

// ── In-memory cache with TTL ──
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, { data: SteamSpyEntry[]; timestamp: number }>();

// ── Rate limiting ──
const MIN_DELAY_MS = 250;
let lastFetchTime = 0;
const pendingFetches = new Map<string, Promise<SteamSpyEntry[]>>();

async function throttledFetch(url: string): Promise<SteamSpyEntry[]> {
  const now = Date.now();
  const elapsed = now - lastFetchTime;
  if (elapsed < MIN_DELAY_MS) {
    await new Promise((r) => setTimeout(r, MIN_DELAY_MS - elapsed));
  }
  lastFetchTime = Date.now();

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SteamSpy API error: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  if (typeof json === "object" && !Array.isArray(json)) {
    return Object.values(json) as SteamSpyEntry[];
  }
  return json as SteamSpyEntry[];
}

async function fetchWithCache(key: string, url: string): Promise<SteamSpyEntry[]> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const existing = pendingFetches.get(key);
  if (existing) return existing;

  const promise = throttledFetch(url).then((data) => {
    cache.set(key, { data, timestamp: Date.now() });
    pendingFetches.delete(key);
    return data;
  }).catch((err) => {
    pendingFetches.delete(key);
    throw err;
  });
  pendingFetches.set(key, promise);
  return promise;
}

// ── Conversion helpers ──

function spyToStoreGame(entry: SteamSpyEntry): StoreGame {
  return {
    appId: String(entry.appid),
    title: entry.name || `App ${entry.appid}`,
    imageUrl: undefined,
    platforms: [],
    sources: [],
  };
}

function catalogToStoreGame(game: CatalogGameResult): StoreGame {
  return {
    appId: String(game.appId),
    title: game.name || `App ${game.appId}`,
    imageUrl: game.headerImage || undefined,
    platforms: [],
    sources: [],
  };
}

// ── SteamSpy sections (real-time player data) ──

/**
 * Top by Players: same endpoint, sorted by total 2-week owners.
 * Source: SteamSpy `top100in2weeks` (real-time signal).
 */
export async function getTopByPlayers(limit = 20): Promise<{ games: StoreGame[] }> {
  const entries = await fetchWithCache("top100in2weeks", "https://steamspy.com/api.php?request=top100in2weeks");
  const sorted = [...entries].sort((a, b) => b.players_2weeks - a.players_2weeks);
  return { games: sorted.slice(0, limit).map(spyToStoreGame) };
}

// ── Local catalog sections (quality algorithms, no duplicates) ──

/**
 * Staff Picks: top rated games with high review% and significant review count.
 * Source: local SQLite catalog (`query_featured` — review_count ≥ 100, review_percent ≥ 75).
 */
export async function getFeaturedGames(limit = 20): Promise<{ games: StoreGame[] }> {
  try {
    const { games } = await queryFeaturedGames(limit);
    return { games: games.map(catalogToStoreGame) };
  } catch {
    return { games: [] };
  }
}

/**
 * Leaderboard: highest-rated games in the entire catalog.
 * Source: local SQLite catalog (`query_top_rated` — review_percent ≥ 80, review_count ≥ 200).
 * Different from Featured: this is pure quality (no popularity weighting).
 */
export async function getLeaderboard(limit = 20): Promise<{ games: StoreGame[] }> {
  try {
    const { games } = await queryTopRatedGames(limit);
    return { games: games.map(catalogToStoreGame) };
  } catch {
    return { games: [] };
  }
}

/**
 * Hidden Gems: high review% (>88%) but moderate review count (50-5000).
 * Source: local SQLite catalog.
 * Niche but beloved — completely different from SteamSpy trending.
 */
export async function getHiddenGems(limit = 16): Promise<{ games: StoreGame[] }> {
  try {
    const { games } = await queryHiddenGems(limit);
    return { games: games.map(catalogToStoreGame) };
  } catch {
    return { games: [] };
  }
}

/**
 * Dedicated Fan Bases: old games with sustained high quality.
 * Source: local SQLite catalog (`query_cult_classics` — released 2+ years ago, review_percent ≥ 85).
 * Completely different from SteamSpy trending — these are evergreen classics.
 */
export async function getMostPlayed(limit = 16): Promise<{ games: StoreGame[] }> {
  try {
    const { games } = await queryCultClassics(limit);
    return { games: games.map(catalogToStoreGame) };
  } catch {
    return { games: [] };
  }
}

/**
 * Genre-specific query (SteamSpy only, kept for future use).
 */
export async function getGamesByGenre(genreId: number, limit = 20): Promise<{ games: StoreGame[] }> {
  const cacheKey = `genre_${genreId}`;
  const entries = await fetchWithCache(cacheKey, `https://steamspy.com/api.php?request=genre&genre=${genreId}`);
  return { games: entries.slice(0, limit).map(spyToStoreGame) };
}

/**
 * Clear all caches (for testing or manual refresh).
 */
export function clearFreeCatalogCaches(): void {
  cache.clear();
  pendingFetches.clear();
}
