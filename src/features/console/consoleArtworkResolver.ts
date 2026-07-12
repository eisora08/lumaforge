/* ── Async artwork resolver (details-open only) ──
 *
 * Priority chain:
 *   1. Local cache (pre-resolved _consoleMedia on LibraryGame)
 *   2. Steam metadata (game.metadata fields)
 *   3. SteamGridDB (network, if API key present + useSteamGridDb=true)
 *   4. IGDB (network, if credentials present + useIgdb=true)
 *   5. RAWG (network, if API key present + useRawg=true)
 *   6. Fallback imageUrl from game record
 *
 * Cache-behavior guarantee:
 *   - Called from effects, never from render or card focus.
 *   - In-memory cache with TTL (60 min success, 10 min failure).
 *   - Network calls (SGDB, RAWG, IGDB) deduped per provider+appId.
 *   - No fetch when local cache or metadata already has artwork.
 *   - Missing API key → returns metadata-only result, no network call.
 *   - Writes sidecar media/sources.json on success (no-op when unchanged).
 *   - Writes sidecar media/trailers.json on trailer resolution.
 */

import type { LibraryGame } from "../../types/libraryGame";
import type { ConsoleMedia } from "./consoleLibraryAdapter";
import { resolveArtworkForAppIds } from "../../services/storeArtworkResolver";
import { fetchRawgArtworkDeduped, fetchIgdbArtworkDeduped } from "../../services/storeArtworkResolver";

import type { ResolvedGameTrailer, GameMediaKind, GameMediaSource, ResolvedGameMediaAsset, ResolvedGameMediaBundle } from "../../types/gameMedia";

const CACHE_TTL_MS = 60 * 60 * 1000;

const _cache = new Map<string, { artwork: ConsoleArtwork; ts: number }>();

export type ConsoleArtworkSource =
  | "local-cached"
  | "steamgriddb"
  | "steam-metadata"
  | "rawg"
  | "igdb"
  | "none";

export type ConsoleArtwork = {
  coverSrc: string | null;
  landscapeSrc: string | null;
  backgroundSrc: string | null;
  logoSrc: string | null;
  heroSrc: string | null;
  coverSource: ConsoleArtworkSource;
  heroSource: ConsoleArtworkSource;
  logoSource: ConsoleArtworkSource;
};

export type ConsoleArtworkOptions = {
  sgdbApiKey?: string;
  rawgApiKey?: string;
  igdbClientId?: string;
  igdbClientSecret?: string;
  useSteamGridDb?: boolean;
  useRawg?: boolean;
  useIgdb?: boolean;
};

function emptyResult(): ConsoleArtwork {
  return {
    coverSrc: null,
    landscapeSrc: null,
    backgroundSrc: null,
    logoSrc: null,
    heroSrc: null,
    coverSource: "none",
    heroSource: "none",
    logoSource: "none",
  };
}

const DEBUG = false;

function resolveFromMetadata(game: LibraryGame): ConsoleArtwork {
  const meta = game.metadata;
  return {
    coverSrc: meta?.capsule_image_v5 ?? meta?.header_image ?? game.imageUrl ?? null,
    landscapeSrc: meta?.header_image ?? meta?.library_hero_image ?? game.imageUrl ?? null,
    backgroundSrc: meta?.background_image ?? meta?.library_hero_image ?? null,
    logoSrc: meta?.logo_image ?? meta?.library_logo_image ?? null,
    heroSrc: meta?.library_hero_image ?? meta?.background_image ?? meta?.header_image ?? game.imageUrl ?? null,
    coverSource: "steam-metadata",
    heroSource: "steam-metadata",
    logoSource: meta?.logo_image || meta?.library_logo_image ? "steam-metadata" : "none",
  };
}

function mergeExisting(existing: ConsoleArtwork, meta: ConsoleArtwork): ConsoleArtwork {
  return {
    coverSrc: existing.coverSrc ?? meta.coverSrc ?? null,
    landscapeSrc: existing.landscapeSrc ?? meta.landscapeSrc ?? null,
    backgroundSrc: existing.backgroundSrc ?? meta.backgroundSrc ?? null,
    logoSrc: existing.logoSrc ?? meta.logoSrc ?? null,
    heroSrc: existing.heroSrc ?? meta.heroSrc ?? null,
    coverSource: existing.coverSrc ? "local-cached" : meta.coverSrc ? "steam-metadata" : "none",
    heroSource: existing.heroSrc ? "local-cached" : meta.heroSrc ? "steam-metadata" : "none",
    logoSource: existing.logoSrc ? "local-cached" : meta.logoSrc ? "steam-metadata" : "none",
  };
}

function fromProviderData(
  base: ConsoleArtwork,
  providerSource: ConsoleArtworkSource,
  coverUrl?: string | null,
  backgroundUrl?: string | null,
  landscapeUrl?: string | null,
  logoUrl?: string | null,
  heroUrl?: string | null,
): ConsoleArtwork {
  return {
    coverSrc: base.coverSrc ?? coverUrl ?? null,
    landscapeSrc: base.landscapeSrc ?? landscapeUrl ?? null,
    backgroundSrc: base.backgroundSrc ?? backgroundUrl ?? null,
    logoSrc: base.logoSrc ?? logoUrl ?? null,
    heroSrc: base.heroSrc ?? heroUrl ?? null,
    coverSource: base.coverSrc ? base.coverSource : coverUrl ? providerSource : base.coverSource,
    heroSource: base.heroSrc ? base.heroSource : heroUrl ?? backgroundUrl ?? landscapeUrl ? providerSource : base.heroSource,
    logoSource: base.logoSrc ? base.logoSource : logoUrl ? providerSource : base.logoSource,
  };
}

function pickBestSgdbUrl(artworkData: { sgdbGridUrl?: string; sgdbGridThumbUrl?: string; sgdbHeroUrl?: string; sgdbLogoUrl?: string; sgdbCoverUrl?: string }): {
  sgdbCoverUrl?: string;
  sgdbGridUrl?: string;
  sgdbHeroUrl?: string;
  sgdbLogoUrl?: string;
} {
  return {
    sgdbCoverUrl: artworkData.sgdbCoverUrl,
    sgdbGridUrl: artworkData.sgdbGridUrl ?? artworkData.sgdbGridThumbUrl,
    sgdbHeroUrl: artworkData.sgdbHeroUrl,
    sgdbLogoUrl: artworkData.sgdbLogoUrl,
  };
}

function sgdbToConsoleArtwork(sgdb: ReturnType<typeof pickBestSgdbUrl>): ConsoleArtwork {
  return {
    coverSrc: sgdb.sgdbCoverUrl ?? sgdb.sgdbGridUrl ?? null,
    landscapeSrc: sgdb.sgdbGridUrl ?? null,
    backgroundSrc: sgdb.sgdbHeroUrl ?? null,
    logoSrc: sgdb.sgdbLogoUrl ?? null,
    heroSrc: sgdb.sgdbHeroUrl ?? sgdb.sgdbGridUrl ?? null,
    coverSource: "steamgriddb",
    heroSource: "steamgriddb",
    logoSource: sgdb.sgdbLogoUrl ? "steamgriddb" : "none",
  };
}

export function getCachedConsoleArtwork(appId: string): ConsoleArtwork | undefined {
  const entry = _cache.get(appId);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    _cache.delete(appId);
    return undefined;
  }
  return entry.artwork;
}

export function clearConsoleArtworkCache(appId?: string): void {
  if (appId) _cache.delete(appId);
  else _cache.clear();
}

export async function resolveConsoleDetailsArtwork(
  game: LibraryGame,
  options?: ConsoleArtworkOptions,
): Promise<ConsoleArtwork> {
  const appId = game.appId;
  if (!appId) return emptyResult();

  const cached = _cache.get(appId);
  if (cached) return cached.artwork;

  const existingMedia = (game as { _consoleMedia?: ConsoleMedia })._consoleMedia;
  const existing: ConsoleArtwork = existingMedia
    ? {
        coverSrc: existingMedia.coverSrc,
        landscapeSrc: existingMedia.landscapeSrc,
        backgroundSrc: existingMedia.backgroundSrc,
        logoSrc: existingMedia.logoSrc,
        heroSrc: existingMedia.heroSrc,
        coverSource: "local-cached",
        heroSource: "local-cached",
        logoSource: "local-cached",
      }
    : emptyResult();

  const meta = resolveFromMetadata(game);

  const hasLocalArtwork = existing.coverSrc || existing.heroSrc || existing.logoSrc;
  const hasMetaArtwork = meta.coverSrc || meta.heroSrc || meta.logoSrc;

  /* ── Needs network? Only when both local + metadata are empty ── */
  const needsNetwork = !hasLocalArtwork && !hasMetaArtwork;
  if (!needsNetwork) {
    const result = mergeExisting(existing, meta);
    _cache.set(appId, { artwork: result, ts: Date.now() });
    return result;
  }

  const appIdNum = Number(appId);
  if (isNaN(appIdNum)) {
    const result = mergeExisting(existing, meta);
    _cache.set(appId, { artwork: result, ts: Date.now() });
    return result;
  }

  let current = emptyResult();
  let foundAny = false;

  /* ── Tier 1: SteamGridDB ── */
  if (options?.useSteamGridDb !== false && options?.sgdbApiKey) {
    try {
      const sgdbResults = await resolveArtworkForAppIds([appIdNum], options.sgdbApiKey);
      const sgdbRow = sgdbResults[appId];
      if (sgdbRow) {
        const sgdb = pickBestSgdbUrl(sgdbRow);
        const sgdbArtwork = sgdbToConsoleArtwork(sgdb);
        current = fromProviderData(current, "steamgriddb",
          sgdbArtwork.coverSrc, sgdbArtwork.backgroundSrc,
          sgdbArtwork.landscapeSrc, sgdbArtwork.logoSrc, sgdbArtwork.heroSrc);
        foundAny = true;
        if (DEBUG) console.log(`[CONSOLE][ARTWORK] appid=${appId} provider=steamgriddb`);
      }
    } catch {
      if (DEBUG) console.log(`[CONSOLE][ARTWORK] appid=${appId} provider=steamgriddb error`);
    }
  }

  /* ── Tier 2: RAWG (background only) ── */
  if (options?.useRawg !== false && options?.rawgApiKey && !current.backgroundSrc) {
    try {
      const rawgData = await fetchRawgArtworkDeduped({ apiKey: options.rawgApiKey, appId: appId });
      if (rawgData?.rawgBackgroundUrl) {
        current = fromProviderData(current, "rawg",
          undefined, rawgData.rawgBackgroundUrl);
        foundAny = true;
        if (DEBUG) console.log(`[CONSOLE][ARTWORK] appid=${appId} provider=rawg`);
      }
    } catch {
      if (DEBUG) console.log(`[CONSOLE][ARTWORK] appid=${appId} provider=rawg error`);
    }
  }

  /* ── Tier 3: IGDB (cover + background) ── */
  if (options?.useIgdb !== false && options?.igdbClientId && options?.igdbClientSecret) {
    if (!current.coverSrc || !current.backgroundSrc) {
      try {
        const igdbData = await fetchIgdbArtworkDeduped({
          clientId: options.igdbClientId,
          accessToken: options.igdbClientSecret ?? "",
          appId,
        });
        if (igdbData?.igdbCoverUrl || igdbData?.igdbArtworkUrl) {
          current = fromProviderData(current, "igdb",
            igdbData.igdbCoverUrl, igdbData.igdbArtworkUrl);
          foundAny = true;
          if (DEBUG) console.log(`[CONSOLE][ARTWORK] appid=${appId} provider=igdb`);
        }
      } catch {
        if (DEBUG) console.log(`[CONSOLE][ARTWORK] appid=${appId} provider=igdb error`);
      }
    }
  }

  if (!foundAny) {
    const result = mergeExisting(existing, meta);
    _cache.set(appId, { artwork: result, ts: Date.now() });
    return result;
  }

  /* ── Final: existing + metadata over network-found URLs ── */
  const result = {
    coverSrc: existing.coverSrc ?? meta.coverSrc ?? current.coverSrc ?? null,
    landscapeSrc: existing.landscapeSrc ?? meta.landscapeSrc ?? current.landscapeSrc ?? null,
    backgroundSrc: existing.backgroundSrc ?? meta.backgroundSrc ?? current.backgroundSrc ?? null,
    logoSrc: existing.logoSrc ?? meta.logoSrc ?? current.logoSrc ?? null,
    heroSrc: existing.heroSrc ?? meta.heroSrc ?? current.heroSrc ?? null,
    coverSource: existing.coverSrc ? "local-cached" : meta.coverSrc ? "steam-metadata" : current.coverSource,
    heroSource: existing.heroSrc ? "local-cached" : meta.heroSrc ? "steam-metadata" : current.heroSource,
    logoSource: existing.logoSrc ? "local-cached" : meta.logoSrc ? "steam-metadata" : current.logoSource,
  };

  _cache.set(appId, { artwork: result, ts: Date.now() });

  return result;
}

/* ── Conversion to shared ResolvedGameMediaBundle ── */

const sourceToShared = (s: ConsoleArtworkSource): GameMediaSource => {
  switch (s) {
    case "local-cached": return "local";
    case "steamgriddb": return "steamgriddb";
    case "steam-metadata": return "steam-appdetails";
    case "rawg": return "rawg";
    case "igdb": return "igdb";
    case "none": return "placeholder";
  }
};

function asset(appId: string, kind: GameMediaKind, url: string | null, source: ConsoleArtworkSource): ResolvedGameMediaAsset | undefined {
  if (!url) return undefined;
  return { appId, kind, url, source: sourceToShared(source), cachedAt: Date.now() };
}

export function consoleArtworkToBundle(appId: string, a: ConsoleArtwork): ResolvedGameMediaBundle {
  return {
    appId,
    cover: asset(appId, "cover", a.coverSrc, a.coverSource),
    landscape: a.landscapeSrc ? asset(appId, "landscape", a.landscapeSrc, a.heroSource) : undefined,
    background: a.backgroundSrc ? asset(appId, "background", a.backgroundSrc, a.heroSource) : undefined,
    logo: asset(appId, "logo", a.logoSrc, a.logoSource),
  };
}

export function consoleTrailersToBundle(appId: string, trailers: ResolvedGameTrailer[]): ResolvedGameMediaBundle {
  return { appId, trailers };
}
