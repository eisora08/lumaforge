/**
 * Hybrid catalog service — SteamSpy HTML scraping for real-time trending data,
 * Steam Store featuredcategories for new releases, local SQLite catalog for
 * quality-curated sections (leaderboard, featured, hidden gems, cult classics).
 *
 * All external API results are cached for 24 hours.
 * All network calls are async (Rust reqwest via Tauri invoke) — never block.
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

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
interface CacheEntry { data: StoreGame[]; timestamp: number; }
const _cache = new Map<string, CacheEntry>();

function getCached(key: string): StoreGame[] | null {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) return entry.data;
  return null;
}

function setCached(key: string, data: StoreGame[]): void {
  _cache.set(key, { data, timestamp: Date.now() });
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

// ══════════════════════════════════════════════════════════════════════════
// EXTERNAL API SECTIONS (network + 24h cache)
// ══════════════════════════════════════════════════════════════════════════

export async function getTrendingFromScraping(limit = 20): Promise<{ games: StoreGame[] }> {
  const cached = getCached("trending-scraped");
  if (cached) {
    console.log(`[FREE_CATALOG][TRENDING] cache=hit returned=${cached.length}`);
    return { games: cached };
  }
  try {
    const html = await fetchJsonFromUrl("https://steamspy.com/");
    const games = parseTrendingHtml(html, limit);
    setCached("trending-scraped", games);
    console.log(`[FREE_CATALOG][TRENDING] api=steamspy-html returned=${games.length}`);
    return { games };
  } catch (err) {
    console.warn("[FREE_CATALOG][TRENDING] api=steamspy-html error:", err);
    return { games: [] };
  }
}

function parseTrendingHtml(html: string, limit: number): StoreGame[] {
  const games: StoreGame[] = [];
  const seen = new Set<string>();
  const appLinkRegex = /\/app\/(\d+)/g;
  const nameRegex = /<a[^>]+href="\/app\/\d+"[^>]*>([^<]+)<\/a>/gi;
  const imgRegex = /<img[^>]+src="([^"]*capsule[^"]*)"[^>]*>/gi;

  const appIds: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = appLinkRegex.exec(html)) !== null) {
    const id = match[1];
    if (!seen.has(id)) { seen.add(id); appIds.push(id); }
  }

  const nameMap = new Map<string, string>();
  while ((match = nameRegex.exec(html)) !== null) {
    const name = match[1].trim();
    const before = html.substring(Math.max(0, match.index - 200), match.index);
    const idMatch = /\/app\/(\d+)/.exec(before);
    if (idMatch && !nameMap.has(idMatch[1])) nameMap.set(idMatch[1], name);
  }

  const imgMap = new Map<string, string>();
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    const before = html.substring(Math.max(0, match.index - 200), match.index);
    const idMatch = /\/app\/(\d+)/.exec(before);
    if (idMatch && !imgMap.has(idMatch[1])) {
      imgMap.set(idMatch[1], url.startsWith("//") ? `https:${url}` : url);
    }
  }

  for (const id of appIds) {
    if (games.length >= limit) break;
    games.push({
      appId: id,
      title: nameMap.get(id) || `App ${id}`,
      imageUrl: imgMap.get(id) || `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
      platforms: [],
      sources: [],
    });
  }
  return games;
}

export async function getNewReleasesFromSteam(limit = 20): Promise<{ games: StoreGame[] }> {
  const cached = getCached("steam-new-releases");
  if (cached) {
    console.log(`[FREE_CATALOG][NEW_RELEASES] cache=hit returned=${cached.length}`);
    return { games: cached };
  }
  try {
    const text = await fetchJsonFromUrl(
      "https://store.steampowered.com/api/featuredcategories?cc=us&l=english"
    );
    const json = JSON.parse(text);
    const games = parseFeaturedcategoriesNewReleases(json, limit);
    setCached("steam-new-releases", games);
    console.log(`[FREE_CATALOG][NEW_RELEASES] api=steam-featuredcategories returned=${games.length}`);
    return { games };
  } catch (err) {
    console.warn("[FREE_CATALOG][NEW_RELEASES] api=steam-featuredcategories error:", err);
    return { games: [] };
  }
}

function parseFeaturedcategoriesNewReleases(json: Record<string, unknown>, limit: number): StoreGame[] {
  const games: StoreGame[] = [];
  for (const key of Object.keys(json)) {
    const category = json[key] as Record<string, unknown> | undefined;
    if (!category || typeof category !== "object") continue;
    if (category.id !== "cat_newreleases") continue;
    const items = category.items as Array<Record<string, unknown>> | undefined;
    if (!items || !Array.isArray(items)) continue;
    for (const item of items) {
      if (games.length >= limit) break;
      const appId = String(item.id ?? "");
      const name = String(item.name ?? "");
      if (!appId || !name) continue;
      games.push({
        appId,
        title: name,
        imageUrl: (item.header_image as string) || `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
        platforms: [],
        sources: [],
      });
    }
    break;
  }
  return games;
}

// ══════════════════════════════════════════════════════════════════════════
// LOCAL CATALOG SECTIONS (SQLite, no network)
// ══════════════════════════════════════════════════════════════════════════

export async function getFeaturedGames(limit = 20): Promise<{ games: StoreGame[] }> {
  try {
    const { games } = await queryFeaturedGames(limit);
    console.log(`[FREE_CATALOG][STAFF_PICKS] api=sqlite returned=${games.length}`);
    return { games: games.map(catalogToStoreGame) };
  } catch (err) {
    console.warn("[FREE_CATALOG][STAFF_PICKS] error:", err);
    return { games: [] };
  }
}

export async function getLeaderboard(limit = 20): Promise<{ games: StoreGame[] }> {
  try {
    const { games } = await queryTopRatedGames(limit);
    console.log(`[FREE_CATALOG][LEADERBOARD] api=sqlite returned=${games.length}`);
    return { games: games.map(catalogToStoreGame) };
  } catch (err) {
    console.warn("[FREE_CATALOG][LEADERBOARD] error:", err);
    return { games: [] };
  }
}

export async function getHiddenGems(limit = 16): Promise<{ games: StoreGame[] }> {
  try {
    const { games } = await queryHiddenGems(limit);
    console.log(`[FREE_CATALOG][HIDDEN_GEMS] api=sqlite returned=${games.length}`);
    return { games: games.map(catalogToStoreGame) };
  } catch (err) {
    console.warn("[FREE_CATALOG][HIDDEN_GEMS] error:", err);
    return { games: [] };
  }
}

export async function getMostPlayed(limit = 16): Promise<{ games: StoreGame[] }> {
  try {
    const { games } = await queryCultClassics(limit);
    console.log(`[FREE_CATALOG][DEDICATED_FANS] api=sqlite returned=${games.length}`);
    return { games: games.map(catalogToStoreGame) };
  } catch (err) {
    console.warn("[FREE_CATALOG][DEDICATED_FANS] error:", err);
    return { games: [] };
  }
}

export function clearFreeCatalogCaches(): void {
  _cache.clear();
}
