import { resolveSteamAppMetadata, readStoreGameDetails, writeStoreGameDetails } from "./tauri";
import type { SteamAppMetadata } from "../types/gameMetadata";

const inMemoryCache = new Map<number, SteamAppMetadata>();

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
      const meta = cached.data as SteamAppMetadata;
      const moviesCount = meta.movies?.length ?? 0;
      const moviesNames = meta.movies?.map((m) => `"${m.name}"`).join(", ") ?? "";
      console.log(`[STORE][STORE_DETAILS_CACHE_MOVIES] appid=${appId} count=${moviesCount} names=${moviesNames}`);
      // If cached as resolved but has 0 movies for a real game (has about_the_game),
      // the cache is stale — treat as miss so the Rust fetch updates it
      if (meta.resolved === true && moviesCount === 0 && meta.about_the_game) {
        console.log(`[STORE][CACHE_MOVIES_STALE] appid=${appId} reason=resolved-but-no-movies forcing-refetch`);
        return null;
      }
      return meta;
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
    const moviesCount = meta.movies?.length ?? 0;
    const moviesNames = meta.movies?.map((m) => `"${m.name}"`).join(", ") ?? "";
    console.log(`[STORE][STEAM_APPDETAILS_FETCH] appid=${meta.app_id} resolved=${meta.resolved} movies=${moviesCount} names=${moviesNames}`);
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

const englishMediaCache = new Map<number, SteamAppMetadata>();

/**
 * Resolve metadata with an English-first strategy for media (movies/trailers).
 *
 * Strategy:
 *   A. Fetch with language=english / cc=US.
 *   B. If no movies in English response, fall back to default (no params).
 *   C. If still no movies, the game has no Steam movies — return original metadata unchanged.
 *
 * Returns a map of enhanced metadata. Callers should merge the `movies` field:
 *   `{ ...existingMeta, movies: enhancedMeta.movies ?? existingMeta.movies }`
 */
export async function resolveGameMetadataForMedia(
  appIds: number[]
): Promise<Record<number, SteamAppMetadata>> {
  const uniqueAppIds = Array.from(new Set(appIds));
  const result: Record<number, SteamAppMetadata> = {};
  const toFetch: number[] = [];

  for (const appId of uniqueAppIds) {
    const cached = englishMediaCache.get(appId);
    if (cached) {
      result[appId] = cached;
    } else {
      toFetch.push(appId);
    }
  }

  if (toFetch.length === 0) {
    return result;
  }

  // Step A — Try English media metadata
  console.log(`[STORE][MEDIA_METADATA] appIds=[${toFetch.join(",")}] trying language=english cc=us`);
  const englishResult = await resolveSteamAppMetadata(toFetch, "english", "US");

  const needsFallback: number[] = [];

  for (const meta of englishResult) {
    const count = meta.movies?.length ?? 0;
    if (meta.resolved && count > 0) {
      console.log(`[STORE][MEDIA_METADATA] appid=${meta.app_id} language=english movies=${count}`);
      englishMediaCache.set(meta.app_id, meta);
      result[meta.app_id] = meta;
    } else {
      needsFallback.push(meta.app_id);
    }
  }

  // Step B — Fallback to default language for those without English movies
  if (needsFallback.length > 0) {
    console.log(`[STORE][MEDIA_METADATA] appIds=[${needsFallback.join(",")}] fallback default language`);
    const fallbackResult = await resolveSteamAppMetadata(needsFallback);
    for (const meta of fallbackResult) {
      const count = meta.movies?.length ?? 0;
      console.log(`[STORE][MEDIA_METADATA] appid=${meta.app_id} language=default movies=${count}`);
      englishMediaCache.set(meta.app_id, meta);
      result[meta.app_id] = meta;
    }
  }

  // Step C — Fill any appIds that neither fetch could resolve
  for (const appId of toFetch) {
    if (!result[appId]) {
      const placeholder = createFallbackMetadata(appId);
      englishMediaCache.set(appId, placeholder);
      result[appId] = placeholder;
    }
  }

  return result;
}

/**
 * Clear both the regular and English-media metadata caches.
 */
export function clearGameMetadataCache() {
  inMemoryCache.clear();
  englishMediaCache.clear();
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
    movies: [],
    resolved: false,
  };
}
