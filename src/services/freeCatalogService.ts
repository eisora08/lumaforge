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
import { fetchJsonFromUrl } from "./tauri";

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

// CORS detection — SteamSpy doesn't send CORS headers in Tauri WebView.
// Once we detect a CORS failure, skip all subsequent calls to avoid console spam.
let _corsBlocked = false;

async function throttledFetch(url: string): Promise<SteamSpyEntry[]> {
  if (_corsBlocked) return [];
  const now = Date.now();
  const elapsed = now - lastFetchTime;
  if (elapsed < MIN_DELAY_MS) {
    await new Promise((r) => setTimeout(r, MIN_DELAY_MS - elapsed));
  }
  lastFetchTime = Date.now();

  try {
    const text = await fetchJsonFromUrl(url);
    const json = JSON.parse(text);
    if (typeof json === "object" && !Array.isArray(json)) {
      return Object.values(json) as SteamSpyEntry[];
    }
    return json as SteamSpyEntry[];
  } catch (err) {
    // Detect CORS/network failure
    const msg = String(err);
    if (msg.includes("CORS") || msg.includes("Failed to fetch") || msg.includes("HTTP 0")) {
      _corsBlocked = true;
      console.warn("[FREE_CATALOG] SteamSpy blocked — skipping all future calls:", msg);
    }
    throw err;
  }
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
 * Recent Games: new releases and recent updates getting attention in the last 48 hours.
 * Source: SteamSpy `top100in2days` (short-window signal — captures fresh releases).
 * Distinct from Trending (2-week window): recent games may not yet have sustained momentum.
 */
export async function getRecentGames(limit = 20): Promise<{ games: StoreGame[] }> {
  const entries = await fetchWithCache("top100in2days", "https://steamspy.com/api.php?request=top100in2days");
  const sorted = [...entries].sort((a, b) => b.ccu - a.ccu);
  return { games: sorted.slice(0, limit).map(spyToStoreGame) };
}

/**
 * Trending Now: games with sustained momentum over the last 2 weeks.
 * Source: SteamSpy `top100in2weeks` (real-time signal).
 * Distinct from Recent (48h): trending games have proven staying power.
 */
export async function getTrendingGames(limit = 20): Promise<{ games: StoreGame[] }> {
  const entries = await fetchWithCache("top100in2weeks", "https://steamspy.com/api.php?request=top100in2weeks");
  const sorted = [...entries].sort((a, b) => b.players_2weeks - a.players_2weeks);
  return { games: sorted.slice(0, limit).map(spyToStoreGame) };
}

/**
 * Top by Players: same 2-week endpoint, sorted by total 2-week owners.
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
 * Most Played Right Now: real-time concurrent players across ALL Steam.
 * Source: SteamSpy `all` endpoint (full dataset, not limited to top100).
 * Distinct from free-top-players (top100in2weeks): this covers every game with current CCU data.
 */
export async function getMostPlayedNow(limit = 20): Promise<{ games: StoreGame[] }> {
  const entries = await fetchWithCache("all", "https://steamspy.com/api.php?request=all");
  const sorted = [...entries].sort((a, b) => b.ccu - a.ccu);
  return { games: sorted.filter((e) => e.ccu > 0).slice(0, limit).map(spyToStoreGame) };
}

/**
 * Rising Stars: games gaining traction relative to their all-time player base.
 * Source: SteamSpy `all` endpoint — ratio of 2-week players to total owners.
 * High ratio = new viral momentum; low ratio = fading legacy popularity.
 */
export async function getRisingStars(limit = 20): Promise<{ games: StoreGame[] }> {
  const entries = await fetchWithCache("all", "https://steamspy.com/api.php?request=all");
  const withRatio = entries
    .filter((e) => e.players_2weeks > 5000 && e.players_forever > 10000)
    .map((e) => ({
      entry: e,
      ratio: e.players_2weeks / Math.max(e.players_forever, 1),
    }));
  withRatio.sort((a, b) => b.ratio - a.ratio);
  return { games: withRatio.slice(0, limit).map((w) => spyToStoreGame(w.entry)) };
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
