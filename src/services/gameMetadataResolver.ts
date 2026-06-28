import { resolveSteamAppMetadata } from "./tauri";
import { SteamAppMetadata } from "../types/gameMetadata";

const CACHE_KEY = "lumaforge-steam-app-metadata-cache-v3";

const OLD_CACHE_KEYS = [
  "lumaforge-steam-app-metadata-cache",
  "lumaforge-steam-app-metadata-cache-v2",
];

OLD_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));

type MetadataCache = Record<string, SteamAppMetadata>;

export function loadMetadataCache(): MetadataCache {
  try {
    const rawCache = localStorage.getItem(CACHE_KEY);

    if (!rawCache) {
      return {};
    }

    return JSON.parse(rawCache) as MetadataCache;
  } catch {
    return {};
  }
}

function loadCache(): MetadataCache {
  return loadMetadataCache();
}

function saveCache(cache: MetadataCache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export async function resolveGameMetadata(
  appIds: number[]
): Promise<Record<number, SteamAppMetadata>> {
  const uniqueAppIds = Array.from(new Set(appIds));
  const cache = loadCache();

  const missingAppIds = uniqueAppIds.filter(
    (appId) => !cache[String(appId)]
  );

  if (missingAppIds.length > 0) {
    const resolved = await resolveSteamAppMetadata(missingAppIds);

    resolved.forEach((metadata) => {
      cache[String(metadata.app_id)] = metadata;
    });

    saveCache(cache);
  }

  return uniqueAppIds.reduce<Record<number, SteamAppMetadata>>(
    (result, appId) => {
      result[appId] =
        cache[String(appId)] ?? createFallbackMetadata(appId);

      return result;
    },
    {}
  );
}

export function clearGameMetadataCache() {
  localStorage.removeItem(CACHE_KEY);
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
