import { resolveSteamAppMetadata, getStoreDetails } from "./tauri";
import { persistStoreDetails } from "./gameCacheService";
import type { SteamAppMetadata, SteamMovie } from "../types/gameMetadata";
import type { ResolvedGameTrailer } from "../types/gameMedia";

const ENABLE_VERBOSE_APPDETAILS_FETCH = false;
/** Gate per-appId disk-cache movie logging — off by default to avoid log spam from 200+ calls. */
const DEBUG_CACHE_MOVIES_LOG = false;
const inMemoryCache = new Map<number, SteamAppMetadata>();
/** Per-appId in-flight dedup — prevents overlapping boot batches from fetching the same appId twice. */
const metadataInFlightByAppId = new Map<number, Promise<SteamAppMetadata>>();
/** Per-batch-key in-flight dedup for resolveGameMetadataForMedia (batch-level is acceptable here since media resolution is inherently per-batch). */
const mediaInFlight = new Map<string, Promise<Record<number, SteamAppMetadata>>>();

export function loadMetadataCache(): Record<string, SteamAppMetadata> {
  const result: Record<string, SteamAppMetadata> = {};
  for (const [appId, meta] of inMemoryCache) {
    result[String(appId)] = meta;
  }
  return result;
}

async function loadFromAppCache(appId: number): Promise<SteamAppMetadata | null> {
  try {
    const cached = await getStoreDetails(String(appId));
    if (cached && cached.data) {
      const meta = cached.data as SteamAppMetadata;
      if (DEBUG_CACHE_MOVIES_LOG) {
        const moviesCount = meta.movies?.length ?? 0;
        const moviesNames = meta.movies?.map((m) => `"${m.name}"`).join(", ") ?? "";
        console.log(`[STORE][STORE_DETAILS_CACHE_MOVIES] appid=${appId} count=${moviesCount} names=${moviesNames}`);
      }
      // Phase 10: Trust `resolved === true` cache — the Rust parser always captures movies.
      // The old `moviesCount === 0` refetch forced unnecessary re-fetches for games with no movies,
      // causing hundreds of redundant Rust IPC calls on every boot.
      // Schema version checks for newly-added fields still trigger a refetch.
      if (meta.resolved === true && !("legal_notice" in meta)) {
        if (DEBUG_CACHE_MOVIES_LOG) console.log(`[STORE][METADATA_CACHE_STALE] appid=${appId} reason=missing-legal-notice-schema`);
        return null;
      }
      if (meta.resolved === true && !("store_drm_notice" in meta)) {
        if (DEBUG_CACHE_MOVIES_LOG) console.log(`[STORE][METADATA_CACHE_STALE] appid=${appId} reason=missing-store-drm-notice-schema`);
        return null;
      }
      if (meta.resolved === true && !("background_image" in meta)) {
        if (DEBUG_CACHE_MOVIES_LOG) console.log(`[STORE][METADATA_CACHE_STALE] appid=${appId} reason=missing-background-image-schema`);
        return null;
      }
      if (meta.resolved === true && !("header_image" in meta)) {
        if (DEBUG_CACHE_MOVIES_LOG) console.log(`[STORE][METADATA_CACHE_STALE] appid=${appId} reason=missing-header-image-schema`);
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
    await persistStoreDetails(String(appId), {
      app_id: String(appId),
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

  // Phase 9: Parallel disk reads instead of sequential for..await.
  // With 80 appIds, parallel completes in ~200ms vs ~4000ms sequential.
  const diskResults = await parallelDiskRead(missingAppIds);

  for (const { appId, meta } of diskResults) {
    if (meta) {
      inMemoryCache.set(appId, meta);
      result[appId] = meta;
    } else {
      toFetch.push(appId);
    }
  }

  if (toFetch.length === 0) {
    return result;
  }

  // Per-appId in-flight dedup: if any of the toFetch appIds are already being fetched,
  // reuse their promise instead of issuing a duplicate Rust call.
  const trulyNeedsFetch: number[] = [];
  const inFlightPromises: Promise<void>[] = [];

  for (const appId of toFetch) {
    const inflight = metadataInFlightByAppId.get(appId);
    if (inflight) {
      // Already fetching this appId — wait for it and merge
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

  // Create per-appId promises for the remaining appIds, then batch-fetch them
  const fetchPromise = resolveSteamAppMetadata(trulyNeedsFetch).then((resolved) => {
    const map: Record<number, SteamAppMetadata> = {};
    for (const meta of resolved) {
      map[meta.app_id] = meta;
    }
    return map;
  });

  // Register all per-appId promises sharing the same batch fetch
  for (const appId of trulyNeedsFetch) {
    metadataInFlightByAppId.set(
      appId,
      fetchPromise.then((map) => map[appId] ?? createFallbackMetadata(appId))
    );
  }

  const resolvedMap = await fetchPromise;

  for (const [appId, meta] of Object.entries(resolvedMap)) {
    const moviesCount = meta.movies?.length ?? 0;
    const moviesNames = meta.movies?.map((m) => `"${m.name}"`).join(", ") ?? "";
    if (ENABLE_VERBOSE_APPDETAILS_FETCH) {
      console.log(`[STORE][STEAM_APPDETAILS_FETCH] appid=${meta.app_id} resolved=${meta.resolved} movies=${moviesCount} names=${moviesNames}`);
    }
    if (meta.resolved) {
      inMemoryCache.set(meta.app_id, meta);
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

  // Intentionally do NOT delete from metadataInFlightByAppId here.
  // Keeping resolved entries ensures concurrent callers that miss inMemoryCache
  // (due to parallel disk reads) still find the in-flight promise and dedup.
  // The map is bounded by unique appIds loaded per session (few hundred at most).

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

  // Dedup in-flight media metadata requests for the same batch
  const mediaKey = `media:${toFetch.join(",")}`;
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
    // Step A — Try English media metadata
    if (ENABLE_VERBOSE_APPDETAILS_FETCH) console.log(`[STORE][MEDIA_METADATA] appIds=[${toFetch.join(",")}] trying language=english cc=us`);
    const englishResult = await resolveSteamAppMetadata(toFetch, "english", "US");

    const needsFallback: number[] = [];
    const stepResult: Record<number, SteamAppMetadata> = {};

    for (const meta of englishResult) {
      const count = meta.movies?.length ?? 0;
      if (ENABLE_VERBOSE_APPDETAILS_FETCH) console.log(`[STORE][MEDIA_METADATA] appid=${meta.app_id} language=english movies=${count}`);
      if (meta.resolved && count > 0) {
        console.log(`[STORE][MEDIA_METADATA] appid=${meta.app_id} language=english movies=${count}`);
        englishMediaCache.set(meta.app_id, meta);
        stepResult[meta.app_id] = meta;
      } else {
        needsFallback.push(meta.app_id);
      }
    }

    // Step B — Fallback to default language for those without English movies
    if (needsFallback.length > 0) {
      if (ENABLE_VERBOSE_APPDETAILS_FETCH) console.log(`[STORE][MEDIA_METADATA] appIds=[${needsFallback.join(",")}] fallback default language`);
      const fallbackResult = await resolveSteamAppMetadata(needsFallback);
      for (const meta of fallbackResult) {
        const count = meta.movies?.length ?? 0;
        if (ENABLE_VERBOSE_APPDETAILS_FETCH) console.log(`[STORE][MEDIA_METADATA] appid=${meta.app_id} language=default movies=${count}`);
        englishMediaCache.set(meta.app_id, meta);
        stepResult[meta.app_id] = meta;
      }
    }

    // Step C — Fill any appIds that neither fetch could resolve
    for (const appId of toFetch) {
      if (!stepResult[appId]) {
        const placeholder = createFallbackMetadata(appId);
        englishMediaCache.set(appId, placeholder);
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
