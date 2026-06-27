import { resolveSteamAppMetadata } from "./tauri";
import { SteamAppMetadata } from "../types/gameMetadata";

const CACHE_KEY = "lumaforge-steam-app-metadata-cache";

type MetadataCache = Record<string, SteamAppMetadata>;

function loadCache(): MetadataCache {
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
    platforms: [],
    languages: [],
    dlc_count: 0,
    short_description: null,
    detailed_description: null,
    genres: [],
    publisher: null,
    release_date: null,
    categories: [],
    resolved: false,
  };
}
