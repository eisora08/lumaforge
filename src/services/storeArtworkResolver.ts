import { resolveSteamGridDbArtwork } from "./tauri";
import type { SteamGridDbArtwork } from "../types/steamGridDb";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;
const MAX_CONCURRENT_SGDB_CALLS = 1;

const inFlightAppIds = new Set<number>();
let concurrentCalls = 0;

// In-memory cache only — no localStorage for images or SGDB metadata
const memoryCache = new Map<string, { artwork: SteamGridDbArtwork; timestamp: number; failed: boolean }>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SgdbArtworkData = {
  sgdbGridUrl?: string;
  sgdbGridThumbUrl?: string;
  sgdbHeroUrl?: string;
  sgdbLogoUrl?: string;
  sgdbIconUrl?: string;
  sgdbCoverUrl?: string;
};

export async function resolveArtworkForAppIds(
  appIds: number[],
  sgdbApiKey: string
): Promise<Record<string, SgdbArtworkData>> {
  const result: Record<string, SgdbArtworkData> = {};
  if (!sgdbApiKey || appIds.length === 0) return result;

  const now = Date.now();
  const missing: number[] = [];

  for (const appId of appIds) {
    const key = String(appId);
    const entry = memoryCache.get(key);
    if (entry) {
      const ttl = entry.failed ? FAILURE_TTL_MS : CACHE_TTL_MS;
      if (now - entry.timestamp < ttl) {
        if (!entry.failed) {
          result[key] = buildSgdbData(entry.artwork);
        }
        continue;
      }
    }
    missing.push(appId);
  }

  if (missing.length === 0) return result;

  // Process one appId at a time to limit concurrent SGDB API calls
  for (const appId of missing) {
    if (inFlightAppIds.has(appId)) continue;

    inFlightAppIds.add(appId);

    // Throttle concurrent SGDB calls to 1
    while (concurrentCalls >= MAX_CONCURRENT_SGDB_CALLS) {
      await delay(200);
    }

    concurrentCalls++;
    try {
      await delay(300);
      const batchResult = await resolveSteamGridDbArtwork([appId], sgdbApiKey);
      for (const a of batchResult) {
        const key = String(a.appId);
        if (a.gridUrl || a.heroUrl || a.logoUrl || a.iconUrl) {
          result[key] = buildSgdbData(a);
        }
        memoryCache.set(key, { artwork: a, timestamp: now, failed: !(a.gridUrl || a.heroUrl || a.logoUrl || a.iconUrl) });
      }
    } catch {
      memoryCache.set(String(appId), {
        artwork: { appId, gridUrl: undefined, gridThumbUrl: undefined, gridHorizontalUrl: undefined, gridHorizontalThumbUrl: undefined, heroUrl: undefined, logoUrl: undefined, iconUrl: undefined },
        timestamp: now,
        failed: true,
      });
    } finally {
      concurrentCalls--;
      inFlightAppIds.delete(appId);
    }
  }

  return result;
}

function buildSgdbData(a: SteamGridDbArtwork): SgdbArtworkData {
  const data: SgdbArtworkData = {};
  // Horizontal grid (wide) -> landscape
  if (a.gridHorizontalUrl) data.sgdbGridUrl = a.gridHorizontalUrl;
  if (a.gridHorizontalThumbUrl) data.sgdbGridThumbUrl = a.gridHorizontalThumbUrl;
  // Vertical grid (poster) -> cover
  if (a.gridUrl) data.sgdbCoverUrl = a.gridUrl;
  if (a.gridThumbUrl && !data.sgdbGridThumbUrl) data.sgdbGridThumbUrl = a.gridThumbUrl;
  // Hero -> background
  if (a.heroUrl) data.sgdbHeroUrl = a.heroUrl;
  if (a.logoUrl) data.sgdbLogoUrl = a.logoUrl;
  if (a.iconUrl) data.sgdbIconUrl = a.iconUrl;
  // Fallback: if no horizontal grid, use vertical grid as landscape fallback
  if (!data.sgdbGridUrl && a.gridUrl) data.sgdbGridUrl = a.gridUrl;
  return data;
}

export function clearArtworkCache() {
  memoryCache.clear();
}

/* ── RAWG artwork fetch ── */

export type RawgArtworkData = {
  rawgBackgroundUrl?: string;
};

export interface FetchRawgArtworkOptions {
  apiKey: string;
  appId: string;
}

const _rawgInFlight = new Set<string>();

/**
 * Fetch a single artwork URL from RAWG for a Steam appId.
 * RAWG stores Steam ↔ RAWG ID mappings, so we can query by Steam appId.
 * Gracefully returns {} when apiKey is empty.
 */
export async function fetchRawgArtworkDeduped(
  options: FetchRawgArtworkOptions,
): Promise<RawgArtworkData> {
  if (!options.apiKey) return {};

  const key = `rawg::${options.appId}::*`;
  if (_rawgInFlight.has(key)) return {};

  _rawgInFlight.add(key);
  try {
    const url = `https://api.rawg.io/api/games?key=${encodeURIComponent(options.apiKey)}&search_exact=true&search_steam=${options.appId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};

    const body = await res.json() as { results?: { background_image?: string }[] };
    const bg = body.results?.[0]?.background_image;
    if (bg) return { rawgBackgroundUrl: bg };
    return {};
  } catch {
    return {};
  } finally {
    _rawgInFlight.delete(key);
  }
}

/* ── IGDB artwork fetch ── */

export type IgdbArtworkData = {
  igdbCoverUrl?: string;
  igdbArtworkUrl?: string;
};

export interface FetchIgdbArtworkOptions {
  clientId: string;
  accessToken: string;
  appId: string;
}

const _igdbInFlight = new Set<string>();

/**
 * Fetch cover + artwork from IGDB for a Steam appId.
 * IGDB stores steam_application_id in the games table.
 * Both clientId and accessToken must be non‑empty; otherwise returns {}.
 */
export async function fetchIgdbArtworkDeduped(
  options: FetchIgdbArtworkOptions,
): Promise<IgdbArtworkData> {
  if (!options.clientId || !options.accessToken) return {};

  const key = `igdb::${options.appId}::*`;
  if (_igdbInFlight.has(key)) return {};

  _igdbInFlight.add(key);
  try {
    const headers = {
      "Client-ID": options.clientId,
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "text/plain",
    };

    const gameBody = `fields cover; where steam_application_id = ${options.appId}; limit 1;`;
    const gameRes = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers,
      body: gameBody,
      signal: AbortSignal.timeout(8000),
    });
    if (!gameRes.ok) return {};
    const games = await gameRes.json() as { cover?: number }[];
    const coverId = games[0]?.cover;
    if (!coverId) return {};

    const coverBody = `fields url; where id = ${coverId}; limit 1;`;
    const coverRes = await fetch("https://api.igdb.com/v4/covers", {
      method: "POST",
      headers,
      body: coverBody,
      signal: AbortSignal.timeout(8000),
    });
    if (!coverRes.ok) return {};
    const covers = await coverRes.json() as { url?: string }[];
    const rawUrl = covers[0]?.url;
    if (!rawUrl) return {};

    const igdbCoverUrl = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;

    return {
      igdbCoverUrl: igdbCoverUrl.replace("t_thumb", "t_cover_big"),
    };
  } catch {
    return {};
  } finally {
    _igdbInFlight.delete(key);
  }
}

export function clearArtworkProviderInFlight(): void {
  _rawgInFlight.clear();
  _igdbInFlight.clear();
}
