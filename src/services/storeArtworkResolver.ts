import { resolveSteamGridDbArtwork, igdbSearchBySteamAppId, igdbSearchGamesByName, readStoreSgdbArtworkCache, writeStoreSgdbArtworkCache } from "./tauri";
import type { SteamGridDbArtwork } from "../types/steamGridDb";
import { getIgdbAccessToken } from "./igdbAccessTokenService";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;
const MAX_CONCURRENT_SGDB_CALLS = 5;

const inFlightAppIds = new Set<number>();
let concurrentCalls = 0;

// In-memory cache — seeded from disk on boot, persisted on resolution
const memoryCache = new Map<string, { artwork: SteamGridDbArtwork; timestamp: number; failed: boolean }>();

// ── Disk persistence ──

type SgdbCachePersisted = {
  entries: Record<string, { artwork: SteamGridDbArtwork; timestamp: number; failed: boolean }>;
};

let _diskLoaded = false;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 5000;

async function loadSgdbCacheFromDisk(): Promise<void> {
  if (_diskLoaded) return;
  _diskLoaded = true;
  try {
    const raw = await readStoreSgdbArtworkCache();
    if (!raw) return;
    const data = raw as SgdbCachePersisted;
    if (!data.entries) return;
    const now = Date.now();
    let loaded = 0;
    for (const [key, entry] of Object.entries(data.entries)) {
      const ttl = entry.failed ? FAILURE_TTL_MS : CACHE_TTL_MS;
      if (now - entry.timestamp < ttl) {
        memoryCache.set(key, entry);
        loaded++;
      }
    }
    if (loaded > 0) {
      console.log(`[SGDB_CACHE][DISK_LOAD] entries=${loaded} total=${Object.keys(data.entries).length}`);
    }
  } catch {
    // Corrupt file — ignore
  }
}

function scheduleSaveSgdbCacheToDisk(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    persistSgdbCacheToDisk();
  }, SAVE_DEBOUNCE_MS);
}

async function persistSgdbCacheToDisk(): Promise<void> {
  if (memoryCache.size === 0) return;
  try {
    const entries: Record<string, { artwork: SteamGridDbArtwork; timestamp: number; failed: boolean }> = {};
    for (const [key, entry] of memoryCache) {
      entries[key] = entry;
    }
    await writeStoreSgdbArtworkCache({ entries } satisfies SgdbCachePersisted);
    console.log(`[SGDB_CACHE][DISK_SAVE] entries=${memoryCache.size}`);
  } catch {
    // Best-effort — don't crash
  }
}

// Kick off disk load on module import (fire-and-forget)
loadSgdbCacheFromDisk();

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
      await delay(50);
    }

    concurrentCalls++;
    try {
      await delay(150);
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

  if (missing.length > 0) {
    scheduleSaveSgdbCacheToDisk();
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

export async function clearArtworkCache() {
  memoryCache.clear();
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  await writeStoreSgdbArtworkCache({ entries: {} }).catch(() => {});
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
  clientSecret: string;
  appId: string;
}

const _igdbInFlight = new Set<string>();

/**
 * Fetch cover + artwork from IGDB for a Steam appId.
 * IGDB stores steam_application_id in the games table.
 * clientSecret is the Twitch OAuth client secret — exchanged for an access_token
 * via Twitch OAuth before calling IGDB. Never sent directly to IGDB.
 * All IGDB HTTP calls go through Rust backend to avoid CORS.
 */
export async function fetchIgdbArtworkDeduped(
  options: FetchIgdbArtworkOptions,
): Promise<IgdbArtworkData> {
  if (!options.clientId || !options.clientSecret) return {};

  const key = `igdb::${options.appId}::*`;
  if (_igdbInFlight.has(key)) return {};

  _igdbInFlight.add(key);
  try {
    const accessToken = await getIgdbAccessToken(options.clientId, options.clientSecret);
    const result = await igdbSearchBySteamAppId(
      options.clientId,
      accessToken,
      options.appId,
    );
    if (result?.cover_url) {
      return { igdbCoverUrl: result.cover_url };
    }
    return {};
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

/* ── IGDB name-based metadata search (for manual games) ── */

export interface IgdbMetadataByNameResult {
  igdbId?: number;
  name?: string;
  summary?: string;
  releaseDate?: string;
  genres?: string[];
  developers?: string[];
  publishers?: string[];
  coverUrl?: string;
  screenshotUrls?: string[];
}

const _igdbNameInFlight = new Set<string>();

const DEBUG_MANUAL_META = false;

/**
 * Search IGDB by game name and return metadata + artwork URLs.
 * Used for manual games that don't have a Steam App ID.
 * clientSecret is the Twitch OAuth client secret — exchanged for an access_token
 * via Twitch OAuth before calling IGDB. Never sent directly to IGDB.
 * All IGDB HTTP calls go through Rust backend to avoid CORS.
 *
 * @throws {string} User-friendly error on auth failure (caller should show toast).
 */
export async function fetchIgdbMetadataByName(
  clientId: string,
  clientSecret: string,
  gameName: string,
): Promise<IgdbMetadataByNameResult | null> {
  if (!clientId || !clientSecret || !gameName.trim()) {
    if (DEBUG_MANUAL_META) console.log(`[IGDB_NAME] early return: clientId=${!!clientId} clientSecret=${!!clientSecret} gameName="${gameName.trim()}"`);
    return null;
  }

  const key = `igdb-name::${gameName.toLowerCase().trim()}`;
  if (_igdbNameInFlight.has(key)) {
    if (DEBUG_MANUAL_META) console.log(`[IGDB_NAME] dedup hit: key="${key}"`);
    return null;
  }

  _igdbNameInFlight.add(key);
  try {
    if (DEBUG_MANUAL_META) console.log(`[IGDB_NAME] exchanging client credentials for access token...`);
    const accessToken = await getIgdbAccessToken(clientId, clientSecret);

    if (DEBUG_MANUAL_META) console.log(`[IGDB_NAME] calling igdbSearchGamesByName("${gameName}", 3)...`);
    const results = await igdbSearchGamesByName(
      clientId,
      accessToken,
      gameName,
      3,
    );
    if (DEBUG_MANUAL_META) console.log(`[IGDB_NAME] raw results:`, results);
    if (!results || results.length === 0) {
      if (DEBUG_MANUAL_META) console.log("[IGDB_NAME] no results from Rust");
      return null;
    }

    const game = results[0];
    const mapped: IgdbMetadataByNameResult = {
      igdbId: game.igdb_id ?? undefined,
      name: game.name ?? undefined,
      summary: game.summary ?? undefined,
      releaseDate: game.release_date ?? undefined,
      genres: game.genres?.length ? game.genres : undefined,
      developers: game.developers?.length ? game.developers : undefined,
      publishers: game.publishers?.length ? game.publishers : undefined,
      coverUrl: game.cover_url ?? undefined,
      screenshotUrls: game.screenshot_urls?.length ? game.screenshot_urls : undefined,
    };
    if (DEBUG_MANUAL_META) console.log(`[IGDB_NAME] mapped result:`, mapped);
    return mapped;
  } catch (e) {
    if (DEBUG_MANUAL_META) console.error("[IGDB_NAME] error:", e);
    // Re-throw user-friendly auth errors (strings from getIgdbAccessToken)
    // so the caller (GameEditDialog) can show the correct toast.
    // Silently swallow transient IGDB API errors (return null).
    if (typeof e === "string" && (e.includes("authenticate") || e.includes("credentials"))) {
      throw e;
    }
    return null;
  } finally {
    _igdbNameInFlight.delete(key);
  }
}
