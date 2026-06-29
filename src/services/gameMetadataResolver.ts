import { resolveSteamAppMetadata, readStoreGameDetails, writeStoreGameDetails } from "./tauri";
import type { SteamAppMetadata } from "../types/gameMetadata";

const ENABLE_VERBOSE_STORE_CACHE_LOGS = false;

const inMemoryCache = new Map<number, SteamAppMetadata>();

function log(...args: unknown[]) {
  if (ENABLE_VERBOSE_STORE_CACHE_LOGS) {
    console.debug("[MetadataResolver]", ...args);
  }
}

export function loadMetadataCache(): Record<string, SteamAppMetadata> {
  const result: Record<string, SteamAppMetadata> = {};
  for (const [appId, meta] of inMemoryCache) {
    result[String(appId)] = meta;
  }
  return result;
}

async function loadFromAppCache(appId: number): Promise<SteamAppMetadata | null> {
  try {
    const cached = await readStoreGameDetails(appId);
    if (cached && cached.data) {
      log("app-data cache hit for", appId);
      return cached.data as SteamAppMetadata;
    }
  } catch {
    // corrupt or missing
  }
  return null;
}

async function saveToAppCache(appId: number, data: SteamAppMetadata): Promise<void> {
  try {
    await writeStoreGameDetails(appId, {
      app_id: appId,
      data,
      updated_at: Date.now(),
      version: 1,
    });
  } catch {
    // non-critical
  }
}

export async function resolveGameMetadata(
  appIds: number[]
): Promise<Record<number, SteamAppMetadata>> {
  const uniqueAppIds = Array.from(new Set(appIds));
  const result: Record<number, SteamAppMetadata> = {};
  const missingAppIds: number[] = [];

  for (const appId of uniqueAppIds) {
    const cached = inMemoryCache.get(appId);
    if (cached) {
      result[appId] = cached;
    } else {
      missingAppIds.push(appId);
    }
  }

  if (missingAppIds.length === 0) {
    return result;
  }

  const toFetch: number[] = [];

  for (const appId of missingAppIds) {
    const fromDisk = await loadFromAppCache(appId);
    if (fromDisk) {
      inMemoryCache.set(appId, fromDisk);
      result[appId] = fromDisk;
    } else {
      toFetch.push(appId);
    }
  }

  if (toFetch.length === 0) {
    return result;
  }

  const resolved = await resolveSteamAppMetadata(toFetch);

  for (const meta of resolved) {
    if (meta.resolved) {
      inMemoryCache.set(meta.app_id, meta);
      saveToAppCache(meta.app_id, meta);
    }
    result[meta.app_id] = meta;
  }

  for (const appId of toFetch) {
    if (!result[appId]) {
      result[appId] = createFallbackMetadata(appId);
    }
  }

  return result;
}

export function clearGameMetadataCache() {
  inMemoryCache.clear();
}

function createFallbackMetadata(appId: number): SteamAppMetadata {
  return {
    app_id: appId,
    name: `Steam App ${appId}`,
    developer: null,
    header_image: null,
    capsule_image: null,
    capsule_image_v5: null,
    library_hero_image: null,
    background_image: null,
    hero_image: null,
    library_header_image: null,
    wide_cover_image: null,
    logo_image: null,
    library_logo_image: null,
    platforms: [],
    languages: [],
    dlc_count: 0,
    short_description: null,
    detailed_description: null,
    about_the_game: null,
    genres: [],
    publishers: [],
    release_date: null,
    categories: [],
    dlc_app_ids: [],
    pc_requirements: null,
    mac_requirements: null,
    linux_requirements: null,
    screenshots: [],
    resolved: false,
  };
}
