import { resolveSteamGridDbArtwork } from "./tauri";
import type { SteamGridDbArtwork } from "../types/steamGridDb";

const CACHE_KEY = "lumaforge-store-sgdb-cache-v3";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 5;

type CacheEntry = {
  artwork: SteamGridDbArtwork;
  timestamp: number;
  failed: boolean;
};

function getCache(): Record<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function setCache(cache: Record<string, CacheEntry>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

function tryClearDiskCache() {
  import("./tauriArtworkCache")
    .then((m) => m.default.clearAllArtworkCache())
    .catch(() => {});
}

export type SgdbArtworkData = {
  sgdbGridUrl?: string;
  sgdbGridThumbUrl?: string;
  sgdbHeroUrl?: string;
  sgdbLogoUrl?: string;
};

export async function resolveArtworkForAppIds(
  appIds: number[],
  sgdbApiKey: string
): Promise<Record<string, SgdbArtworkData>> {
  const result: Record<string, SgdbArtworkData> = {};
  if (!sgdbApiKey || appIds.length === 0) return result;

  const cache = getCache();
  const now = Date.now();
  const missing: number[] = [];

  for (const appId of appIds) {
    const key = String(appId);
    const entry = cache[key];
    if (entry) {
      const ttl = entry.failed ? FAILURE_TTL_MS : CACHE_TTL_MS;
      if (now - entry.timestamp < ttl) {
        if (!entry.failed) {
          result[key] = {};
          if (entry.artwork.gridUrl) result[key].sgdbGridUrl = entry.artwork.gridUrl;
          if (entry.artwork.gridThumbUrl) result[key].sgdbGridThumbUrl = entry.artwork.gridThumbUrl;
          if (entry.artwork.heroUrl) result[key].sgdbHeroUrl = entry.artwork.heroUrl;
          if (entry.artwork.logoUrl) result[key].sgdbLogoUrl = entry.artwork.logoUrl;
        }
        continue;
      }
    }
    missing.push(appId);
  }

  if (missing.length === 0) return result;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    try {
      const batchResult = await resolveSteamGridDbArtwork(batch, sgdbApiKey);
      for (const a of batchResult) {
        const key = String(a.appId);
        if (a.gridUrl || a.heroUrl || a.logoUrl) {
          const data: SgdbArtworkData = {};
          if (a.gridUrl) data.sgdbGridUrl = a.gridUrl;
          if (a.gridThumbUrl) data.sgdbGridThumbUrl = a.gridThumbUrl;
          if (a.heroUrl) data.sgdbHeroUrl = a.heroUrl;
          if (a.logoUrl) data.sgdbLogoUrl = a.logoUrl;
          result[key] = data;
        }
        cache[key] = { artwork: a, timestamp: now, failed: !(a.gridUrl || a.heroUrl || a.logoUrl) };
      }
    } catch {
      for (const appId of batch) {
        const key = String(appId);
        cache[key] = {
          artwork: { appId, gridUrl: undefined, gridThumbUrl: undefined, heroUrl: undefined, logoUrl: undefined },
          timestamp: now,
          failed: true,
        };
      }
    }
  }

  setCache(cache);
  return result;
}

export async function clearArtworkCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
  tryClearDiskCache();
}
