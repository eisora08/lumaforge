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
        artwork: { appId, gridUrl: undefined, gridThumbUrl: undefined, heroUrl: undefined, logoUrl: undefined, iconUrl: undefined },
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
  if (a.gridUrl) data.sgdbGridUrl = a.gridUrl;
  if (a.gridThumbUrl) data.sgdbGridThumbUrl = a.gridThumbUrl;
  if (a.heroUrl) data.sgdbHeroUrl = a.heroUrl;
  if (a.logoUrl) data.sgdbLogoUrl = a.logoUrl;
  if (a.iconUrl) data.sgdbIconUrl = a.iconUrl;
  if (a.gridUrl) data.sgdbCoverUrl = a.gridUrl;
  return data;
}

export function clearArtworkCache() {
  memoryCache.clear();
}
