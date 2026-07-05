import { invoke } from "@tauri-apps/api/core";
import type { LibraryGame } from "../types/libraryGame";
import type { SteamUserGameStats } from "../types/steamUserStats";
import { getGameAppInfo, resolveGameMediaPaths, resolveGameMediaPathsBatch, readCanonicalAppinfos, validateSnapshotMediaPaths as validatePathsRust, validateSnapshotMediaPathsBatch } from "./tauri";
import type { GameMediaPaths, GameAppInfo, SnapshotGameMediaForValidation, ValidatedMediaPaths } from "./tauri";
import { dedupeLibraryGames, isSidebarInstalledGame } from "./gameCacheService";
import { isRecentlyNavigated, isInteractionBusy } from "./perfCounters";
import { getPlaytimeSecondsForAppId } from "./playtimeService";

const SNAPSHOT_VERSION = 1;
let cachedSnapshot: StartupSnapshot | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Boot-time appinfo cache — populated by hydrateStartupSnapshotMedia (Stage 3),
// consumed by Stage 4.5 title enrichment to avoid re-reading appinfo.json from disk.
let _bootAppInfoCache: Record<string, GameAppInfo> | null = null;

export function getCachedBootAppInfos(): Record<string, GameAppInfo> | null {
  return _bootAppInfoCache;
}

export function clearCachedBootAppInfos(): void {
  if (_bootAppInfoCache) {
    _bootAppInfoCache = null;
  }
}

// Debug log flag — set to true during testing, false by default
const ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS = false;

// ── Write coalescing state (Part 2) ──
let _mediaUpdateTimer: ReturnType<typeof setTimeout> | null = null;
let _dirtyAppIds = new Set<string>();
let _writeInProgress = false;
let _pendingAfterWrite = false;
let _coalescedScheduleCount = 0;

// S3: Max defer duration — after this many ms of continuous interaction deferral,
// snapshot writes proceed even if isInteractionBusy() is still true.
const MAX_DEFER_DURATION_MS = 30_000;
let _mediaUpdateDeferStart: number | null = null;  // first defer timestamp for media-update path
let _fullRebuildDeferStart: number | null = null;  // first defer timestamp for full-rebuild path

// Specific appIds for targeted debug logging regardless of ENABLE_VERBOSE flag
const DEBUG_APP_IDS = new Set(["678950", "851850", "601150", "3017860"]);

function debugAppLog(appId: string, message: string): void {
  if (DEBUG_APP_IDS.has(appId)) {
    console.log(`[BootSnapshot:${appId}] ${message}`);
  }
}

// Track pending appinfo update invocations for flush coordination
let pendingAppInfoUpdateCount = 0;
let pendingAppInfoUpdateResolve: (() => void) | null = null;

// In-memory cache for canonical appinfo media reads within a session.
// Prevents repeated disk reads of appinfo.json across snapshot builds.
const canonicalMediaCache = new Map<string, GameMediaPaths | null>();

// ---------------------------------------------------------------------------
// normalizeAppInfoMedia — normalize any appinfo media field style into a
// consistent SnapshotGameMedia object. Supports:
//   - Top-level: appId / app_id, name, updatedAt / updated_at
//   - media.coverPath / media.cover_path
//   - Legacy direct fields: coverPath, backgroundPath, logoPath, iconPath,
//     landscapePath, gridPath, heroPath
// ---------------------------------------------------------------------------

function normalizeAppInfoMedia(appInfo: any): SnapshotGameMedia | null {
  if (!appInfo) return null;

  // Try media sub-object first
  const media = appInfo.media || {};
  const result: SnapshotGameMedia = {
    coverPath: media.coverPath ?? media.cover_path ?? null,
    backgroundPath: media.backgroundPath ?? media.background_path ?? null,
    logoPath: media.logoPath ?? media.logo_path ?? null,
    iconPath: media.iconPath ?? media.icon_path ?? null,
    landscapePath: media.landscapePath ?? media.landscape_path ?? null,
  };

  // Legacy direct fields at top level (fallback if media sub-object missing)
  if (!result.coverPath) {
    result.coverPath = appInfo.coverPath ?? appInfo.cover_path ?? null;
  }
  if (!result.backgroundPath) {
    result.backgroundPath = appInfo.backgroundPath ?? appInfo.background_path ?? null;
  }
  if (!result.logoPath) {
    result.logoPath = appInfo.logoPath ?? appInfo.logo_path ?? null;
  }
  if (!result.iconPath) {
    result.iconPath = appInfo.iconPath ?? appInfo.icon_path ?? null;
  }
  if (!result.landscapePath) {
    result.landscapePath = appInfo.landscapePath ?? appInfo.landscape_path ?? null;
  }

  // Legacy gridPath → landscapePath (only if landscapePath still missing)
  if (!result.landscapePath) {
    result.landscapePath = appInfo.gridPath ?? appInfo.grid_path ?? null;
  }

  // Legacy heroPath → backgroundPath (only if backgroundPath still missing)
  if (!result.backgroundPath) {
    result.backgroundPath = appInfo.heroPath ?? appInfo.hero_path ?? null;
  }

  const hasAny = !!(result.landscapePath || result.coverPath || result.backgroundPath || result.logoPath || result.iconPath);
  return hasAny ? result : null;
}

// ---------------------------------------------------------------------------
// computeMediaStatus — given original (pre-validation) media paths and the
// validated result, determine the media readiness status and which roles are
// missing.
//
// Rules:
// - "ready": all required UI roles (cover, landscape, background) have valid paths
// - "partial": at least one required role has a valid path
// - "missing": no required roles have any path
// - "stale": snapshot/appinfo had local paths but they no longer exist on disk
// - "pending": a background job is queued (set externally)
// ---------------------------------------------------------------------------

function computeMediaStatus(
  originalMedia: SnapshotGameMedia,
  validated: ValidatedMediaPaths,
): SnapshotMediaStatus {
  const missingMedia: string[] = [];

  const checks: Array<{
    role: string;
    origPath: string | null;
    validPath: string | null;
    exists: boolean;
    isRequired: boolean;
  }> = [
    { role: "cover", origPath: originalMedia.coverPath, validPath: validated.coverPath, exists: validated.coverExists, isRequired: true },
    { role: "landscape", origPath: originalMedia.landscapePath, validPath: validated.landscapePath, exists: validated.landscapeExists, isRequired: true },
    { role: "background", origPath: originalMedia.backgroundPath, validPath: validated.backgroundPath, exists: validated.backgroundExists, isRequired: true },
    { role: "logo", origPath: originalMedia.logoPath, validPath: validated.logoPath, exists: validated.logoExists, isRequired: false },
    { role: "icon", origPath: originalMedia.iconPath, validPath: validated.iconPath, exists: validated.iconExists, isRequired: false },
  ];

  let readyCount = 0;
  let requiredReady = 0;
  let staleCount = 0;

  for (const check of checks) {
    if (check.validPath && check.exists) {
      readyCount++;
      if (check.isRequired) requiredReady++;
    } else if (check.origPath && !check.exists) {
      staleCount++;
      if (check.isRequired) missingMedia.push(check.role);
    } else {
      if (check.isRequired) missingMedia.push(check.role);
    }
  }

  let mediaStatus: MediaStatus;
  if (staleCount > 0) {
    mediaStatus = "stale";
  } else if (requiredReady >= 3) {
    mediaStatus = "ready";
  } else if (requiredReady > 0) {
    mediaStatus = "partial";
  } else {
    mediaStatus = "missing";
  }

  return { mediaStatus, missingMedia };
}

type SnapshotMediaStatus = {
  mediaStatus: MediaStatus;
  missingMedia: string[];
};

// ---------------------------------------------------------------------------
// setMediaStatusOnGame — validate a game's media paths against disk and set
// mediaStatus, missingMedia, and lastMediaCheckAt on the game object.
// Pass originalMedia (pre-repair) for accurate stale detection.
// ---------------------------------------------------------------------------

async function setMediaStatusOnGame(
  game: SnapshotGame,
  originalMedia?: SnapshotGameMedia,
  preValidated?: ValidatedMediaPaths,
): Promise<void> {
  const appId = game.appId || "";
  const validated = preValidated ?? await validateSnapshotMediaPaths(appId, game.media);
  const { mediaStatus, missingMedia } = computeMediaStatus(
    originalMedia || game.media,
    validated,
  );
  game.mediaStatus = mediaStatus;
  game.missingMedia = missingMedia;
  game.lastMediaCheckAt = Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// validateSnapshotMediaPaths — check that local file paths actually exist.
// Remote URLs are kept as-is. Local paths that don't exist are set to null.
// Requires appId so relative media paths (media/*, img/*) can be resolved
// against the correct provider game directory.
// ---------------------------------------------------------------------------

async function validateSnapshotMediaPaths(appId: string, media: SnapshotGameMedia): Promise<ValidatedMediaPaths> {
  try {
    const validationMedia: SnapshotGameMediaForValidation = {
      landscapePath: media.landscapePath,
      coverPath: media.coverPath,
      backgroundPath: media.backgroundPath,
      logoPath: media.logoPath,
      iconPath: media.iconPath,
    };
    return await validatePathsRust(appId, validationMedia);
  } catch {
    // If validation fails, return paths as-is with existence by presence
    return {
      landscapePath: media.landscapePath,
      landscapeExists: !!media.landscapePath,
      coverPath: media.coverPath,
      coverExists: !!media.coverPath,
      backgroundPath: media.backgroundPath,
      backgroundExists: !!media.backgroundPath,
      logoPath: media.logoPath,
      logoExists: !!media.logoPath,
      iconPath: media.iconPath,
      iconExists: !!media.iconPath,
    };
  }
}

// ---------------------------------------------------------------------------
// Pending appinfo update tracking — Part 5 flush mechanism
// ---------------------------------------------------------------------------

export function trackPendingAppInfoUpdate(): void {
  pendingAppInfoUpdateCount++;
}

export function completePendingAppInfoUpdate(): void {
  pendingAppInfoUpdateCount = Math.max(0, pendingAppInfoUpdateCount - 1);
  if (pendingAppInfoUpdateCount === 0 && pendingAppInfoUpdateResolve) {
    pendingAppInfoUpdateResolve();
    pendingAppInfoUpdateResolve = null;
  }
}

export async function flushPendingAppInfoUpdates(timeoutMs = 3000): Promise<boolean> {
  if (pendingAppInfoUpdateCount === 0) return true;

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingAppInfoUpdateResolve = null;
      if (ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
        console.log(`[BootSnapshot] appinfo flush timed out (${pendingAppInfoUpdateCount} pending)`);
      }
      resolve(false);
    }, timeoutMs);

    pendingAppInfoUpdateResolve = () => {
      clearTimeout(timeout);
      if (ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
        console.log("[BootSnapshot] appinfo flush completed");
      }
      resolve(true);
    };

    // Check again in case it resolved between the check and setting up the listener
    if (pendingAppInfoUpdateCount === 0) {
      clearTimeout(timeout);
      pendingAppInfoUpdateResolve = null;
      resolve(true);
    }
  });
}

// ---------------------------------------------------------------------------
// readCanonicalAppinfosBatch — batch read canonical appinfo for all given
// appIds in a single Rust invocation. Returns a map of appId → GameAppInfo.
// Missing/corrupt appinfo is silently skipped.
// ---------------------------------------------------------------------------

async function readCanonicalAppinfosBatch(appIds: string[]): Promise<Record<string, GameAppInfo>> {
  if (appIds.length === 0) return {};
  return readCanonicalAppinfos(appIds);
}

// ---------------------------------------------------------------------------
// resolveMediaForSnapshot — resolve media for a single game from canonical
// appinfo with fallback to physical disk files.
// ---------------------------------------------------------------------------

type MediaForSnapshotResult = {
  media: SnapshotGameMedia;
  validated: ValidatedMediaPaths;
  hasMedia: boolean;
};

async function resolveMediaForSnapshot(
  appId: string,
  canonicalInfos?: Record<string, GameAppInfo>,
): Promise<MediaForSnapshotResult> {
  const emptyMedia: SnapshotGameMedia = {
    landscapePath: null,
    coverPath: null,
    backgroundPath: null,
    logoPath: null,
    iconPath: null,
  };
  const emptyValidated: ValidatedMediaPaths = {
    landscapePath: null, landscapeExists: false,
    coverPath: null, coverExists: false,
    backgroundPath: null, backgroundExists: false,
    logoPath: null, logoExists: false,
    iconPath: null, iconExists: false,
  };

  // Check session cache first
  if (!canonicalInfos && canonicalMediaCache.has(appId)) {
    const cached = canonicalMediaCache.get(appId);
    debugAppLog(appId, `session cache hit: ${cached ? "has media" : "no media"}`);
    if (cached) {
      return {
        media: {
          landscapePath: cached.landscapePath ?? null,
          coverPath: cached.coverPath ?? null,
          backgroundPath: cached.backgroundPath ?? null,
          logoPath: cached.logoPath ?? null,
          iconPath: cached.iconPath ?? null,
        },
        validated: {
          landscapePath: cached.landscapePath ?? null, landscapeExists: !!cached.landscapePath,
          coverPath: cached.coverPath ?? null, coverExists: !!cached.coverPath,
          backgroundPath: cached.backgroundPath ?? null, backgroundExists: !!cached.backgroundPath,
          logoPath: cached.logoPath ?? null, logoExists: !!cached.logoPath,
          iconPath: cached.iconPath ?? null, iconExists: !!cached.iconPath,
        },
        hasMedia: true,
      };
    }
    return { media: emptyMedia, validated: emptyValidated, hasMedia: false };
  }

  // 1. Try canonical appinfo (lightweight — reads appinfo.json only)
  try {
    const appInfo = canonicalInfos?.[appId] ?? await getGameAppInfo(appId);
    if (appInfo) {
      debugAppLog(appId, `canonical appinfo found, name=${appInfo.name}`);
      const normalized = normalizeAppInfoMedia(appInfo);
      if (normalized) {
        debugAppLog(appId, `normalized media: cover=${!!normalized.coverPath} landscape=${!!normalized.landscapePath} bg=${!!normalized.backgroundPath} logo=${!!normalized.logoPath} icon=${!!normalized.iconPath}`);
        const validated = await validateSnapshotMediaPaths(appId, normalized);
        const hasMedia = !!(validated.landscapePath || validated.coverPath || validated.backgroundPath || validated.logoPath || validated.iconPath);
        const cacheEntry: GameMediaPaths = {
          landscapePath: validated.landscapePath ?? null,
          coverPath: validated.coverPath ?? null,
          backgroundPath: validated.backgroundPath ?? null,
          logoPath: validated.logoPath ?? null,
          iconPath: validated.iconPath ?? null,
        };
        canonicalMediaCache.set(appId, hasMedia ? cacheEntry : null);
        if (hasMedia && ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
          console.log(`[BootSnapshot] media resolved { appId: ${appId}, landscape: ${!!validated.landscapePath}, cover: ${!!validated.coverPath}, background: ${!!validated.backgroundPath}, logo: ${!!validated.logoPath}, icon: ${!!validated.iconPath} }`);
        }
        return { media: validated, validated, hasMedia };
      } else {
        debugAppLog(appId, "normalized media is null — no media paths in appinfo");
      }
    } else {
      debugAppLog(appId, "canonical appinfo not found");
    }
  } catch {
    debugAppLog(appId, "canonical appinfo read error");
    // Corrupt or missing — fall through
  }

  // 2. Fallback: check physical media files on disk
  try {
    const diskPaths = await resolveGameMediaPaths(appId);
    if (diskPaths) {
      const media: SnapshotGameMedia = {
        landscapePath: diskPaths.landscapePath ?? null,
        coverPath: diskPaths.coverPath ?? null,
        backgroundPath: diskPaths.backgroundPath ?? null,
        logoPath: diskPaths.logoPath ?? null,
        iconPath: diskPaths.iconPath ?? null,
      };
      const validated = await validateSnapshotMediaPaths(appId, media);
      const hasMedia = !!(validated.landscapePath || validated.coverPath || validated.backgroundPath || validated.logoPath || validated.iconPath);
      canonicalMediaCache.set(appId, hasMedia ? {
        landscapePath: validated.landscapePath ?? null,
        coverPath: validated.coverPath ?? null,
        backgroundPath: validated.backgroundPath ?? null,
        logoPath: validated.logoPath ?? null,
        iconPath: validated.iconPath ?? null,
      } : null);
      debugAppLog(appId, `disk fallback: hasMedia=${hasMedia}`);
      if (hasMedia && ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
        console.log(`[BootSnapshot] media resolved (disk fallback) { appId: ${appId}, landscape: ${!!validated.landscapePath}, cover: ${!!validated.coverPath}, background: ${!!validated.backgroundPath}, logo: ${!!validated.logoPath}, icon: ${!!validated.iconPath} }`);
      }
      return { media: validated, validated, hasMedia };
    } else {
      debugAppLog(appId, "disk fallback: no media files found");
    }
  } catch {
    debugAppLog(appId, "disk fallback error");
    // Fall through
  }

  canonicalMediaCache.set(appId, null);
  debugAppLog(appId, "no media resolved from any source");
  return { media: emptyMedia, validated: emptyValidated, hasMedia: false };
}

/**
 * Clear the entire canonical media cache. Call this after any bulk media
 * repair or when the cache may be stale.
 */
export function clearCanonicalMediaCache(): void {
  canonicalMediaCache.clear();
}

/**
 * Invalidate the cache for a single appId. Called after media is repaired
 * or downloaded for a specific game so the next snapshot rebuild picks up
 * the latest paths.
 */
export function invalidateCanonicalMediaCache(appId: string): void {
  canonicalMediaCache.delete(appId);
}

export function hasCanonicalMediaCacheEntry(appId: string): boolean {
  return canonicalMediaCache.has(appId);
}

/**
 * Called after media is repaired or downloaded for a specific game.
 * Busts the in-memory cache and schedules a debounced snapshot write.
 * Multiple calls within the debounce window coalesce into one write.
 * This ensures the startup snapshot stays in sync without repeated
 * disk writes for each individual field update.
 */
export async function notifyMediaUpdated(appId: string, options?: { source?: string }): Promise<void> {
  canonicalMediaCache.delete(appId);

  // Block snapshot writes originating from Store display-only operations
  const storeDisplaySources = new Set(["store-display-image", "browse-image", "discover-image", "news-image", "store-details-image", "dashboard-remote-image"]);
  if (options?.source && storeDisplaySources.has(options.source)) {
    console.log(`[BootSnapshot][WRITE_SKIP] reason=display-only-change appid=${appId} source=${options.source}`);
    return;
  }

  // Block snapshot writes from display-only MediaIndex sources
  const displaySources = new Set(["store-display", "dashboard-display", "browse-display", "metadata-display"]);
  if (options?.source && displaySources.has(options.source)) {
    console.log(`[BootSnapshot][WRITE_SKIP] reason=display-only-source appid=${appId} source=${options.source}`);
    return;
  }

  // Skip snapshot write when source is local-media-repair — the MediaIndex was
  // already updated with the new paths from appinfo.json, so re-reading appinfo
  // would find the same data and produce a no-effective-change skip.
  if (options?.source === "local-media-repair") {
    console.log(`[BootSnapshot][WRITE_SKIP] reason=media-index-already-synced appid=${appId} source=local-media-repair`);
    return;
  }

  _dirtyAppIds.add(appId);
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  if (hash.startsWith("#/store")) {
    console.log(`[BootSnapshot][WRITE_SKIP] reason=store-active-no-local-change appid=${appId}`);
    return; // NO snapshot write when Store is active
  }
  _scheduleMediaUpdateWrite("media-update", appId);
}

// ── Debounced media update write (Part 2) ──

function _scheduleMediaUpdateWrite(reason: string, appId?: string): void {
  if (_mediaUpdateTimer) {
    _coalescedScheduleCount++;
    return;
  }
  if (_writeInProgress) {
    _pendingAfterWrite = true;
    return;
  }
  console.log(`[BootSnapshot][SCHEDULE] reason=${reason} appid=${appId ?? "?"} dirtyAppIds=${_dirtyAppIds.size} alreadyScheduled=false`);
  _mediaUpdateTimer = setTimeout(() => _processDirtyAppIds(), 2000);
}

async function _processDirtyAppIds(): Promise<void> {
  _mediaUpdateTimer = null;
  _writeInProgress = true;

  // Phase 9 + S3: Defer snapshot write during active interaction (scroll/click/nav),
  // with a maximum defer limit of MAX_DEFER_DURATION_MS to prevent indefinite deferral.
  if (isInteractionBusy()) {
    if (_mediaUpdateDeferStart === null) {
      _mediaUpdateDeferStart = Date.now();
      console.log(`[BootSnapshot][WRITE_DEFER] reason=interaction-busy dirtyAppIds=${_dirtyAppIds.size}`);
      _writeInProgress = false;
      _mediaUpdateTimer = setTimeout(_processDirtyAppIds, 2000);
      return;
    }
    const elapsed = Date.now() - _mediaUpdateDeferStart;
    if (elapsed >= MAX_DEFER_DURATION_MS) {
      console.log(`[BootSnapshot][WRITE_FORCED_AFTER_MAX_DEFER] reason=interaction-timeout elapsedMs=${elapsed} dirtyAppIds=${_dirtyAppIds.size}`);
      _mediaUpdateDeferStart = null;
      // Fall through — proceed with the write despite interaction being busy
    } else {
      console.log(`[BootSnapshot][WRITE_DEFERRED_INTERACTION] elapsedMs=${elapsed} dirtyAppIds=${_dirtyAppIds.size}`);
      _writeInProgress = false;
      _mediaUpdateTimer = setTimeout(_processDirtyAppIds, 2000);
      return;
    }
  }

  const appIds = [..._dirtyAppIds];
  const dirtyCount = appIds.length;

  if (dirtyCount === 0) {
    console.log(`[BootSnapshot][WRITE_SKIP] reason=no-dirty-appids`);
    _mediaUpdateDeferStart = null;
    _writeInProgress = false;
    return;
  }

  console.log(`[BootSnapshot][WRITE_START] reason=media-update dirtyAppIds=${dirtyCount}`);

  if (!cachedSnapshot) {
    _mediaUpdateDeferStart = null;
    _writeInProgress = false;
    _dirtyAppIds.clear();
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  let effectiveChanges = 0;

  // Process each dirty appId: resolve fresh media, update in-memory snapshot
  for (const appId of appIds) {
    try {
      const { media, validated, hasMedia } = await resolveMediaForSnapshot(appId);

      let changed = false;

      // Update library game entry — compare media fields for no-op detection
      for (const game of cachedSnapshot.library.games) {
        if (game.appId === appId) {
          const origMedia = game.media;
          // Check if media actually changed
          const mediaChanged =
            origMedia.landscapePath !== media.landscapePath ||
            origMedia.coverPath !== media.coverPath ||
            origMedia.backgroundPath !== media.backgroundPath ||
            origMedia.logoPath !== media.logoPath ||
            origMedia.iconPath !== media.iconPath;
          if (mediaChanged) {
            changed = true;
            game.updatedAt = now;
          }
          game.media = media;
          await setMediaStatusOnGame(game, origMedia, validated);
          break;
        }
      }

      // Update sidebar entry
      for (const item of cachedSnapshot.sidebar.items) {
        if (item.appId === appId) {
          if (item.media.landscapePath !== media.landscapePath || item.media.coverPath !== media.coverPath) {
            changed = true;
          }
          item.media.landscapePath = media.landscapePath;
          item.media.coverPath = media.coverPath;
          break;
        }
      }

      // Update mediaReadyAppIds
      const wasReady = cachedSnapshot.indexes.mediaReadyAppIds.includes(appId);
      if (hasMedia && !wasReady) {
        cachedSnapshot.indexes.mediaReadyAppIds.push(appId);
        changed = true;
      } else if (!hasMedia && wasReady) {
        cachedSnapshot.indexes.mediaReadyAppIds = cachedSnapshot.indexes.mediaReadyAppIds.filter((id) => id !== appId);
        changed = true;
      }

      if (changed) {
        effectiveChanges++;
      }
    } catch (err) {
      console.warn(`[BootSnapshot] failed to process dirty appId=${appId}:`, err);
    }
  }

  if (effectiveChanges === 0) {
    console.log(`[BootSnapshot][WRITE_SKIP] reason=no-effective-change dirtyAppIds=${dirtyCount}`);
    _dirtyAppIds.clear();
    _mediaUpdateDeferStart = null;
    _writeInProgress = false;
    if (_pendingAfterWrite) {
      _pendingAfterWrite = false;
      _mediaUpdateTimer = setTimeout(() => _processDirtyAppIds(), 1000);
    }
    return;
  }

  // Persist once for all dirty appIds
  try {
    await saveStartupSnapshot(cachedSnapshot);
    const gamesCount = cachedSnapshot.library.games.length;
    const sidebarCount = cachedSnapshot.sidebar.items.length;
    console.log(`[BootSnapshot][WRITE_DONE] games=${gamesCount} sidebarItems=${sidebarCount} dirtyAppIds=${dirtyCount} effectiveChanges=${effectiveChanges}`);
    if (_coalescedScheduleCount > 0) {
      console.log(`[BootSnapshot][WRITE_COALESCED] skippedExtraSchedules=${_coalescedScheduleCount}`);
      _coalescedScheduleCount = 0;
    }

    // Clear dirty set only after confirmed successful write
    _dirtyAppIds.clear();
    _mediaUpdateDeferStart = null;
    _writeInProgress = false;

    // If writes came in while we were writing, schedule one more debounced write
    if (_pendingAfterWrite) {
      _pendingAfterWrite = false;
      console.log(`[BootSnapshot][SCHEDULE] reason=pending-after-write dirtyAppIds=${_dirtyAppIds.size} alreadyScheduled=false`);
      _mediaUpdateTimer = setTimeout(() => _processDirtyAppIds(), 1000);
    }
  } catch (writeErr) {
    console.warn("[BootSnapshot] write after coalesced media update failed:", writeErr);
    console.log(`[BootSnapshot][DIRTY_PRESERVED_AFTER_WRITE_FAIL] count=${_dirtyAppIds.size}`);
    _mediaUpdateDeferStart = null;
    _writeInProgress = false;

    // Schedule a retry if pending writes came in during the failed write
    if (_pendingAfterWrite) {
      _pendingAfterWrite = false;
      console.log(`[BootSnapshot][SCHEDULE] reason=retry-after-failed-write dirtyAppIds=${_dirtyAppIds.size} alreadyScheduled=false`);
      _mediaUpdateTimer = setTimeout(() => _processDirtyAppIds(), 1000);
    }
  }
}

// ---------------------------------------------------------------------------
// Batch notify — Part 6: Update snapshot after media changes for multiple
// appIds. Schedules a debounced snapshot write instead of immediate persist.
// ---------------------------------------------------------------------------

export async function notifyMediaUpdatedBatch(
  games: LibraryGame[],
  appInfoMap: Record<string, any>,
  statsMap: Map<number, SteamUserGameStats> | null,
): Promise<void> {
  // Clear canonical cache for all affected appIds so next read picks up changes
  for (const game of games) {
    if (game.appId) {
      canonicalMediaCache.delete(game.appId);
    }
  }

  // Schedule a debounced snapshot write (1-3 seconds)
  scheduleSnapshotWrite(games, appInfoMap, statsMap, 1500, "batch-media-update");
}

export type StartupSnapshot = {
  version: number;
  updatedAt: number;
  library: SnapshotLibrary;
  sidebar: SnapshotSidebar;
  indexes: SnapshotIndexes;
  lastKnownStats: SnapshotStats | null;
};

export type SnapshotLibrary = {
  games: SnapshotGame[];
};

export type MediaStatus = "ready" | "partial" | "missing" | "stale" | "pending";

export const REQUIRED_UI_ROLES = ["cover", "landscape", "background"] as const;
export const ALL_MEDIA_ROLES = ["cover", "landscape", "background", "logo", "icon"] as const;

export type SnapshotAchievementSummary = {
  total: number;
  unlocked: number;
  percent: number;
  progressAvailable: boolean;
};

export type SnapshotGame = {
  appId: string;
  provider: string;
  title: string;
  installed: boolean;
  playable: boolean;
  favorite?: boolean;
  hidden?: boolean;
  source: string;
  installPath: string | null;
  media: SnapshotGameMedia;
  lastPlayed: number | null;
  playtime: number | null;
  cloudStatus: string | null;
  mediaStatus: MediaStatus | null;
  missingMedia: string[];
  achievementSummary?: SnapshotAchievementSummary | null;
  lastMediaCheckAt: number | null;
  updatedAt?: number;
};

export type SnapshotGameMedia = {
  landscapePath: string | null;
  coverPath: string | null;
  backgroundPath: string | null;
  logoPath: string | null;
  iconPath: string | null;
};

export type SnapshotSidebar = {
  items: SnapshotSidebarItem[];
};

export type SnapshotSidebarItem = {
  appId: string;
  title: string;
  provider: string;
  media: SnapshotSidebarMedia;
};

export type SnapshotSidebarMedia = {
  landscapePath: string | null;
  coverPath: string | null;
};

export type SnapshotIndexes = {
  appIds: string[];
  mediaReadyAppIds: string[];
  luaFingerprint?: string | null;
  appinfoFingerprint?: string | null;
  dashboardFingerprint?: string | null;
};

export type SnapshotStats = {
  entries: SnapshotStatsEntry[];
};

export type SnapshotStatsEntry = {
  appId: string;
  lastPlayed: number | null;
  playtime: number | null;
  cloudStatus: string | null;
};

/**
 * Boot-time snapshot hydration repair.
 *
 * For each game in the snapshot, if media paths are missing/null, repair them
 * from canonical per-game appinfo.json (lightweight read). If appinfo also
 * missing, fall back to checking physical media files on disk.
 *
 * Also merges title/name from canonical appinfo if snapshot title is null.
 *
 * Rules:
 * - Reads only lightweight appinfo.json (not details.json).
 * - Does NOT call SteamGridDB, Store metadata, or any network requests.
 * - Does NOT run steam-user-stats scan.
 * - Does NOT trigger media downloads.
 * - Never overwrites snapshot valid path with null (appinfo is source of truth).
 *
 * Returns summary stats for boot-time diagnostics.
 */
export async function hydrateStartupSnapshotMedia(
  snapshot: StartupSnapshot,
): Promise<{
  changed: boolean;
  repairedCount: number;
  repairedFromAppinfo: number;
  repairedFromPhysical: number;
  readyCount: number;
  partialCount: number;
  missingCount: number;
  staleCount: number;
}> {
  let changed = false;
  let repairedCount = 0;
  let repairedFromAppinfo = 0;
  let repairedFromPhysical = 0;
  const changedAppIds = new Set<string>();

  // Batch-read all canonical appinfos in one Rust invocation
  const allAppIds = snapshot.library.games.map((g) => g.appId).filter(Boolean);
  const canonicalInfos = await readCanonicalAppinfosBatch(allAppIds);

  // Store in boot cache for reuse by Stage 4.5 title enrichment
  _bootAppInfoCache = canonicalInfos as Record<string, GameAppInfo>;

  const canonicalReadCount = Object.keys(canonicalInfos).length;
  if (ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
    console.log(`[BootSnapshot] canonical appinfos read: ${canonicalReadCount} / ${allAppIds.length}`);
  }

  let readyCount = 0;
  let partialCount = 0;
  let missingCount = 0;
  let staleCount = 0;

  // Phase 3+5: Batch-validate all snapshot media paths in a single Tauri call.
  const snapshotMediaBatch: Record<string, SnapshotGameMediaForValidation> = {};
  for (const game of snapshot.library.games) {
    if (!game.appId) continue;
    const canonicalInfo = canonicalInfos[game.appId];
    const normalizedMedia = canonicalInfo ? normalizeAppInfoMedia(canonicalInfo) : null;
    if (normalizedMedia) {
      snapshotMediaBatch[game.appId] = normalizedMedia;
    }
  }
  const validatedBatch = Object.keys(snapshotMediaBatch).length > 0
    ? await validateSnapshotMediaPathsBatch(snapshotMediaBatch)
    : {};
  if (Object.keys(snapshotMediaBatch).length > 0) {
    console.log(`[PERF][BOOT_BATCH] hydrateSnapshot validatedBatch=${Object.keys(validatedBatch).length}/${Object.keys(snapshotMediaBatch).length}`);
  }

  for (const game of snapshot.library.games) {
    if (!game.appId) continue;

    const media = game.media;
    const originalMedia = { ...media };
    const canonicalInfo = canonicalInfos[game.appId];
    const hasCanonical = !!canonicalInfo;

    debugAppLog(game.appId, `hydrate: hasCanonical=${hasCanonical}, snapshot media present: cover=${!!media.coverPath} landscape=${!!media.landscapePath} bg=${!!media.backgroundPath} logo=${!!media.logoPath} icon=${!!media.iconPath}`);

    // Get normalized media from canonical appinfo
    const normalizedMedia = hasCanonical ? normalizeAppInfoMedia(canonicalInfo) : null;

    const needsTitle = !game.title || game.title.startsWith("Steam App ");
    const canRepairTitle = needsTitle && hasCanonical && !!canonicalInfo.name;

    let gameChanged = false;

    // Use batch-validated result if available, fall back to per-app if not in batch
    if (normalizedMedia) {
      const validated = validatedBatch[game.appId] ?? await validateSnapshotMediaPaths(game.appId, normalizedMedia);

      // Apply all paths from appinfo — replace snapshot values with canonically
      // validated paths. Only count as repair if at least one path changed.
      let roleChanged = false;
      const roles: Array<keyof SnapshotGameMedia> = ["landscapePath", "coverPath", "backgroundPath", "logoPath", "iconPath"];
      for (const role of roles) {
        if (media[role] !== validated[role]) {
          const oldVal = media[role];
          (media as Record<string, string | null>)[role] = validated[role];
          if (validated[role]) {
            repairedCount++;
            repairedFromAppinfo++;
            debugAppLog(game.appId, `repaired ${role}: ${oldVal} -> ${validated[role]}`);
          } else if (oldVal) {
            // Path was stripped because file no longer exists
            debugAppLog(game.appId, `stripped ${role}: ${oldVal} -> null (file missing)`);
          }
          roleChanged = true;
        }
      }
      if (roleChanged) gameChanged = true;
    }

    // Repair title from canonical appinfo if snapshot title is missing
    if (canRepairTitle) {
      game.title = canonicalInfo.name!;
      gameChanged = true;
      debugAppLog(game.appId, `repaired title: ${game.title}`);
    }

    if (gameChanged) {
      changed = true;
      changedAppIds.add(game.appId);
      debugAppLog(game.appId, "game data changed in hydrate");
    }

    // Compute media status for every game (even if no repair needed)
    await setMediaStatusOnGame(game, originalMedia);
    if (game.mediaStatus === "ready") readyCount++;
    else if (game.mediaStatus === "partial") partialCount++;
    else if (game.mediaStatus === "missing") missingCount++;
    else if (game.mediaStatus === "stale") staleCount++;
  }

  // Sync sidebar items for changed appIds
  for (const item of snapshot.sidebar.items) {
    if (!changedAppIds.has(item.appId)) continue;
    const game = snapshot.library.games.find((g) => g.appId === item.appId);
    if (game) {
      item.media = {
        landscapePath: game.media.landscapePath,
        coverPath: game.media.coverPath,
      };
    }
  }

  // Update mediaReadyAppIds for newly resolved games
  for (const appId of changedAppIds) {
    const game = snapshot.library.games.find((g) => g.appId === appId);
    if (game) {
      const hasMedia = !!(game.media.landscapePath || game.media.coverPath || game.media.backgroundPath || game.media.logoPath || game.media.iconPath);
      if (hasMedia && !snapshot.indexes.mediaReadyAppIds.includes(appId)) {
        snapshot.indexes.mediaReadyAppIds.push(appId);
      }
    }
  }

  console.log(
    `[BootSnapshot] synced from appinfo — ready: ${readyCount}, partial: ${partialCount}, missing: ${missingCount}, stale: ${staleCount}`
  );

  if (ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
    console.log(`[BootSnapshot] media copied from appinfo: ${repairedFromAppinfo}`);
    console.log(`[BootSnapshot] paths validated: ${repairedCount}`);
    console.log(`[BootSnapshot] snapshot entries repaired: ${changedAppIds.size}`);
    console.log(`[BootSnapshot] mediaReadyAppIds: ${snapshot.indexes.mediaReadyAppIds.length}`);
  }

  return { changed, repairedCount, repairedFromAppinfo, repairedFromPhysical, readyCount, partialCount, missingCount, staleCount };
}

function ensureSnapshotBackwardCompat(snapshot: StartupSnapshot): void {
  const now = Math.floor(Date.now() / 1000);
  for (const game of snapshot.library.games) {
    game.favorite = game.favorite ?? false;
    game.hidden = game.hidden ?? false;
    if (!game.updatedAt) game.updatedAt = now;
    // achievementSummary intentionally left null if not present — hydrated later
  }
}

function snapshotNeedsUpgrade(snapshot: StartupSnapshot): boolean {
  return snapshot.library.games.some(g =>
    g.favorite == null || g.hidden == null || g.updatedAt == null
  );
}

export async function loadStartupSnapshot(): Promise<StartupSnapshot | null> {
  if (cachedSnapshot) return cachedSnapshot;
  try {
    const result = await invoke<StartupSnapshot | null>("read_startup_snapshot");
    if (result && result.version === SNAPSHOT_VERSION) {
      const needsUpgrade = snapshotNeedsUpgrade(result);
      ensureSnapshotBackwardCompat(result);
      cachedSnapshot = result;
      const withFavField = result.library.games.filter(g => g.favorite != null).length;
      const favTrue = result.library.games.filter(g => g.favorite === true).length;
      const withHiddenField = result.library.games.filter(g => g.hidden != null).length;
      const hiddenTrue = result.library.games.filter(g => g.hidden === true).length;
      const achObject = result.library.games.filter(g => g.achievementSummary != null).length;
      const achNull = result.library.games.filter(g => g.achievementSummary == null).length;
      const withUpdatedField = result.library.games.filter(g => g.updatedAt != null).length;
      console.log(`[BootSnapshot][SHAPE] games=${result.library.games.length} withFavoriteField=${withFavField} favoriteTrue=${favTrue} withHiddenField=${withHiddenField} hiddenTrue=${hiddenTrue} withAchievementSummaryField=${result.library.games.length} achievementSummaryObject=${achObject} achievementSummaryNull=${achNull} withUpdatedAt=${withUpdatedField}`);
      // Phase 6: Initialize fingerprint on load so first full-rebuild doesn't
      // write when dirtyAppIds=0 and content hasn't changed.
      _lastWriteFingerprint = computeSnapshotFingerprint(result);
      if (needsUpgrade) {
        saveStartupSnapshot(result); // persist upgraded fields to disk
      }
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

export function getCachedSnapshot(): StartupSnapshot | null {
  return cachedSnapshot;
}

let _lastWriteFingerprint = "";

function computeSnapshotFingerprint(snapshot: StartupSnapshot): string {
  // Lightweight fingerprint — exclude updatedAt (transient, changes every write)
  const relevantGames = snapshot.library.games.slice(0, 200).map((g) => ({
    a: g.appId,
    m: g.media,
    s: g.achievementSummary ? `${g.achievementSummary.total}:${g.achievementSummary.unlocked}:${g.achievementSummary.percent}` : null,
    f: g.favorite,
    h: g.hidden,
  }));
  const relevantSidebar = snapshot.sidebar.items.slice(0, 100).map((s) => ({
    a: s.appId,
    m: s.media,
  }));
  return JSON.stringify({ games: relevantGames, sidebar: relevantSidebar });
}

export async function saveStartupSnapshot(snapshot: StartupSnapshot): Promise<void> {
  const fp = computeSnapshotFingerprint(snapshot);
  if (fp === _lastWriteFingerprint) {
    console.log(`[BootSnapshot][WRITE_SKIP] reason=no-content-change`);
    return;
  }
  _lastWriteFingerprint = fp;

  const isMediaUpdatePath = snapshot === cachedSnapshot;

  // Write to disk first so a failed write never creates phantom in-memory state
  try {
    await invoke("write_startup_snapshot", { snapshot });
    console.log(`[BootSnapshot] save ok`);
  } catch {
    // non-critical
  }

  // Only replace in-memory cachedSnapshot if no active media-update write
  // (_processDirtyAppIds) is in progress. The media-update path mutates
  // cachedSnapshot in-place and must keep a stable reference across awaits.
  // For the media-update path (snapshot === cachedSnapshot) the assignment
  // is always a no-op since it is the same object reference.
  if (!(_writeInProgress && !isMediaUpdatePath)) {
    cachedSnapshot = snapshot;
  }

  // Shape logging reads snapshot, not cachedSnapshot — safe after write
  const withFavField = snapshot.library.games.filter(g => g.favorite != null).length;
  const favTrue = snapshot.library.games.filter(g => g.favorite === true).length;
  const withHiddenField = snapshot.library.games.filter(g => g.hidden != null).length;
  const hiddenTrue = snapshot.library.games.filter(g => g.hidden === true).length;
  const achObject = snapshot.library.games.filter(g => g.achievementSummary != null).length;
  const achNull = snapshot.library.games.filter(g => g.achievementSummary == null).length;
  const withUpdatedField = snapshot.library.games.filter(g => g.updatedAt != null).length;
  console.log(`[BootSnapshot][SHAPE] games=${snapshot.library.games.length} withFavoriteField=${withFavField} favoriteTrue=${favTrue} withHiddenField=${withHiddenField} hiddenTrue=${hiddenTrue} withAchievementSummaryField=${snapshot.library.games.length} achievementSummaryObject=${achObject} achievementSummaryNull=${achNull} withUpdatedAt=${withUpdatedField}`);
}

export async function clearStartupSnapshot(): Promise<void> {
  cachedSnapshot = null;
  try {
    await invoke("clear_startup_snapshot");
  } catch {
    // non-critical
  }
}

export function mediaPathsFromSnapshot(
  snapshot: StartupSnapshot | null,
  appId: string,
): SnapshotGameMedia | null {
  if (!snapshot) return null;
  for (const game of snapshot.library.games) {
    if (game.appId === appId) {
      return game.media;
    }
  }
  return null;
}

export function snapshotGameFromSnapshot(
  snapshot: StartupSnapshot | null,
  appId: string,
): SnapshotGame | null {
  if (!snapshot) return null;
  for (const game of snapshot.library.games) {
    if (game.appId === appId) {
      return game;
    }
  }
  return null;
}

export async function buildStartupSnapshotFromCurrentState(
  games: LibraryGame[],
  appInfoMap: Record<string, any>,
  statsMap: Map<number, SteamUserGameStats> | null,
): Promise<StartupSnapshot> {
  const now = Math.floor(Date.now() / 1000);
  const snapshotGames: SnapshotGame[] = [];
  const sidebarItems: SnapshotSidebarItem[] = [];
  const appIds: string[] = [];
  const mediaReadyAppIds: string[] = [];

  // Flush any pending appinfo updates before snapshot read
  const flushed = await flushPendingAppInfoUpdates(2000);
  if (ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
    if (flushed) {
      console.log("[BootSnapshot] appinfo flush completed");
    } else {
      console.log("[BootSnapshot] appinfo flush timed out — using latest memory state");
    }
  }

  // Batch-read all canonical appinfos in one Rust invocation
  const allAppIds = games.map((g) => g.appId).filter(Boolean) as string[];
  const canonicalInfos = await readCanonicalAppinfosBatch(allAppIds);

  const canonicalReadCount = Object.keys(canonicalInfos).length;
  if (ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
    console.log(`[BootSnapshot] canonical appinfos read: ${canonicalReadCount} / ${allAppIds.length}`);
  }

  // Phase 3+5: Batch-validate media paths for games with canonical info.
  const canonicalMediaBatch: Record<string, SnapshotGameMediaForValidation> = {};
  for (const game of games) {
    if (!game.appId) continue;
    const canonicalInfo = canonicalInfos[game.appId];
    if (canonicalInfo) {
      const normalized = normalizeAppInfoMedia(canonicalInfo);
      if (normalized) {
        canonicalMediaBatch[game.appId] = normalized;
      }
    }
  }
  const validatedCanonicalBatch = Object.keys(canonicalMediaBatch).length > 0
    ? await validateSnapshotMediaPathsBatch(canonicalMediaBatch)
    : {};

  // Collect non-canonical games for batch disk path resolution
  const diskFallbackAppIds = games
    .filter((g) => g.appId && !canonicalInfos[g.appId])
    .map((g) => g.appId) as string[];
  const fallbackDiskPaths = diskFallbackAppIds.length > 0
    ? await resolveGameMediaPathsBatch(diskFallbackAppIds)
    : {};

  for (const game of games) {
    if (!game.appId) continue;
    appIds.push(game.appId);

    const canonicalInfo = canonicalInfos[game.appId];
    const hasCanonical = !!canonicalInfo;

    // Resolve title: appinfo.name > appInfoMap name > game.title > fallback
    const title = hasCanonical && canonicalInfo.name
      ? canonicalInfo.name
      : (appInfoMap[game.appId]?.name || game.title || `Steam App ${game.appId}`);

    // Resolve media: canonical appinfo as primary source
    let media: SnapshotGameMedia;
    let validatedForStatus: ValidatedMediaPaths | null = null;
    let hasMedia = false;

    if (hasCanonical) {
      const normalized = normalizeAppInfoMedia(canonicalInfo);
      if (normalized) {
        debugAppLog(game.appId, `canonical media: cover=${!!normalized.coverPath} landscape=${!!normalized.landscapePath} bg=${!!normalized.backgroundPath} logo=${!!normalized.logoPath} icon=${!!normalized.iconPath}`);
        validatedForStatus = validatedCanonicalBatch[game.appId] ?? await validateSnapshotMediaPaths(game.appId, normalized);
        hasMedia = !!(validatedForStatus.landscapePath || validatedForStatus.coverPath || validatedForStatus.backgroundPath || validatedForStatus.logoPath || validatedForStatus.iconPath);
        debugAppLog(game.appId, `validated media: hasMedia=${hasMedia} cover=${!!validatedForStatus.coverPath} landscape=${!!validatedForStatus.landscapePath} background=${!!validatedForStatus.backgroundPath} logo=${!!validatedForStatus.logoPath} icon=${!!validatedForStatus.iconPath}`);
        media = {
          landscapePath: validatedForStatus.landscapePath,
          coverPath: validatedForStatus.coverPath,
          backgroundPath: validatedForStatus.backgroundPath,
          logoPath: validatedForStatus.logoPath,
          iconPath: validatedForStatus.iconPath,
        };
      } else {
        debugAppLog(game.appId, "normalizeAppInfoMedia returned null");
        media = { landscapePath: null, coverPath: null, backgroundPath: null, logoPath: null, iconPath: null };
      }
    } else {
      debugAppLog(game.appId, "no canonical appinfo, falling back to disk");
      // No canonical appinfo — fallback to physical media files
      const diskPaths = fallbackDiskPaths[game.appId];
      if (diskPaths) {
        const rawMedia: SnapshotGameMedia = {
          landscapePath: diskPaths.landscapePath ?? null,
          coverPath: diskPaths.coverPath ?? null,
          backgroundPath: diskPaths.backgroundPath ?? null,
          logoPath: diskPaths.logoPath ?? null,
          iconPath: diskPaths.iconPath ?? null,
        };
        validatedForStatus = await validateSnapshotMediaPaths(game.appId, rawMedia);
        hasMedia = !!(validatedForStatus.landscapePath || validatedForStatus.coverPath || validatedForStatus.backgroundPath || validatedForStatus.logoPath || validatedForStatus.iconPath);
        media = {
          landscapePath: validatedForStatus.landscapePath,
          coverPath: validatedForStatus.coverPath,
          backgroundPath: validatedForStatus.backgroundPath,
          logoPath: validatedForStatus.logoPath,
          iconPath: validatedForStatus.iconPath,
        };
      } else {
        media = { landscapePath: null, coverPath: null, backgroundPath: null, logoPath: null, iconPath: null };
      }
    }

    // Reuse the validated result from above for media status computation,
    // avoiding a duplicate Rust validation call per game.
    if (!validatedForStatus) {
      validatedForStatus = await validateSnapshotMediaPaths(game.appId, media);
    }
    const { mediaStatus, missingMedia } = computeMediaStatus(media, validatedForStatus);

    // Derive achievement summary from in-memory store if already loaded
    let achievementSummary: SnapshotAchievementSummary | null = null;
    try {
      const { achievementStore } = await import("./achievementStore");
      const stored = achievementStore.getSummary(game.appId);
      if (stored) {
        achievementSummary = {
          total: stored.total,
          unlocked: stored.unlocked ?? 0,
          percent: stored.percent ?? 0,
          progressAvailable: stored.progressAvailable,
        };
      }
    } catch {
      // achievementStore not available or not loaded — leave null
    }

    // Fallback: derive basic summary from LibraryGame fields if available
    if (!achievementSummary && game.achievementTotal != null) {
      achievementSummary = {
        total: game.achievementTotal,
        unlocked: game.achievementUnlocked ?? 0,
        percent: game.achievementTotal > 0 ? ((game.achievementUnlocked ?? 0) / game.achievementTotal) * 100 : 0,
        progressAvailable: game.achievementsSupported ?? false,
      };
    }

    // Preservation: if we still have no summary, keep the existing snapshot's value.
    // This prevents null from replacing a previously cached summary during full rebuilds
    // when achievementStore hasn't been loaded yet (ACHIEVEMENT_READ_CACHE_ON_BOOT=false).
    if (!achievementSummary && cachedSnapshot) {
      const existing = cachedSnapshot.library.games.find(g => g.appId === game.appId);
      if (existing?.achievementSummary) {
        achievementSummary = existing.achievementSummary;
      }
    }

    snapshotGames.push({
      appId: game.appId,
      provider: "steam",
      title,
      installed: game.steamInstalled,
      playable: game.isPlayable,
      favorite: game.isFavorite ?? false,
      hidden: false,
      source: game.source,
      installPath: game.installDir || null,
      media,
      lastPlayed: game.steamLastPlayedAt != null ? Math.floor(game.steamLastPlayedAt / 1000) : null,
      playtime: (getPlaytimeSecondsForAppId(game.appId) > 0 ? Math.round(getPlaytimeSecondsForAppId(game.appId) / 60) : null) ?? game.steamPlaytimeMinutes ?? null,
      cloudStatus: game.steamCloudStatus ?? null,
      mediaStatus,
      missingMedia,
      achievementSummary,
      lastMediaCheckAt: now,
      updatedAt: now,
    });

    if (hasMedia) {
      mediaReadyAppIds.push(game.appId);
    }

    // Sidebar: only include installed/playable/active games
    if (isSidebarInstalledGame(game)) {
      sidebarItems.push({
        appId: game.appId,
        title,
        provider: "steam",
        media: {
          landscapePath: media.landscapePath,
          coverPath: media.coverPath,
        },
      });
    }
  }

  if (ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
    console.log(`[BootSnapshot][SIDEBAR_FILTER] library=${games.length} sidebarAfter=${sidebarItems.length} installedOnly=true`);
  }

  let statsEntry: SnapshotStats | null = null;
  if (statsMap && statsMap.size > 0) {
    const entries: SnapshotStatsEntry[] = [];
    for (const [appIdNum, stat] of statsMap) {
      entries.push({
        appId: String(appIdNum),
        lastPlayed: stat.lastPlayed ?? null,
        playtime: stat.playtimeMinutes ?? null,
        cloudStatus: stat.cloudStatus ?? null,
      });
    }
    statsEntry = { entries };
  }

  return {
    version: SNAPSHOT_VERSION,
    updatedAt: now,
    library: { games: snapshotGames },
    sidebar: { items: sidebarItems },
    indexes: {
      appIds,
      mediaReadyAppIds,
    },
    lastKnownStats: statsEntry,
  };
}

export function scheduleSnapshotWrite(
  games: LibraryGame[],
  appInfoMap: Record<string, any>,
  statsMap: Map<number, SteamUserGameStats> | null,
  delayMs = 2000,
  reason?: string,
): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Phase 11: Defer full-rebuild snapshot writes during active navigation
  // to prevent competing with route transitions for disk I/O.
  if (isRecentlyNavigated(2000)) {
    console.log(`[BootSnapshot][WRITE_DEFER] reason=navigation-active caller=${reason ?? "unknown"} delayMs=${delayMs}`);
    debounceTimer = setTimeout(() => {
      scheduleSnapshotWrite(games, appInfoMap, statsMap, delayMs, reason);
    }, 1000);
    return;
  }

  const deduped = dedupeLibraryGames(games);
  if (deduped.length !== games.length) {
    console.log(`[BootSnapshot][DEDUP] before=${games.length} after=${deduped.length}`);
  }
  console.log(`[BootSnapshot][SCHEDULE] reason=${reason ?? "full-rebuild"} caller=${reason ?? "unknown"} games=${deduped.length} delayMs=${delayMs}`);
  debounceTimer = setTimeout(async () => {
    // Phase 7 + S3: Defer full rebuild during active interaction (scroll/click/nav),
    // with a maximum defer limit of MAX_DEFER_DURATION_MS to prevent indefinite deferral.
    if (isInteractionBusy()) {
      if (_fullRebuildDeferStart === null) {
        _fullRebuildDeferStart = Date.now();
        console.log(`[BootSnapshot][WRITE_DEFER] reason=interaction-busy caller=${reason ?? "unknown"} full-rebuild=true`);
        const cbArgs: Parameters<typeof scheduleSnapshotWrite> = [games, appInfoMap, statsMap, delayMs, reason];
        debounceTimer = setTimeout(() => scheduleSnapshotWrite(...cbArgs), 1500);
        return;
      }
      const elapsed = Date.now() - _fullRebuildDeferStart;
      if (elapsed >= MAX_DEFER_DURATION_MS) {
        console.log(`[BootSnapshot][WRITE_FORCED_AFTER_MAX_DEFER] reason=interaction-timeout elapsedMs=${elapsed} caller=${reason ?? "unknown"}`);
        _fullRebuildDeferStart = null;
        // Fall through — proceed with the build despite interaction being busy
      } else {
        console.log(`[BootSnapshot][WRITE_DEFERRED_INTERACTION] elapsedMs=${elapsed} caller=${reason ?? "unknown"}`);
        const cbArgs: Parameters<typeof scheduleSnapshotWrite> = [games, appInfoMap, statsMap, delayMs, reason];
        debounceTimer = setTimeout(() => scheduleSnapshotWrite(...cbArgs), 1500);
        return;
      }
    }

    // Phase 17: Defer full-rebuild when a media-update write (_processDirtyAppIds)
    // is in progress to prevent cross-path cachedSnapshot reference swap.
    if (_writeInProgress) {
      console.log(`[BootSnapshot][WRITE_DEFERRED_ACTIVE_WRITE] reason=active-media-write caller=${reason ?? "unknown"}`);
      const cbArgs: Parameters<typeof scheduleSnapshotWrite> = [games, appInfoMap, statsMap, delayMs, reason];
      debounceTimer = setTimeout(() => scheduleSnapshotWrite(...cbArgs), 1500);
      return;
    }

    const dirtyCount = _dirtyAppIds.size;
    try {
      const snapshot = await buildStartupSnapshotFromCurrentState(deduped, appInfoMap, statsMap);

      // No-op guard BEFORE WRITE_START log: skip save if content hasn't changed
      const newFp = computeSnapshotFingerprint(snapshot);
      if (newFp === _lastWriteFingerprint) {
        console.log(`[BootSnapshot][WRITE_SKIP] reason=no-content-change-full-rebuild games=${snapshot.library.games.length} sidebarItems=${snapshot.sidebar.items.length}`);
        _fullRebuildDeferStart = null;
        return;
      }

      // If dirtyCount is 0 but fingerprint changed, still proceed (unusual edge case)
      if (dirtyCount === 0) {
        console.log(`[BootSnapshot][WRITE_PROCEED] reason=fingerprint-changed-despite-dirty0 games=${snapshot.library.games.length}`);
      }

      console.log(`[BootSnapshot][WRITE_START] reason=full-rebuild dirtyAppIds=${dirtyCount}`);

      // Step 2: log sidebar filtering — SIDEBAR_FILTER for normal installed-only,
      // SIDEBAR_REPAIR only when fixing an old snapshot that had full-library sidebar
      const sidebarItemCount = snapshot.sidebar.items.length;
      if (deduped.length !== sidebarItemCount) {
        const wasFullLibrary = cachedSnapshot?.sidebar.items.length === deduped.length;
        if (wasFullLibrary) {
          console.log(`[BootSnapshot][SIDEBAR_REPAIR] before=${cachedSnapshot!.sidebar.items.length} after=${sidebarItemCount} reason=old-full-library-sidebar`);
        } else {
          console.log(`[BootSnapshot][SIDEBAR_FILTER] libraryGames=${deduped.length} sidebarItems=${sidebarItemCount} installedOnly=true`);
        }
      }

      await saveStartupSnapshot(snapshot);
      console.log(`[BootSnapshot][WRITE_DONE] games=${snapshot.library.games.length} sidebarItems=${sidebarItemCount} dirtyAppIds=${dirtyCount}`);
      if (_coalescedScheduleCount > 0) {
        console.log(`[BootSnapshot][WRITE_COALESCED] skippedExtraSchedules=${_coalescedScheduleCount}`);
        _coalescedScheduleCount = 0;
      }
      _fullRebuildDeferStart = null;
    } catch {
      console.warn("[BootSnapshot][WRITE] full-rebuild failed");
    }
  }, delayMs);
}

// ---------------------------------------------------------------------------
// scheduleSnapshotUpdateAfterMediaChange — Part 6: When appinfo changes for
// an appId, schedule a debounced snapshot write. Handles batching of
// multiple games automatically via the debounce timer.
// ---------------------------------------------------------------------------

export function scheduleSnapshotUpdateAfterMediaChange(
  games: LibraryGame[],
  appInfoMap: Record<string, any>,
  statsMap: Map<number, SteamUserGameStats> | null,
): void {
  // Debounce 1-3 seconds — batch multiple games, avoid write storm
  scheduleSnapshotWrite(games, appInfoMap, statsMap, 1500, "media-change");
}

export function cancelScheduledSnapshotWrite(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
