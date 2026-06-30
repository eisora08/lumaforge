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
import { resolveGameMediaPaths, getMediaCacheSqlite, getMetadataCacheSqlite, checkSqliteHealth, insertMediaCacheSqlite, insertMetadataCacheSqlite } from "./tauri";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type {
  StoreAppInfoEntry,
  StoreGameDetailsEntry,
  SqliteMediaCacheEntry,
  SqliteMetadataCacheEntry,
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
// TTL constants
// ---------------------------------------------------------------------------
const METADATA_TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours
const MEDIA_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
// Priority-based loading system (Phase 4)
// ---------------------------------------------------------------------------

export enum LoadPriority {
  HERO = 3,
  VIEWPORT = 2,
  BACKGROUND = 1,
}

// ---------------------------------------------------------------------------
// Write guard & refresh tracker
// ---------------------------------------------------------------------------
const _writtenMediaIds = new Set<string>();
const _writtenMetadataIds = new Set<string>();
const _refreshingIds = new Set<string>();
const _requestedIds = new Set<string>();

// ---------------------------------------------------------------------------
// Background queue (staggered batch processing)
// ---------------------------------------------------------------------------
const _backgroundQueue: string[] = [];
const _backgroundProcessing = new Set<string>();
let _backgroundTimer: ReturnType<typeof setTimeout> | null = null;
const BACKGROUND_BATCH_SIZE = 5;
const BACKGROUND_BATCH_DELAY_MS = 100;

function processBackgroundQueue(): void {
  _backgroundTimer = null;
  const batch = _backgroundQueue.splice(0, BACKGROUND_BATCH_SIZE);

  for (const id of batch) {
    _backgroundProcessing.add(id);
  }

  void Promise.allSettled(
    batch.map(async (id) => {
      try {
        await getMetadata(id);
        await getMediaPaths(id).catch(() => {});
      } finally {
        _backgroundProcessing.delete(id);
      }
    })
  ).then(() => {
    if (_backgroundQueue.length > 0) {
      _backgroundTimer = setTimeout(processBackgroundQueue, BACKGROUND_BATCH_DELAY_MS);
    }
  });
}

/**
 * Request game data at a given priority level.
 *
 * HERO:     resolves immediately (await), highest priority
 * VIEWPORT: resolves immediately (fire-and-forget), medium priority
 * BACKGROUND: queued and processed in staggered batches
 *
 * Duplicate requests are silently ignored via _requestedIds.
 * Priority only affects WHEN resolution happens, not what is resolved.
 */
export async function requestGameData(gameId: string, priority: LoadPriority): Promise<void> {
  if (_requestedIds.has(gameId)) return;

  _requestedIds.add(gameId);

  if (priority === LoadPriority.HERO) {
    await getMetadata(gameId);
    void getMediaPaths(gameId).catch(() => {});
  } else if (priority === LoadPriority.VIEWPORT) {
    void getMetadata(gameId).catch(() => {});
    void getMediaPaths(gameId).catch(() => {});
  } else {
    _backgroundQueue.push(gameId);
    if (!_backgroundTimer) {
      _backgroundTimer = setTimeout(processBackgroundQueue, BACKGROUND_BATCH_DELAY_MS);
    }
  }
}

/** Reset priority state (e.g. on navigation or session clear) */
export function clearPriorityState(): void {
  _requestedIds.clear();
  _backgroundQueue.length = 0;
  _backgroundProcessing.clear();
  if (_backgroundTimer) {
    clearTimeout(_backgroundTimer);
    _backgroundTimer = null;
  }
}

// ---------------------------------------------------------------------------
// TTL helper
// ---------------------------------------------------------------------------
function isExpired(updatedAt: number, ttl: number): boolean {
  return (Date.now() - updatedAt) > ttl;
}

// ---------------------------------------------------------------------------
// SQLite write helpers (fire-and-forget, silent failure)
// ---------------------------------------------------------------------------

function extractMediaBasePath(media: GameMediaPaths | null): string {
  if (!media) return "";
  const sample = media.landscapePath || media.coverPath || media.backgroundPath || media.logoPath;
  if (!sample) return "";
  const lastSep = Math.max(sample.lastIndexOf("\\"), sample.lastIndexOf("/"));
  if (lastSep < 0) return "";
  return sample.substring(0, lastSep);
}

function writeMediaToSqlite(appId: string, media: GameMediaPaths | null, provider: string, force = false): void {
  if (!_sqliteAvailable) return;
  if (!force && _writtenMediaIds.has(appId)) return;
  if (!media?.coverPath && !media?.landscapePath && !media?.backgroundPath && !media?.logoPath) return;

  _writtenMediaIds.add(appId);

  const now = Date.now();
  const entry: SqliteMediaCacheEntry = {
    gameId: appId,
    provider: provider || "steam",
    basePath: extractMediaBasePath(media),
    hasCover: !!media?.coverPath,
    hasBackground: !!media?.backgroundPath,
    hasLogo: !!media?.logoPath,
    hasLandscape: !!media?.landscapePath,
    updatedAt: now,
  };

  void insertMediaCacheSqlite(entry);
}

function writeMetadataToSqlite(appId: string, metadata: NormalizedGameMetadata, force = false): void {
  if (!_sqliteAvailable) return;
  if (!force && _writtenMetadataIds.has(appId)) return;
  if (!metadata.title && !metadata.name) return;

  _writtenMetadataIds.add(appId);

  const now = Date.now();
  const entry: SqliteMetadataCacheEntry = {
    gameId: appId,
    title: metadata.title || metadata.name,
    provider: metadata.provider,
    installed: metadata.installed ?? false,
    lastPlayed: metadata.lastPlayed ?? 0,
    playtime: 0,
    updatedAt: now,
  };

  void insertMetadataCacheSqlite(entry);
}

// ---------------------------------------------------------------------------
// SQLite helpers (fast path, silent fallback)
// ---------------------------------------------------------------------------

async function trySqliteMetadata(appId: string): Promise<{ data: NormalizedGameMetadata; updatedAt: number } | null> {
  if (!(await ensureSqliteAvailable())) return null;

  try {
    const entry = await getMetadataCacheSqlite(appId);
    if (!entry) return null;

    if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
      console.log(`[GameDataService] metadata hit SQLite for ${appId}`);
    }

    return {
      data: {
        id: entry.gameId,
        title: entry.title,
        provider: entry.provider,
        installed: entry.installed,
        lastPlayed: entry.lastPlayed > 0 ? entry.lastPlayed : null,
        name: entry.title,
        media: { cover: null, background: null, landscape: null, logo: null, icon: null },
        rawMetadata: null,
      },
      updatedAt: entry.updatedAt ?? 0,
    };
  } catch {
    _sqliteAvailable = false;
    return null;
  }
}

async function trySqliteMediaPaths(appId: string): Promise<{ data: MediaPathsResult; updatedAt: number } | null> {
  if (!(await ensureSqliteAvailable())) return null;

  try {
    const entry = await getMediaCacheSqlite(appId);
    if (!entry) return null;

    if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
      console.log(`[GameDataService] media hit SQLite for ${appId}`);
    }

    const base = entry.basePath;
    const cover = entry.hasCover && base ? convertMediaPath(`${base}/cover.jpg`) : null;
    const background = entry.hasBackground && base ? convertMediaPath(`${base}/background.jpg`) : null;
    const landscape = entry.hasLandscape && base ? convertMediaPath(`${base}/landscape.jpg`) : null;
    const logo = entry.hasLogo && base ? convertMediaPath(`${base}/logo.png`) : null;
    const icon = null;

    const rawPaths: GameMediaPaths = {
      coverPath: entry.hasCover && base ? `${base}/cover.jpg` : null,
      backgroundPath: entry.hasBackground && base ? `${base}/background.jpg` : null,
      landscapePath: entry.hasLandscape && base ? `${base}/landscape.jpg` : null,
      logoPath: entry.hasLogo && base ? `${base}/logo.png` : null,
      iconPath: null,
    };

    return {
      data: { cover, background, landscape, logo, icon, rawPaths },
      updatedAt: entry.updatedAt ?? 0,
    };
  } catch {
    _sqliteAvailable = false;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fallback resolution (no SQLite — pure data resolution)
// ---------------------------------------------------------------------------

async function resolveMetadataFromFallbacks(appId: string): Promise<NormalizedGameMetadata | null> {
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

  return null;
}

async function resolveMediaFromFallbacks(appId: string): Promise<MediaPathsResult | null> {
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

  try {
    const src = await resolveGameMediaImageSrc(appId);
    if (src) {
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
      const empty: NormalizedGameMediaPaths = { cover: null, background: null, landscape: null, logo: null, icon: null };
      return { ...empty, cover: src, rawPaths: null };
    }
  } catch {
    // Fall through
  }

  return null;
}

// ---------------------------------------------------------------------------
// Background refresh (fire-and-forget, silent, non-blocking)
// ---------------------------------------------------------------------------

async function refreshMetadata(appId: string): Promise<void> {
  const key = `meta:${appId}`;
  if (_refreshingIds.has(key)) return;
  _refreshingIds.add(key);
  try {
    const result = await resolveMetadataFromFallbacks(appId);
    if (result) {
      writeMetadataToSqlite(appId, result, true);
      if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
        console.log(`[GameDataService] metadata expired → refresh completed for ${appId}`);
      }
    }
  } catch {
    // silent
  } finally {
    _refreshingIds.delete(key);
  }
}

async function refreshMedia(appId: string): Promise<void> {
  const key = `media:${appId}`;
  if (_refreshingIds.has(key)) return;
  _refreshingIds.add(key);
  try {
    const result = await resolveMediaFromFallbacks(appId);
    if (result?.rawPaths) {
      writeMediaToSqlite(appId, result.rawPaths, "steam", true);
      if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
        console.log(`[GameDataService] media expired → refresh completed for ${appId}`);
      }
    }
  } catch {
    // silent
  } finally {
    _refreshingIds.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Public methods
// ---------------------------------------------------------------------------

/**
 * Get game metadata from the central data layer.
 *
 * Resolution order:
 * 1. SQLite cache (fast path, TTL-aware)
 * 2. Canonical appinfo (games/steam/{appId}/appinfo.json)
 * 3. Store metadata (store/details/{appId}.json)
 * 4. Library cache (legacy)
 *
 * If SQLite data is expired, returns cached data immediately
 * and triggers a silent background refresh. Never blocks UI.
 */
export async function getMetadata(appId: string): Promise<NormalizedGameMetadata | null> {
  const sqliteResult = await trySqliteMetadata(appId);
  if (sqliteResult) {
    if (!isExpired(sqliteResult.updatedAt, METADATA_TTL_MS)) {
      return sqliteResult.data;
    }
    if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
      console.log(`[GameDataService] metadata expired → refreshing ${appId}`);
    }
    void refreshMetadata(appId);
    return sqliteResult.data;
  }

  const fallbackResult = await resolveMetadataFromFallbacks(appId);
  if (fallbackResult) {
    writeMetadataToSqlite(appId, fallbackResult);
    return fallbackResult;
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
 * 1. SQLite cache (fast path, TTL-aware)
 * 2. Canonical appinfo media paths
 * 3. Direct disk scan (last resort)
 *
 * If SQLite data is expired, returns cached data immediately
 * and triggers a silent background refresh. Never blocks UI.
 */
export async function getMediaPaths(appId: string): Promise<MediaPathsResult | null> {
  const sqliteResult = await trySqliteMediaPaths(appId);
  if (sqliteResult) {
    if (!isExpired(sqliteResult.updatedAt, MEDIA_TTL_MS)) {
      return sqliteResult.data;
    }
    if (ENABLE_VERBOSE_GAME_DATA_LOGS) {
      console.log(`[GameDataService] media expired → refreshing ${appId}`);
    }
    void refreshMedia(appId);
    return sqliteResult.data;
  }

  const fallbackResult = await resolveMediaFromFallbacks(appId);
  if (fallbackResult) {
    if (fallbackResult.rawPaths) {
      writeMediaToSqlite(appId, fallbackResult.rawPaths, "steam");
    }
    return fallbackResult;
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
  _writtenMediaIds.clear();
  _writtenMetadataIds.clear();
  _requestedIds.clear();
}
