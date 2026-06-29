import { invoke } from "@tauri-apps/api/core";
import type { LibraryGame } from "../types/libraryGame";
import type { SteamUserGameStats } from "../types/steamUserStats";
import { getGameAppInfo, resolveGameMediaPaths, readCanonicalAppinfos, validateSnapshotMediaPaths as validatePathsRust } from "./tauri";
import type { GameMediaPaths, GameAppInfo, SnapshotGameMediaForValidation, ValidatedMediaPaths } from "./tauri";

const SNAPSHOT_VERSION = 1;
let cachedSnapshot: StartupSnapshot | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Debug log flag — set to true during testing, false by default
const ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS = false;

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
): Promise<void> {
  const validated = await validateSnapshotMediaPaths(game.media);
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
// ---------------------------------------------------------------------------

async function validateSnapshotMediaPaths(media: SnapshotGameMedia): Promise<ValidatedMediaPaths> {
  try {
    const validationMedia: SnapshotGameMediaForValidation = {
      landscapePath: media.landscapePath,
      coverPath: media.coverPath,
      backgroundPath: media.backgroundPath,
      logoPath: media.logoPath,
      iconPath: media.iconPath,
    };
    return await validatePathsRust(validationMedia);
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

async function resolveMediaForSnapshot(
  appId: string,
  canonicalInfos?: Record<string, GameAppInfo>,
): Promise<{
  media: SnapshotGameMedia;
  hasMedia: boolean;
}> {
  const empty: SnapshotGameMedia = {
    landscapePath: null,
    coverPath: null,
    backgroundPath: null,
    logoPath: null,
    iconPath: null,
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
        hasMedia: true,
      };
    }
    return { media: empty, hasMedia: false };
  }

  // 1. Try canonical appinfo (lightweight — reads appinfo.json only)
  try {
    const appInfo = canonicalInfos?.[appId] ?? await getGameAppInfo(appId);
    if (appInfo) {
      debugAppLog(appId, `canonical appinfo found, name=${appInfo.name}`);
      const normalized = normalizeAppInfoMedia(appInfo);
      if (normalized) {
        debugAppLog(appId, `normalized media: cover=${!!normalized.coverPath} landscape=${!!normalized.landscapePath} bg=${!!normalized.backgroundPath} logo=${!!normalized.logoPath} icon=${!!normalized.iconPath}`);
        const validated = await validateSnapshotMediaPaths(normalized);
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
        return { media: validated, hasMedia };
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
      const validated = await validateSnapshotMediaPaths(media);
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
      return { media: validated, hasMedia };
    } else {
      debugAppLog(appId, "disk fallback: no media files found");
    }
  } catch {
    debugAppLog(appId, "disk fallback error");
    // Fall through
  }

  canonicalMediaCache.set(appId, null);
  debugAppLog(appId, "no media resolved from any source");
  return { media: empty, hasMedia: false };
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
 * Busts the in-memory cache, resolves fresh media paths, updates the
 * in-memory cached snapshot, and persists to disk immediately.
 * This ensures the startup snapshot stays in sync without waiting for
 * the next restart.
 */
export async function notifyMediaUpdated(appId: string): Promise<void> {
  canonicalMediaCache.delete(appId);

  // Track this update for flush coordination
  trackPendingAppInfoUpdate();

  try {
    // Resolve fresh media paths for this app
    const { media, hasMedia } = await resolveMediaForSnapshot(appId);

    if (!cachedSnapshot) return;

    // Update library game entry — full media object copy
    for (const game of cachedSnapshot.library.games) {
      if (game.appId === appId) {
        const originalMedia = { ...game.media };
        game.media = media;
        // Compute media status after update
        await setMediaStatusOnGame(game, originalMedia);
        break;
      }
    }

    // Update sidebar entry
    for (const item of cachedSnapshot.sidebar.items) {
      if (item.appId === appId) {
        item.media.landscapePath = media.landscapePath;
        item.media.coverPath = media.coverPath;
        break;
      }
    }

    // Update mediaReadyAppIds
    if (hasMedia) {
      if (!cachedSnapshot.indexes.mediaReadyAppIds.includes(appId)) {
        cachedSnapshot.indexes.mediaReadyAppIds.push(appId);
      }
    } else {
      cachedSnapshot.indexes.mediaReadyAppIds = cachedSnapshot.indexes.mediaReadyAppIds.filter((id) => id !== appId);
    }

    // Persist updated snapshot to disk immediately
    try {
      await saveStartupSnapshot(cachedSnapshot);
      if (ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
        console.log("[BootSnapshot] snapshot written");
      }
    } catch {
      console.warn("[BootSnapshot] write after media update failed");
    }
  } finally {
    completePendingAppInfoUpdate();
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
  scheduleSnapshotWrite(games, appInfoMap, statsMap, 1500);
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

export type SnapshotGame = {
  appId: string;
  provider: string;
  title: string;
  installed: boolean;
  playable: boolean;
  source: string;
  installPath: string | null;
  media: SnapshotGameMedia;
  lastPlayed: number | null;
  playtime: number | null;
  cloudStatus: string | null;
  mediaStatus: MediaStatus | null;
  missingMedia: string[];
  lastMediaCheckAt: number | null;
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

  const canonicalReadCount = Object.keys(canonicalInfos).length;
  if (ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
    console.log(`[BootSnapshot] canonical appinfos read: ${canonicalReadCount} / ${allAppIds.length}`);
  }

  let readyCount = 0;
  let partialCount = 0;
  let missingCount = 0;
  let staleCount = 0;

  for (const game of snapshot.library.games) {
    if (!game.appId) continue;

    const media = game.media;
    const originalMedia = { ...media };
    const canonicalInfo = canonicalInfos[game.appId];
    const hasCanonical = !!canonicalInfo;

    debugAppLog(game.appId, `hydrate: hasCanonical=${hasCanonical}, snapshot media present: cover=${!!media.coverPath} landscape=${!!media.landscapePath} bg=${!!media.backgroundPath} logo=${!!media.logoPath} icon=${!!media.iconPath}`);

    // Get normalized media from canonical appinfo
    const normalizedMedia = hasCanonical ? normalizeAppInfoMedia(canonicalInfo) : null;

    const needsTitle = !game.title;
    const canRepairTitle = needsTitle && hasCanonical && !!canonicalInfo.name;

    let gameChanged = false;

    // Copy full validated media object from canonical appinfo into snapshot.
    // This ensures snapshot always reflects the latest canonical paths on boot.
    if (normalizedMedia) {
      const validated = await validateSnapshotMediaPaths(normalizedMedia);

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

export async function loadStartupSnapshot(): Promise<StartupSnapshot | null> {
  if (cachedSnapshot) return cachedSnapshot;
  try {
    const result = await invoke<StartupSnapshot | null>("read_startup_snapshot");
    if (result && result.version === SNAPSHOT_VERSION) {
      cachedSnapshot = result;
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

export async function saveStartupSnapshot(snapshot: StartupSnapshot): Promise<void> {
  cachedSnapshot = snapshot;
  try {
    await invoke("write_startup_snapshot", { snapshot });
  } catch {
    // non-critical
  }
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
    let hasMedia = false;

    if (hasCanonical) {
      const normalized = normalizeAppInfoMedia(canonicalInfo);
      if (normalized) {
        debugAppLog(game.appId, `canonical media: cover=${!!normalized.coverPath} landscape=${!!normalized.landscapePath} bg=${!!normalized.backgroundPath} logo=${!!normalized.logoPath} icon=${!!normalized.iconPath}`);
        const validated = await validateSnapshotMediaPaths(normalized);
        hasMedia = !!(validated.landscapePath || validated.coverPath || validated.backgroundPath || validated.logoPath || validated.iconPath);
        debugAppLog(game.appId, `validated media: hasMedia=${hasMedia} cover=${!!validated.coverPath} landscape=${!!validated.landscapePath}`);
        media = validated;
      } else {
        debugAppLog(game.appId, "normalizeAppInfoMedia returned null");
        media = { landscapePath: null, coverPath: null, backgroundPath: null, logoPath: null, iconPath: null };
      }
    } else {
      debugAppLog(game.appId, "no canonical appinfo, falling back to disk");
      // No canonical appinfo — fallback to physical media files
      try {
        const diskPaths = await resolveGameMediaPaths(game.appId);
        if (diskPaths) {
          const rawMedia: SnapshotGameMedia = {
            landscapePath: diskPaths.landscapePath ?? null,
            coverPath: diskPaths.coverPath ?? null,
            backgroundPath: diskPaths.backgroundPath ?? null,
            logoPath: diskPaths.logoPath ?? null,
            iconPath: diskPaths.iconPath ?? null,
          };
          const validated = await validateSnapshotMediaPaths(rawMedia);
          hasMedia = !!(validated.landscapePath || validated.coverPath || validated.backgroundPath || validated.logoPath || validated.iconPath);
          media = validated;
        } else {
          media = { landscapePath: null, coverPath: null, backgroundPath: null, logoPath: null, iconPath: null };
        }
      } catch {
        media = { landscapePath: null, coverPath: null, backgroundPath: null, logoPath: null, iconPath: null };
      }
    }

    const gameMedia: SnapshotGameMedia = {
      landscapePath: media.landscapePath,
      coverPath: media.coverPath,
      backgroundPath: media.backgroundPath,
      logoPath: media.logoPath,
      iconPath: media.iconPath,
    };
    // Compute media status from validated paths
    const validatedForStatus = await validateSnapshotMediaPaths(gameMedia);
    const { mediaStatus, missingMedia } = computeMediaStatus(gameMedia, validatedForStatus);

    snapshotGames.push({
      appId: game.appId,
      provider: "steam",
      title,
      installed: game.steamInstalled,
      playable: game.isPlayable,
      source: game.source,
      installPath: game.installDir || null,
      media: gameMedia,
      lastPlayed: game.steamLastPlayedAt != null ? Math.floor(game.steamLastPlayedAt / 1000) : null,
      playtime: game.steamPlaytimeMinutes ?? null,
      cloudStatus: game.steamCloudStatus ?? null,
      mediaStatus,
      missingMedia,
      lastMediaCheckAt: now,
    });

    if (hasMedia) {
      mediaReadyAppIds.push(game.appId);
    }

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

  if (ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
    console.log(`[BootSnapshot] mediaReadyAppIds count: ${mediaReadyAppIds.length}`);
    console.log(`[BootSnapshot] sidebar media populated`);
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
): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(async () => {
    try {
      const snapshot = await buildStartupSnapshotFromCurrentState(games, appInfoMap, statsMap);
      await saveStartupSnapshot(snapshot);
      if (ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS) {
        console.log("[BootSnapshot] snapshot written");
      }
    } catch {
      console.warn("[BootSnapshot] write failed");
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
  scheduleSnapshotWrite(games, appInfoMap, statsMap, 1500);
}

export function cancelScheduledSnapshotWrite(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
