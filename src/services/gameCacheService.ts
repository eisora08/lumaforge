import {
  getGameAppInfo,
  saveGameAppInfo,
  getStoreDetails,
  saveStoreDetails,
  getGameArtwork,
  saveGameArtwork,
  cacheLandscapeImage,
  cacheCoverImage,
  cacheBackgroundImage,
  cacheLogoImage,
  cacheIconImage,
  updateGameAppinfoMedia,
  updateGameArtwork,
  migrateToCanonicalCache,
  resolveGameMediaPaths,
  readGameMediaDataUrl,
  repairAppinfoMediaPaths,
  repairMediaRoles,
} from "./tauri";
import { invalidateCanonicalMediaCache, notifyMediaUpdated } from "./startupSnapshotService";
import { convertFileSrc } from "@tauri-apps/api/core";

import type {
  GameAppInfo,
  GameMediaPaths,
  GameMediaPathsResult,
  GameStoreDetails,
  GameArtwork,
  SteamGridDbRef,
  LandscapeUrls,
  CoverUrls,
  BackgroundUrls,
  LogoUrls,
  IconUrls,
} from "./tauri";

export type {
  GameAppInfo,
  GameMediaPaths,
  GameMediaPathsResult,
  GameStoreDetails,
  GameArtwork,
  SteamGridDbRef,
  LandscapeUrls,
  CoverUrls,
  BackgroundUrls,
  LogoUrls,
  IconUrls,
};

// Re-export for data URL fallback
export { readGameMediaDataUrl };

// ---------------------------------------------------------------------------
// Debug log flags
// ---------------------------------------------------------------------------

const ENABLE_VERBOSE_GAME_CACHE_LOGS = true;
const ENABLE_VERBOSE_MEDIA_CACHE_LOGS = true;
const ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS = false; // Toggle for Part 4 debug logs

// ---------------------------------------------------------------------------
// Session cache for resolved media paths (prevents repeated disk checks)
// ---------------------------------------------------------------------------

const resolvedMediaSessionCache = new Map<string, GameMediaPaths | null>();

// Cache for converted src URLs (local path → asset:// URL)
// Prevents repeated convertFileSrc calls on the same path during a session
const resolvedSrcCache = new Map<string, string>();

function getCachedResolvedMedia(appId: string): GameMediaPaths | null | undefined {
  if (resolvedMediaSessionCache.has(appId)) {
    return resolvedMediaSessionCache.get(appId) ?? null;
  }
  return undefined; // not in cache
}

// Seed the session cache from a startup snapshot to avoid disk checks
// during initial render. Call this once during boot before any component
// tries to resolve media.
export function seedResolvedMediaCacheFromSnapshot(
  snapshotGames: Array<{ appId: string; media: { landscapePath: string | null; coverPath: string | null; backgroundPath: string | null; logoPath: string | null; iconPath: string | null } }>,
): void {
  for (const g of snapshotGames) {
    const media: GameMediaPaths = {
      landscapePath: g.media.landscapePath ?? null,
      coverPath: g.media.coverPath ?? null,
      backgroundPath: g.media.backgroundPath ?? null,
      logoPath: g.media.logoPath ?? null,
      iconPath: g.media.iconPath ?? null,
    };
    const hasAny = !!(media.landscapePath || media.coverPath || media.backgroundPath || media.logoPath || media.iconPath);
    resolvedMediaSessionCache.set(g.appId, hasAny ? media : null);
    // Mark as repaired so loadGameAppInfoWithMediaFallback skips the expensive path
    markAppInfoRepaired(g.appId);
  }
}

// ---------------------------------------------------------------------------
// Canonical game cache access
// ---------------------------------------------------------------------------

export async function loadGameAppInfo(appId: string): Promise<GameAppInfo | null> {
  return getGameAppInfo(appId);
}

// Load appinfo and validate all media paths against disk.
// Always does a disk check once per session per appId.
// Session-caches the validated paths so repeated calls are instant.
// Writes corrected appinfo.json when stale paths are detected.
export async function loadGameAppInfoWithMediaFallback(appId: string): Promise<GameAppInfo | null> {
  // Session cache hit — return appinfo with validated paths merged
  const cached = getCachedResolvedMedia(appId);
  if (cached !== undefined) {
    const appInfo = await getGameAppInfo(appId).catch(() => null);
    if (appInfo) {
      if (cached) {
        appInfo.media = cached;
      }
      return appInfo;
    }
    if (cached) {
      return { appId, provider: "steam", name: null, updatedAt: null, media: cached, remote: null };
    }
    return null;
  }

  // Read appinfo.json from disk
  let appInfo = await getGameAppInfo(appId).catch(() => null);

  // Validate all paths against disk (once per session)
  if (!isAppInfoRepaired(appId)) {
    try {
      // First, fix any misclassified media files (e.g. vertical landscape.jpg)
      // so the file names match actual image orientation before scanning disk paths.
      await repairMediaRoles(appId).catch(() => {});
      // Then repair stale paths AND add disk-only paths in appinfo.json
      // This updates appinfo on disk. We re-read appInfo afterward.
      await repairAppinfoMediaPaths(appId).catch(() => {});

      // Re-read appinfo after repair (it may have been updated with disk paths)
      const repairedAppInfo = await getGameAppInfo(appId).catch(() => null);
      if (repairedAppInfo) {
        appInfo = repairedAppInfo;
      }

      const diskPaths = await resolveGameMediaPaths(appId);
      markAppInfoRepaired(appId);

      if (diskPaths) {
        const hasDiskFiles = !!(diskPaths.landscapePath || diskPaths.coverPath || diskPaths.backgroundPath || diskPaths.logoPath || diskPaths.iconPath);
        const hasAppInfoMedia = !!(appInfo?.media?.landscapePath || appInfo?.media?.coverPath || appInfo?.media?.backgroundPath || appInfo?.media?.logoPath || appInfo?.media?.iconPath);

        // Merge: disk paths override appinfo paths
        const validatedMedia: GameMediaPaths = {
          landscapePath: diskPaths.landscapePath ?? appInfo?.media?.landscapePath ?? null,
          coverPath: diskPaths.coverPath ?? appInfo?.media?.coverPath ?? null,
          backgroundPath: diskPaths.backgroundPath ?? appInfo?.media?.backgroundPath ?? null,
          logoPath: diskPaths.logoPath ?? appInfo?.media?.logoPath ?? null,
          iconPath: diskPaths.iconPath ?? appInfo?.media?.iconPath ?? null,
        };

        if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
          console.log(`[MediaResolve] ${appId} existing files`, {
            cover: !!diskPaths.coverPath,
            landscape: !!diskPaths.landscapePath,
            background: !!diskPaths.backgroundPath,
            logo: !!diskPaths.logoPath,
            icon: !!diskPaths.iconPath,
          });
        }

        // Detect stale paths in appinfo
        const hasStalePaths = hasAppInfoMedia && (
          (appInfo?.media?.landscapePath && !diskPaths.landscapePath) ||
          (appInfo?.media?.coverPath && !diskPaths.coverPath) ||
          (appInfo?.media?.backgroundPath && !diskPaths.backgroundPath) ||
          (appInfo?.media?.logoPath && !diskPaths.logoPath) ||
          (appInfo?.media?.iconPath && !diskPaths.iconPath)
        );

        // Write corrected appinfo if stale paths detected or new files found
        if (hasDiskFiles && (hasStalePaths || !hasAppInfoMedia)) {
          const name = appInfo?.name ?? null;
          const remote = appInfo?.remote ?? null;
          const currentMedia = appInfo?.media;
          const needsWrite = !currentMedia ||
            currentMedia.landscapePath !== validatedMedia.landscapePath ||
            currentMedia.coverPath !== validatedMedia.coverPath ||
            currentMedia.backgroundPath !== validatedMedia.backgroundPath ||
            currentMedia.logoPath !== validatedMedia.logoPath ||
            currentMedia.iconPath !== validatedMedia.iconPath;
          if (needsWrite) {
            if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
              console.log(`[MediaCache] appinfo updated for ${appId}`);
            }
            updateGameAppinfoMedia(appId, name, validatedMedia, remote).catch(() => {});
            // Notify snapshot service so it picks up the repaired paths
            invalidateCanonicalMediaCache(appId);
            notifyMediaUpdated(appId).catch(() => {});
          }
        }

        resolvedMediaSessionCache.set(appId, validatedMedia);
        if (appInfo) {
          appInfo.media = validatedMedia;
          return appInfo;
        }
        const fallbackName = (appInfo as GameAppInfo | null)?.name ?? null;
        if (hasDiskFiles) {
          return { appId, provider: "steam", name: fallbackName, updatedAt: null, media: validatedMedia, remote: null };
        }
      }
    } catch {
      // non-critical — disk check failed, fall through to appinfo
    }
  }

  // No disk files found — use appinfo as-is (might be stale, but pickers will filter)
  const fallbackMedia = appInfo?.media ?? null;
  resolvedMediaSessionCache.set(appId, fallbackMedia);
  return appInfo ?? null;
}

// Clear the session cache (e.g. after artwork refresh)
export function clearResolvedMediaSessionCache(): void {
  resolvedMediaSessionCache.clear();
  resolvedSrcCache.clear();
}

// Invalidate cache for a specific appId (e.g. after a media download updates appinfo)
export function invalidateResolvedMediaCache(appId: string): void {
  resolvedMediaSessionCache.delete(appId);
}

// ---------------------------------------------------------------------------
// repairedAppInfoIds Set — prevents repeated appinfo repair per appId per session
// ---------------------------------------------------------------------------

const repairedAppInfoIds = new Set<string>();

export function markAppInfoRepaired(appId: string): void {
  repairedAppInfoIds.add(appId);
}

export function isAppInfoRepaired(appId: string): boolean {
  return repairedAppInfoIds.has(appId);
}

export function resetRepairedAppInfoIds(): void {
  repairedAppInfoIds.clear();
}

export async function persistGameAppInfo(appId: string, entry: GameAppInfo): Promise<void> {
  await saveGameAppInfo(appId, entry);
}

export async function loadStoreDetails(appId: string): Promise<GameStoreDetails | null> {
  return getStoreDetails(appId);
}

export async function persistStoreDetails(appId: string, entry: GameStoreDetails): Promise<void> {
  await saveStoreDetails(appId, entry);
}

export async function loadGameArtwork(appId: string): Promise<GameArtwork | null> {
  return getGameArtwork(appId);
}

export async function persistGameArtwork(appId: string, entry: GameArtwork): Promise<void> {
  await saveGameArtwork(appId, entry);
}

// ---------------------------------------------------------------------------
// Cache landscape image with source priority
// ---------------------------------------------------------------------------

export async function cacheLandscapeForGame(
  appId: string,
  urls: LandscapeUrls,
  forceRefresh?: boolean,
): Promise<string | null> {
  if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
    console.log(`[GameCache] caching landscape for ${appId}`, urls);
  }
  return await cacheLandscapeImage(appId, urls, forceRefresh);
}

// ---------------------------------------------------------------------------
// Cache cover image with source priority
// ---------------------------------------------------------------------------

export async function cacheCoverForGame(
  appId: string,
  urls: CoverUrls,
  forceRefresh?: boolean,
): Promise<string | null> {
  if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
    console.log(`[GameCache] caching cover for ${appId}`, urls);
  }
  return await cacheCoverImage(appId, urls, forceRefresh);
}

// ---------------------------------------------------------------------------
// Cache both landscape + cover + update appinfo
// ---------------------------------------------------------------------------

export async function cacheMediaForGame(
  appId: string,
  name: string | null,
  landscapeUrls: LandscapeUrls,
  coverUrls: CoverUrls | null,
  sgdbRef?: SteamGridDbRef | null,
  backgroundUrls?: BackgroundUrls | null,
  logoUrls?: LogoUrls | null,
  iconUrls?: IconUrls | null,
): Promise<GameMediaPaths> {
  const paths: GameMediaPaths = { landscapePath: null, coverPath: null, backgroundPath: null, logoPath: null, iconPath: null };

  // Download landscape
  try {
    paths.landscapePath = await cacheLandscapeImage(appId, landscapeUrls, false);
  } catch (err) {
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
      console.log(`[GameCache] landscape failed for ${appId}:`, err);
    }
  }

  // Download cover (optional — only if URLs provided)
  if (coverUrls) {
    try {
      paths.coverPath = await cacheCoverImage(appId, coverUrls, false);
    } catch (err) {
      if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
        console.log(`[GameCache] cover failed for ${appId}:`, err);
      }
    }
  }

  // Download background (optional)
  if (backgroundUrls) {
    try {
      paths.backgroundPath = await cacheBackgroundImage(appId, backgroundUrls, false);
    } catch (err) {
      if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
        console.log(`[GameCache] background failed for ${appId}:`, err);
      }
    }
  }

  // Download logo (optional)
  if (logoUrls) {
    try {
      paths.logoPath = await cacheLogoImage(appId, logoUrls, false);
    } catch (err) {
      if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
        console.log(`[GameCache] logo failed for ${appId}:`, err);
      }
    }
  }

  // Download icon (optional)
  if (iconUrls) {
    try {
      paths.iconPath = await cacheIconImage(appId, iconUrls, false);
    } catch (err) {
      if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
        console.log(`[GameCache] icon failed for ${appId}:`, err);
      }
    }
  }

  // Update canonical appinfo (merge with existing)
  try {
    await updateGameAppinfoMedia(appId, name, paths, null);
  } catch {
    // non-critical
  }

  // Invalidate session cache to force re-read on next access
  invalidateResolvedMediaCache(appId);

  // Notify snapshot service so startup-snapshot.json picks up new paths
  invalidateCanonicalMediaCache(appId);
  notifyMediaUpdated(appId).catch(() => {});

  // Update artwork.json
  if (sgdbRef) {
    try {
      await updateGameArtwork(appId, sgdbRef, paths);
    } catch {
      // non-critical
    }
  }

  if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
    console.log(`[GameCache] media cached for ${appId}:`, {
      landscape: !!paths.landscapePath,
      cover: !!paths.coverPath,
      background: !!paths.backgroundPath,
      logo: !!paths.logoPath,
      icon: !!paths.iconPath,
    });
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Check if any media exists in the canonical cache
// ---------------------------------------------------------------------------

export function hasCanonicalMedia(appInfo: GameAppInfo | null): boolean {
  if (!appInfo?.media) return false;
  return !!(appInfo.media.landscapePath || appInfo.media.coverPath);
}

// ---------------------------------------------------------------------------
// .tmp file guard — never pass temp files to the UI
// ---------------------------------------------------------------------------

function isTmpPath(path: string | null | undefined): boolean {
  if (!path) return true;
  return path.endsWith(".tmp");
}

function filterTmp(path: string | null | undefined): string | null {
  if (!path) return null;
  if (isTmpPath(path)) {
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
      console.log(`[MediaCache] ignored tmp path — ${path}`);
    }
    return null;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Image priority helpers — return local file path (or null)
// Never return .tmp paths to AsyncImage.
// ---------------------------------------------------------------------------

export function pickCoverImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return filterTmp(appInfo.media.coverPath)
    || filterTmp(appInfo.media.landscapePath)
    || filterTmp(appInfo.media.backgroundPath)
    || null;
}

export function pickBackgroundImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return filterTmp(appInfo.media.backgroundPath)
    || filterTmp(appInfo.media.landscapePath)
    || filterTmp(appInfo.media.coverPath)
    || null;
}

export function pickLogoImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return filterTmp(appInfo.media.logoPath) || null;
}

export function pickIconImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return filterTmp(appInfo.media.iconPath)
    || filterTmp(appInfo.media.coverPath)
    || null;
}

export function pickLandscapeImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return filterTmp(appInfo.media.landscapePath)
    || filterTmp(appInfo.media.backgroundPath)
    || filterTmp(appInfo.media.coverPath)
    || null;
}

export function pickStoreImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return filterTmp(appInfo.media.landscapePath) || filterTmp(appInfo.media.coverPath) || null;
}

// ---------------------------------------------------------------------------
// resolveGameMedia — centralized media resolver with proper priority
// Returns resolved paths WITHOUT triggering downloads.
// ---------------------------------------------------------------------------

export type ResolvedGameMedia = {
  coverSrc?: string;
  backgroundSrc?: string;
  logoSrc?: string;
  iconSrc?: string;
  landscapeSrc?: string;
};

export async function resolveGameMedia(
  _appId: string,
  game?: { imageUrl?: string; metadata?: Record<string, any>; headerImage?: string },
  appinfo?: GameAppInfo | null,
): Promise<ResolvedGameMedia> {
  const result: ResolvedGameMedia = {};

  const meta = game?.metadata || {};
  const remoteHeader = game?.headerImage || meta?.header_image;
  const remoteBackground = meta?.background_image || meta?.library_hero_image || meta?.hero_image;
  const remoteCapsule = meta?.capsule_image || meta?.capsule_image_v5;

  // --- Cover priority (poster/card) ---
  if (appinfo?.media?.coverPath) {
    result.coverSrc = appinfo.media.coverPath;
  } else if (appinfo?.media?.landscapePath) {
    result.coverSrc = appinfo.media.landscapePath;
  } else if (remoteCapsule) {
    result.coverSrc = remoteCapsule;
  } else if (remoteHeader) {
    result.coverSrc = remoteHeader;
  } else if (game?.imageUrl) {
    result.coverSrc = game.imageUrl;
  }

  // --- Background priority (hero/details) ---
  if (appinfo?.media?.backgroundPath) {
    result.backgroundSrc = appinfo.media.backgroundPath;
  } else if (appinfo?.media?.landscapePath) {
    result.backgroundSrc = appinfo.media.landscapePath;
  } else if (remoteBackground) {
    result.backgroundSrc = remoteBackground;
  } else if (remoteHeader) {
    result.backgroundSrc = remoteHeader;
  } else if (appinfo?.media?.coverPath) {
    result.backgroundSrc = appinfo.media.coverPath;
  }

  // --- Logo priority ---
  if (appinfo?.media?.logoPath) {
    result.logoSrc = appinfo.media.logoPath;
  }

  // --- Icon priority ---
  if (appinfo?.media?.iconPath) {
    result.iconSrc = appinfo.media.iconPath;
  } else if (appinfo?.media?.coverPath) {
    result.iconSrc = appinfo.media.coverPath;
  }

  // --- Landscape ---
  if (appinfo?.media?.landscapePath) {
    result.landscapeSrc = appinfo.media.landscapePath;
  } else if (appinfo?.media?.backgroundPath) {
    result.landscapeSrc = appinfo.media.backgroundPath;
  } else if (remoteHeader) {
    result.landscapeSrc = remoteHeader;
  } else if (appinfo?.media?.coverPath) {
    result.landscapeSrc = appinfo.media.coverPath;
  } else if (remoteBackground) {
    result.landscapeSrc = remoteBackground;
  } else if (remoteCapsule) {
    result.landscapeSrc = remoteCapsule;
  } else if (game?.imageUrl) {
    result.landscapeSrc = game.imageUrl;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Sidebar-specific media resolver with file existence tracking
// ---------------------------------------------------------------------------

export type MediaItemInfo = {
  src: string | null;
  localPath: string | null;
  exists: boolean;
};

export type ResolvedSidebarMedia = {
  landscape: MediaItemInfo;
  cover: MediaItemInfo;
  background: MediaItemInfo;
  logo: MediaItemInfo;
  icon: MediaItemInfo;
};

// Resolve sidebar media with optional snapshot paths.
// When snapshotMedia is provided, disk check is skipped entirely.
export async function resolveSidebarMedia(
  appId: string,
  appInfo?: GameAppInfo | null,
  snapshotMedia?: GameMediaPaths | null,
): Promise<ResolvedSidebarMedia> {
  if (snapshotMedia) {
    return resolveSidebarMediaFromPaths(appId, appInfo, snapshotMedia);
  }
  return resolveSidebarMediaWithDiskCheck(appId, appInfo);
}

// Fast path: use snapshot/cached paths without any disk I/O
function resolveSidebarMediaFromPaths(
  _appId: string,
  appInfo?: GameAppInfo | null,
  snapshotMedia?: GameMediaPaths | null,
): ResolvedSidebarMedia {
  const resolveRole = (
    path: string | null | undefined,
  ): MediaItemInfo => {
    if (path && !isTmpPath(path)) {
      return { src: localPathToUrl(path), localPath: path, exists: true };
    }
    return { src: null, localPath: null, exists: false };
  };

  const getPath = (role: keyof GameMediaPaths): string | null | undefined => {
    // Priority: snapshot > appinfo > null
    if (snapshotMedia && snapshotMedia[role]) return snapshotMedia[role];
    if (appInfo?.media && appInfo.media[role]) return appInfo.media[role];
    return null;
  };

  return {
    landscape: resolveRole(getPath("landscapePath")),
    cover: resolveRole(getPath("coverPath")),
    background: resolveRole(getPath("backgroundPath")),
    logo: resolveRole(getPath("logoPath")),
    icon: resolveRole(getPath("iconPath")),
  };
}

// Slow path: disk check fallback
async function resolveSidebarMediaWithDiskCheck(
  appId: string,
  appInfo?: GameAppInfo | null,
): Promise<ResolvedSidebarMedia> {
  const diskPaths = await resolveGameMediaPaths(appId).catch(() => null);

  const resolveRole = (
    appinfoPath: string | null | undefined,
    diskPath: string | null | undefined,
  ): MediaItemInfo => {
    let src: string | null = null;
    let localPath: string | null = null;
    let exists = false;

    // Priority 1: appinfo path (not .tmp)
    if (appinfoPath && !isTmpPath(appinfoPath)) {
      src = localPathToUrl(appinfoPath);
      localPath = appinfoPath;
      exists = true;
    }
    // Priority 2: disk file if appinfo path missing or was .tmp
    if (!exists && diskPath && !isTmpPath(diskPath)) {
      src = localPathToUrl(diskPath);
      localPath = diskPath;
      exists = true;
    }

    return { src, localPath, exists };
  };

  const result: ResolvedSidebarMedia = {
    landscape: resolveRole(appInfo?.media?.landscapePath, diskPaths?.landscapePath),
    cover: resolveRole(appInfo?.media?.coverPath, diskPaths?.coverPath),
    background: resolveRole(appInfo?.media?.backgroundPath, diskPaths?.backgroundPath),
    logo: resolveRole(appInfo?.media?.logoPath, diskPaths?.logoPath),
    icon: resolveRole(appInfo?.media?.iconPath, diskPaths?.iconPath),
  };

  if (ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS) {
    console.log(`[SidebarMedia] resolved for ${appId}`, {
      landscape: { exists: result.landscape.exists, prefix: result.landscape.src?.slice(0, 40) },
      cover: { exists: result.cover.exists, prefix: result.cover.src?.slice(0, 40) },
    });
  }

  return result;
}

export function isLocalPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/");
}

export function isHttpUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

export function localPathToUrl(path: string): string | null {
  if (isHttpUrl(path)) return path;
  if (path.endsWith(".tmp")) {
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
      console.log("[MediaCache] ignored tmp path in localPathToUrl —", path);
    }
    return null;
  }
  const cached = resolvedSrcCache.get(path);
  if (cached !== undefined) return cached;
  try {
    const url = convertFileSrc(path, "asset");
    resolvedSrcCache.set(path, url);
    return url;
  } catch {
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
      console.warn("[MediaCache] convertFileSrc failed for", path);
    }
    return null;
  }
}

export function clearResolvedSrcCache(): void {
  resolvedSrcCache.clear();
}

// ---------------------------------------------------------------------------
// Batch media resolution — loads multiple appIds at once, returns a map
// Batching avoids repeated individual disk checks per card render.
// ---------------------------------------------------------------------------

export async function batchLoadGameMedia(
  appIds: string[],
): Promise<Record<string, GameAppInfo | null>> {
  const results: Record<string, GameAppInfo | null> = {};
  const batchSize = 20;
  for (let i = 0; i < appIds.length; i += batchSize) {
    const batch = appIds.slice(i, i + batchSize);
    const entries = await Promise.all(
      batch.map(async (appId) => {
        try {
          const info = await loadGameAppInfoWithMediaFallback(appId);
          return [appId, info] as const;
        } catch {
          return [appId, null] as const;
        }
      })
    );
    for (const [appId, info] of entries) {
      results[appId] = info;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export async function runMigration(): Promise<void> {
  if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
    console.log("[GameCache] running migration to canonical cache...");
  }
  const result = await migrateToCanonicalCache();
  if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
    console.log("[GameCache] migration complete:", result);
  }
}
