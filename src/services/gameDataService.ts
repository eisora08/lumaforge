import {
  loadGameAppInfoWithMediaFallback,
  localPathToUrl,
  clearResolvedMediaSessionCache,
} from "./gameCacheService";
import type { GameMediaPaths } from "./gameCacheService";
import {
  getLibraryAppInfo,
  clearAppInfoMemoryCache,
} from "./libraryLocalCacheService";
import {
  getStoreAppInfo,
  getStoreGameDetails,
  getStoreReviewSummary,
  clearStoreAppInfoMemoryCache,
} from "./storeLocalCacheService";
import {
  resolveGameMetadata,
  clearGameMetadataCache,
} from "./gameMetadataResolver";
import {
  resolveGameMediaImageSrc,
} from "./localImageSrc";
import { resolveGameMediaPaths, getMediaCacheSqlite, getMetadataCacheSqlite, checkSqliteHealth } from "./tauri";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type {
  StoreAppInfoEntry,
  StoreGameDetailsEntry,
} from "./tauri";

// ---------------------------------------------------------------------------
// SQLite availability — lazily checked
// ---------------------------------------------------------------------------
let _sqliteChecked = false;
let _sqliteAvailable = false;
const ENABLE_VERBOSE_GAME_DATA_LOGS = false;

async function ensureSqliteAvailable(): Promise<boolean> {
  if (!_sqliteChecked) {
    _sqliteChecked = true;
    _sqliteAvailable = await checkSqliteHealth();
    if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
      console.log(`[GameDataService] SQLite available: ${_sqliteAvailable}`);
    }
  }
  return _sqliteAvailable;
}

// ---------------------------------------------------------------------------
// Normalized types (internal use only — do not replace existing types)
// ---------------------------------------------------------------------------

export type NormalizedGameMediaPaths = {
  cover: string | null;
  background: string | null;
  landscape: string | null;
  logo: string | null;
  icon: string | null;
};

export type NormalizedGameMetadata = {
  id: string;
  title: string | null;
  provider: string;
  installed: boolean | null;
  lastPlayed: number | null;
  name: string | null;
  media: NormalizedGameMediaPaths;
  rawMetadata: SteamAppMetadata | null;
};

export type StoreDataResult = {
  appInfo: StoreAppInfoEntry | null;
  details: StoreGameDetailsEntry | null;
  reviews: StoreGameDetailsEntry | null;
  metadata: SteamAppMetadata | null;
};

export type MediaPathsResult = NormalizedGameMediaPaths & {
  rawPaths: GameMediaPaths | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function convertMediaPath(path: string | null | undefined): string | null {
  if (!path) return null;
  return localPathToUrl(path);
}

function normalizeMediaFromGameMediaPaths(media: GameMediaPaths | null | undefined): NormalizedGameMediaPaths {
  if (!media) {
    return { cover: null, background: null, landscape: null, logo: null, icon: null };
  }
  return {
    cover: convertMediaPath(media.coverPath),
    background: convertMediaPath(media.backgroundPath),
    landscape: convertMediaPath(media.landscapePath),
    logo: convertMediaPath(media.logoPath),
    icon: convertMediaPath(media.iconPath),
  };
}

function rawMediaFromGameMediaPaths(media: GameMediaPaths | null | undefined): NormalizedGameMediaPaths {
  if (!media) {
    return { cover: null, background: null, landscape: null, logo: null, icon: null };
  }
  return {
    cover: media.coverPath,
    background: media.backgroundPath,
    landscape: media.landscapePath,
    logo: media.logoPath,
    icon: media.iconPath,
  };
}

// ---------------------------------------------------------------------------
// SQLite helpers (fast path, silent fallback)
// ---------------------------------------------------------------------------

async function trySqliteMetadata(appId: string): Promise<NormalizedGameMetadata | null> {
  if (!(await ensureSqliteAvailable())) return null;

  try {
    const entry = await getMetadataCacheSqlite(appId);
    if (!entry) return null;

    if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
      console.log(`[GameDataService] metadata resolved from SQLite for ${appId}`);
    }

    return {
      id: entry.gameId,
      title: entry.title,
      provider: entry.provider,
      installed: entry.installed,
      lastPlayed: entry.lastPlayed > 0 ? entry.lastPlayed : null,
      name: entry.title,
      media: { cover: null, background: null, landscape: null, logo: null, icon: null },
      rawMetadata: null,
    };
  } catch {
    _sqliteAvailable = false;
    return null;
  }
}

async function trySqliteMediaPaths(appId: string): Promise<MediaPathsResult | null> {
  if (!(await ensureSqliteAvailable())) return null;

  try {
    const entry = await getMediaCacheSqlite(appId);
    if (!entry) return null;

    if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
      console.log(`[GameDataService] media resolved from SQLite for ${appId}`);
    }

    const base = entry.basePath;
    const cover = entry.hasCover && base ? convertMediaPath(`${base}/cover.jpg`) : null;
    const background = entry.hasBackground && base ? convertMediaPath(`${base}/background.jpg`) : null;
    const landscape = entry.hasLandscape && base ? convertMediaPath(`${base}/landscape.jpg`) : null;
    const logo = entry.hasLogo && base ? convertMediaPath(`${base}/logo.png`) : null;
    const icon = null; // icon not in SQLite cache yet

    const rawPaths: GameMediaPaths = {
      coverPath: entry.hasCover && base ? `${base}/cover.jpg` : null,
      backgroundPath: entry.hasBackground && base ? `${base}/background.jpg` : null,
      landscapePath: entry.hasLandscape && base ? `${base}/landscape.jpg` : null,
      logoPath: entry.hasLogo && base ? `${base}/logo.png` : null,
      iconPath: null,
    };

    return { cover, background, landscape, logo, icon, rawPaths };
  } catch {
    _sqliteAvailable = false;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public methods
// ---------------------------------------------------------------------------

/**
 * Get game metadata from the central data layer.
 *
 * Resolution order:
 * 1. SQLite cache (fast path, if available)
 * 2. Canonical appinfo (games/steam/{appId}/appinfo.json)
 * 3. Store metadata (store/details/{appId}.json)
 * 4. Library cache (legacy)
 *
 * Returns normalized metadata that is safe for UI consumption.
 * Does NOT introduce new API calls or disk scans beyond what
 * existing services already perform.
 */
export async function getMetadata(appId: string): Promise<NormalizedGameMetadata | null> {
  // 1. Try SQLite (fast path, silent fallback)
  const sqliteResult = await trySqliteMetadata(appId);
  if (sqliteResult) return sqliteResult;

  // 2. Try canonical appinfo (lightweight, fast)
  try {
    const appInfo = await loadGameAppInfoWithMediaFallback(appId);
    if (appInfo) {
      const media = rawMediaFromGameMediaPaths(appInfo.media);

      if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
        console.log(`[GameDataService] metadata resolved from canonical appinfo for ${appId}`);
      }

      return {
        id: appId,
        title: appInfo.name,
        provider: appInfo.provider,
        installed: null,
        lastPlayed: null,
        name: appInfo.name,
        media,
        rawMetadata: null,
      };
    }
  } catch {
    // Fall through
  }

  // 3. Try store metadata (richer metadata)
  try {
    const [metadataResult] = Object.values(await resolveGameMetadata([Number(appId)]));
    if (metadataResult) {
      const media: NormalizedGameMediaPaths = {
        cover: metadataResult.capsule_image_v5 || metadataResult.capsule_image || metadataResult.header_image || null,
        background: metadataResult.background_image || metadataResult.library_hero_image || metadataResult.hero_image || null,
        landscape: metadataResult.header_image || metadataResult.capsule_image_v5 || metadataResult.capsule_image || null,
        logo: metadataResult.logo_image || metadataResult.library_logo_image || null,
        icon: null,
      };

      if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
        console.log(`[GameDataService] metadata resolved from store for ${appId}`);
      }

      return {
        id: appId,
        title: metadataResult.name || null,
        provider: "steam",
        installed: null,
        lastPlayed: null,
        name: metadataResult.name || null,
        media,
        rawMetadata: metadataResult,
      };
    }
  } catch {
    // Fall through
  }

  // 4. Try library cache (legacy)
  try {
    const libEntry = await getLibraryAppInfo(appId);
    if (libEntry) {
      const media: NormalizedGameMediaPaths = {
        cover: libEntry.cover_path || null,
        background: libEntry.hero_path || null,
        landscape: libEntry.grid_path || libEntry.header_image || null,
        logo: libEntry.logo_path || null,
        icon: libEntry.icon_path || null,
      };

      if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
        console.log(`[GameDataService] metadata resolved from library cache for ${appId}`);
      }

      return {
        id: appId,
        title: libEntry.name,
        provider: "steam",
        installed: null,
        lastPlayed: null,
        name: libEntry.name,
        media,
        rawMetadata: null,
      };
    }
  } catch {
    // Fall through
  }

  if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
    console.log(`[GameDataService] no metadata found for ${appId}`);
  }

  return null;
}

/**
 * Get game media paths (cover, background, landscape, logo, icon).
 *
 * Resolution order:
 * 1. SQLite cache (fast path, if available)
 * 2. Canonical appinfo media paths
 * 3. Direct disk scan (last resort)
 *
 * Returns both raw file paths and asset:// converted URLs.
 * Uses existing helpers for path conversion — no duplicate logic.
 */
export async function getMediaPaths(appId: string): Promise<MediaPathsResult | null> {
  // 1. Try SQLite (fast path, silent fallback)
  const sqliteResult = await trySqliteMediaPaths(appId);
  if (sqliteResult) return sqliteResult;

  // 2. Try canonical appinfo (fast, session-cached)
  try {
    const appInfo = await loadGameAppInfoWithMediaFallback(appId);
    if (appInfo?.media) {
      const hasMedia = !!(appInfo.media.landscapePath || appInfo.media.coverPath || appInfo.media.backgroundPath || appInfo.media.logoPath || appInfo.media.iconPath);
      if (hasMedia) {
        if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
          console.log(`[GameDataService] media resolved from canonical appinfo for ${appId}`);
        }
        return {
          ...normalizeMediaFromGameMediaPaths(appInfo.media),
          rawPaths: appInfo.media,
        };
      }
    }
  } catch {
    // Fall through
  }

  // 3. Direct disk scan (last resort)
  try {
    const src = await resolveGameMediaImageSrc(appId);
    if (src) {
      // We found at least one image — also check for all paths
      const diskPaths = await resolveGameMediaPaths(appId).catch(() => null);
      if (diskPaths) {
        if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
          console.log(`[GameDataService] media resolved from disk scan for ${appId}`);
        }
        return {
          ...normalizeMediaFromGameMediaPaths(diskPaths),
          rawPaths: diskPaths,
        };
      }
      // Partial: only the best image found
      const empty: NormalizedGameMediaPaths = { cover: null, background: null, landscape: null, logo: null, icon: null };
      return { ...empty, cover: src, rawPaths: null };
    }
  } catch {
    // Fall through
  }

  if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
    console.log(`[GameDataService] no media found for ${appId}`);
  }

  return null;
}

/**
 * Get store data for an appId (details, reviews, metadata).
 *
 * Resolution order:
 * 1. Existing store cache files
 *
 * Returns all available store data in one call.
 */
export async function getStoreData(appId: string): Promise<StoreDataResult | null> {
  const numericAppId = Number(appId);
  if (isNaN(numericAppId)) return null;

  const result: StoreDataResult = {
    appInfo: null,
    details: null,
    reviews: null,
    metadata: null,
  };

  try {
    result.appInfo = await getStoreAppInfo(appId);
  } catch {
    // non-critical
  }

  try {
    result.details = await getStoreGameDetails(numericAppId);
  } catch {
    // non-critical
  }

  try {
    result.reviews = await getStoreReviewSummary(numericAppId) as unknown as StoreGameDetailsEntry | null;
  } catch {
    // non-critical
  }

  try {
    const [meta] = Object.values(await resolveGameMetadata([numericAppId]));
    result.metadata = meta || null;
  } catch {
    // non-critical
  }

  const hasData = !!(result.appInfo || result.details || result.reviews || result.metadata);
  return hasData ? result : null;
}

/**
 * Check whether SQLite is available.
 * Returns true only if the database exists and connection is successful.
 * Check is performed lazily on first access and cached for the session.
 */
export async function isSqliteAvailable(): Promise<boolean> {
  return ensureSqliteAvailable();
}

/**
 * Clear any in-memory caches used by this service.
 * Delegates to existing cache-clearing methods.
 */
export function clearGameDataCaches(): void {
  clearResolvedMediaSessionCache();
  clearAppInfoMemoryCache();
  clearStoreAppInfoMemoryCache();
  clearGameMetadataCache();
}
