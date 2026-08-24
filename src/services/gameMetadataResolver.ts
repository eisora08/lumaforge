import { resolveSteamAppMetadata, getStoreDetails } from "./tauri";
import { persistStoreDetails } from "./gameCacheService";
import type { SteamAppMetadata, SteamMovie } from "../types/gameMetadata";
import type { ResolvedGameTrailer } from "../types/gameMedia";
import i18n from "../i18n";

const ENABLE_VERBOSE_APPDETAILS_FETCH = false;
/** Gate per-appId disk-cache movie logging — off by default to avoid log spam from 200+ calls. */
const DEBUG_CACHE_MOVIES_LOG = false;
const inMemoryCache = new Map<string, SteamAppMetadata>();
/** Per-appId in-flight dedup — prevents overlapping boot batches from fetching the same appId twice. */
const metadataInFlightByAppId = new Map<string, Promise<SteamAppMetadata>>();
/** Per-batch-key in-flight dedup for resolveGameMetadataForMedia (batch-level is acceptable here since media resolution is inherently per-batch). */
const mediaInFlight = new Map<string, Promise<Record<number, SteamAppMetadata>>>();

/** Return Steam API locale params based on the user's selected UI language. */
function getSteamLocale(): { language: string; country: string } {
  return i18n.language === "es"
    ? { language: "spanish", country: "ES" }
    : { language: "english", country: "US" };
}

/** Build a cache key that includes the language so metadata is per-locale. */
function cacheKey(appId: number): string {
  return `${appId}:${i18n.language}`;
}

async function loadFromAppCache(appId: number): Promise<SteamAppMetadata | null> {
  try {
    const key = cacheKey(appId);
    const cached = await getStoreDetails(key);
    if (cached && cached.data) {
      const meta = cached.data as SteamAppMetadata;
      if (DEBUG_CACHE_MOVIES_LOG) {
        const moviesCount = meta.movies?.length ?? 0;
        const moviesNames = meta.movies?.map((m) => `"${m.name}"`).join(", ") ?? "";
        console.log(`[STORE][STORE_DETAILS_CACHE_MOVIES] appid=${appId} count=${moviesCount} names=${moviesNames}`);
      }
      if (meta.resolved === true) {
        return meta;
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
    const key = cacheKey(appId);
    await persistStoreDetails(key, {
      app_id: key,
      source: "metadata-resolver",
      updated_at: Math.floor(Date.now() / 1000),
      data,
    });
  } catch {
    // non-critical
  }
}

/** Parallel disk read with bounded concurrency — avoids sequential Tauri IPC bottleneck. */
async function parallelDiskRead(
  appIds: number[],
  concurrency = 20,
): Promise<{ appId: number; meta: SteamAppMetadata | null }[]> {
  const results: { appId: number; meta: SteamAppMetadata | null }[] = [];
  let idx = 0;

  async function next(): Promise<void> {
    while (idx < appIds.length) {
      const i = idx++;
      const appId = appIds[i];
      const meta = await loadFromAppCache(appId);
      results.push({ appId, meta });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, appIds.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export interface ResolveMetadataOptions {
  /**
   * Skip the per-appId in-flight dedup so each appId issues its own fresh fetch
   * instead of waiting on a previously-started shared batch. Used by the Store
   * detail effect so a search-selected game resolves fast and independently of a
   * slow (serial) batch that may already be in flight.
   */
  skipInFlight?: boolean;
}

export async function resolveGameMetadata(
  appIds: number[],
  options: ResolveMetadataOptions = {}
): Promise<Record<number, SteamAppMetadata>> {
  const uniqueAppIds = Array.from(new Set(appIds));
  const result: Record<number, SteamAppMetadata> = {};
  const missingAppIds: number[] = [];

  for (const appId of uniqueAppIds) {
    const key = cacheKey(appId);
    const cached = inMemoryCache.get(key);
    if (cached) {
      result[appId] = cached;
      if ((window as any).__DEBUG_META_TRACE) console.log(`[META_TRACE][RESOLVER] appId=${appId} → cache HIT resolved=${cached.resolved} hasShortDesc=${!!cached.short_description} name="${cached.name}"`);
    } else {
      missingAppIds.push(appId);
    }
  }

  if (missingAppIds.length === 0) {
    if ((window as any).__DEBUG_META_TRACE) console.log(`[META_TRACE][RESOLVER] all ${uniqueAppIds.length} appIds from inMemoryCache`);
    return result;
  }

  if ((window as any).__DEBUG_META_TRACE) console.log(`[META_TRACE][RESOLVER] ${missingAppIds.length} missing from cache, reading disk: [${missingAppIds.join(",")}]`);
  const toFetch: number[] = [];

  // Phase 9: Parallel disk reads instead of sequential for..await.
  // With 80 appIds, parallel completes in ~200ms vs ~4000ms sequential.
  const diskResults = await parallelDiskRead(missingAppIds);

  for (const { appId, meta } of diskResults) {
    if (meta) {
      inMemoryCache.set(cacheKey(appId), meta);
      result[appId] = meta;
      if ((window as any).__DEBUG_META_TRACE) console.log(`[META_TRACE][RESOLVER] appId=${appId} → disk HIT resolved=${meta.resolved} hasShortDesc=${!!meta.short_description}`);
    } else {
      toFetch.push(appId);
      if ((window as any).__DEBUG_META_TRACE) console.log(`[META_TRACE][RESOLVER] appId=${appId} → disk MISS, will fetch`);
    }
  }

  if (toFetch.length === 0) {
    if ((window as any).__DEBUG_META_TRACE) console.log(`[META_TRACE][RESOLVER] all found from disk, returning`);
    return result;
  }

  // Per-appId in-flight dedup: if any of the toFetch appIds are already being fetched,
  // reuse their promise instead of issuing a duplicate Rust call.
  const trulyNeedsFetch: number[] = [];
  const inFlightPromises: Promise<void>[] = [];

  for (const appId of toFetch) {
    if (options.skipInFlight) {
      trulyNeedsFetch.push(appId);
      continue;
    }
    const key = cacheKey(appId);
    const inflight = metadataInFlightByAppId.get(key);
    if (inflight) {
      inFlightPromises.push(
        inflight.then((meta) => {
          result[appId] = meta;
        })
      );
    } else {
      trulyNeedsFetch.push(appId);
    }
  }

  if (inFlightPromises.length > 0) {
    await Promise.all(inFlightPromises);
  }

  if (trulyNeedsFetch.length === 0) {
    return result;
  }

  // Fetch metadata with the user's locale
  const { language, country } = getSteamLocale();
  const fetchPromise = resolveSteamAppMetadata(trulyNeedsFetch, language, country).then((resolved) => {
    const map: Record<number, SteamAppMetadata> = {};
    for (const meta of resolved) {
      map[meta.app_id] = meta;
    }
    return map;
  });

  // Register all per-appId promises sharing the same batch fetch
  for (const appId of trulyNeedsFetch) {
    const key = cacheKey(appId);
    metadataInFlightByAppId.set(
      key,
      fetchPromise.then((map) => map[appId] ?? createFallbackMetadata(appId))
    );
  }

  const resolvedMap = await fetchPromise;

  if ((window as any).__DEBUG_META_TRACE) console.log(`[META_TRACE][RESOLVER] network fetch returned ${Object.keys(resolvedMap).length} entries`);

  for (const [appId, meta] of Object.entries(resolvedMap)) {
    const moviesCount = meta.movies?.length ?? 0;
    const moviesNames = meta.movies?.map((m) => `"${m.name}"`).join(", ") ?? "";
    if (ENABLE_VERBOSE_APPDETAILS_FETCH) {
      console.log(`[STORE][STEAM_APPDETAILS_FETCH] appid=${meta.app_id} resolved=${meta.resolved} movies=${moviesCount} names=${moviesNames}`);
    }
    if (meta.resolved) {
      inMemoryCache.set(cacheKey(meta.app_id), meta);
      saveToAppCache(meta.app_id, meta);
    }
    result[Number(appId)] = meta;
  }

  // Fill any trulyNeedsFetch appIds that the Rust call didn't return
  for (const appId of trulyNeedsFetch) {
    if (!result[appId]) {
      result[appId] = createFallbackMetadata(appId);
    }
  }

  return result;
}

const englishMediaCache = new Map<string, SteamAppMetadata>();

/**
 * Resolve metadata with a locale-aware strategy for media (movies/trailers).
 *
 * Strategy:
 *   A. Fetch with user's locale language/country.
 *   B. If no movies in localized response, fall back to English.
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
    const key = cacheKey(appId);
    const cached = englishMediaCache.get(key);
    if (cached) {
      result[appId] = cached;
    } else {
      toFetch.push(appId);
    }
  }

  if (toFetch.length === 0) {
    return result;
  }

  // Dedup in-flight media metadata requests for the same batch
  const mediaKey = `media:${i18n.language}:${toFetch.join(",")}`;
  const mediaPending = mediaInFlight.get(mediaKey);
  if (mediaPending) {
    const resolved = await mediaPending;
    for (const [id, meta] of Object.entries(resolved)) {
      if (meta.resolved || id) {
        result[Number(id)] = meta;
      }
    }
    return result;
  }

  const mediaPromise = (async () => {
    // Step A — Try user's locale for media metadata
    const { language, country } = getSteamLocale();
    if (ENABLE_VERBOSE_APPDETAILS_FETCH) console.log(`[STORE][MEDIA_METADATA] appIds=[${toFetch.join(",")}] trying language=${language} cc=${country}`);
    const localizedResult = await resolveSteamAppMetadata(toFetch, language, country);

    const needsFallback: number[] = [];
    const stepResult: Record<number, SteamAppMetadata> = {};

    for (const meta of localizedResult) {
      const count = meta.movies?.length ?? 0;
      if (ENABLE_VERBOSE_APPDETAILS_FETCH) console.log(`[STORE][MEDIA_METADATA] appid=${meta.app_id} language=${language} movies=${count}`);
      if (meta.resolved && count > 0) {
        console.log(`[STORE][MEDIA_METADATA] appid=${meta.app_id} language=${language} movies=${count}`);
        englishMediaCache.set(cacheKey(meta.app_id), meta);
        stepResult[meta.app_id] = meta;
      } else {
        needsFallback.push(meta.app_id);
      }
    }

    // Step B — Fallback to English for those without localized movies
    if (needsFallback.length > 0) {
      if (ENABLE_VERBOSE_APPDETAILS_FETCH) console.log(`[STORE][MEDIA_METADATA] appIds=[${needsFallback.join(",")}] fallback english`);
      const fallbackResult = await resolveSteamAppMetadata(needsFallback, "english", "US");
      for (const meta of fallbackResult) {
        const count = meta.movies?.length ?? 0;
        if (ENABLE_VERBOSE_APPDETAILS_FETCH) console.log(`[STORE][MEDIA_METADATA] appid=${meta.app_id} language=english movies=${count}`);
        englishMediaCache.set(cacheKey(meta.app_id), meta);
        stepResult[meta.app_id] = meta;
      }
    }

    // Step C — Fill any appIds that neither fetch could resolve
    for (const appId of toFetch) {
      if (!stepResult[appId]) {
        const placeholder = createFallbackMetadata(appId);
        englishMediaCache.set(cacheKey(appId), placeholder);
        stepResult[appId] = placeholder;
      }
    }

    return stepResult;
  })();

  mediaInFlight.set(mediaKey, mediaPromise);
  const stepResult = await mediaPromise;
  mediaInFlight.delete(mediaKey);

  for (const [id, meta] of Object.entries(stepResult)) {
    result[Number(id)] = meta;
  }
  return result;
}

/* ── Trailer priority resolver ── */

type DirectVideoSource = "localVideoPath" | "mp4_max" | "mp4_480" | "webm_max" | "webm_480";
type StreamFallbackSource = "hls_h264" | "hls" | "dash_h264" | "dash_av1" | "dash";

const DIRECT_VIDEO_PRIORITY: DirectVideoSource[] = [
  "localVideoPath", "mp4_max", "mp4_480", "webm_max", "webm_480",
];
const STREAM_FALLBACK_PRIORITY: StreamFallbackSource[] = [
  "hls_h264", "hls", "dash_h264", "dash_av1", "dash",
];

function pickFirst<T extends string>(src: Record<string, string | null | undefined>, fields: readonly T[]): { key: T; value: string } | undefined {
  for (const key of fields) {
    const v = src[key];
    if (v) return { key, value: v };
  }
  return undefined;
}

export type TrailerResolutionInput = {
  id: string | number;
  name: string;
  localVideoPath?: string | null;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  mp4_480?: string | null;
  mp4_max?: string | null;
  webm_480?: string | null;
  webm_max?: string | null;
  hls?: string | null;
  hls_h264?: string | null;
  dash?: string | null;
  dash_h264?: string | null;
  dash_av1?: string | null;
  highlight?: boolean;
};

export function resolveTrailerByPriority(input: TrailerResolutionInput, preferDirectVideo?: boolean): ResolvedGameTrailer {
  const src: Record<string, string | null | undefined> = {
    localVideoPath: input.localVideoPath,
    mp4_max: input.mp4_max,
    mp4_480: input.mp4_480,
    webm_max: input.webm_max,
    webm_480: input.webm_480,
  };

  const direct = pickFirst(src, DIRECT_VIDEO_PRIORITY);
  const hasDirectVideo = !!direct;
  let stream: { key: string; value: string } | undefined;
  let hasStreamFallback = false;

  if (!direct || preferDirectVideo === false) {
    const streamSrc: Record<string, string | null | undefined> = {
      hls_h264: input.hls_h264,
      hls: input.hls,
      dash_h264: input.dash_h264,
      dash_av1: input.dash_av1,
      dash: input.dash,
    };
    stream = pickFirst(streamSrc, STREAM_FALLBACK_PRIORITY);
    hasStreamFallback = !!stream;
  }

  const effectiveDirect = direct ?? (preferDirectVideo === false ? stream : undefined);
  const playableUrl = effectiveDirect?.value ?? stream?.value ?? null;

  return {
    id: input.id,
    name: input.name,
    source: input.localVideoPath ? "local" : "steam-appdetails",
    thumbnailUrl: input.thumbnailUrl ?? null,
    thumbnailPath: input.thumbnailPath ?? null,
    localVideoPath: input.localVideoPath ?? null,
    mp4Url: input.mp4_max ?? input.mp4_480 ?? null,
    mp4_480: input.mp4_480 ?? null,
    mp4_max: input.mp4_max ?? null,
    webmUrl: input.webm_max ?? input.webm_480 ?? null,
    webm_480: input.webm_480 ?? null,
    webm_max: input.webm_max ?? null,
    hlsUrl: input.hls_h264 ?? input.hls ?? null,
    hls_h264: input.hls_h264 ?? null,
    dashUrl: input.dash ?? input.dash_h264 ?? input.dash_av1 ?? null,
    dash_h264: input.dash_h264 ?? null,
    dash_av1: input.dash_av1 ?? null,
    playableUrl,
    hasDirectVideo,
    hasStreamFallback,
    highlight: input.highlight ?? false,
    cachedAt: Date.now(),
  };
}

export function resolveGameTrailers(movies: SteamMovie[] | undefined | null, preferDirectVideo?: boolean): ResolvedGameTrailer[] {
  if (!movies || movies.length === 0) return [];
  return movies.map((m, i) =>
    resolveTrailerByPriority({
      id: m.id ?? i,
      name: m.name ?? `Trailer ${i + 1}`,
      thumbnailUrl: m.thumbnail,
      mp4_480: m.mp4_480,
      mp4_max: m.mp4_max,
      webm_480: m.webm_480,
      webm_max: m.webm_max,
      hls: m.hls,
      hls_h264: m.hls_h264,
      dash: m.dash,
      dash_h264: m.dash_h264,
      dash_av1: m.dash_av1,
      highlight: m.highlight,
    }, preferDirectVideo),
  );
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

/**
 * Build a metadata entry that the details page treats as resolved even when the
 * Steam Store API had no data for the app. `resolved: true` lets the page render
 * (with the repack card and title fallback) instead of hanging in the skeleton
 * for the full 30s timeout. Only used by the Store overlay detail effect.
 */
export function createResolvedFallbackMetadata(appId: number, name?: string): SteamAppMetadata {
  return {
    ...createFallbackMetadata(appId),
    name: name || `Steam App ${appId}`,
    resolved: true,
  };
}
