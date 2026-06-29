import {
  getGameAppInfo,
  saveGameAppInfo,
  getStoreDetails,
  saveStoreDetails,
  getGameArtwork,
  saveGameArtwork,
  cacheLandscapeImage,
  cacheCoverImage,
  updateGameAppinfoMedia,
  updateGameArtwork,
  migrateToCanonicalCache,
  resolveGameMediaPaths,
  readGameMediaDataUrl,
} from "./tauri";
import { convertFileSrc } from "@tauri-apps/api/core";

import type {
  GameAppInfo,
  GameMediaPaths,
  GameStoreDetails,
  GameArtwork,
  SteamGridDbRef,
  LandscapeUrls,
  CoverUrls,
} from "./tauri";

export type {
  GameAppInfo,
  GameMediaPaths,
  GameStoreDetails,
  GameArtwork,
  SteamGridDbRef,
  LandscapeUrls,
  CoverUrls,
};

// Re-export for data URL fallback
export { readGameMediaDataUrl };

// ---------------------------------------------------------------------------
// Debug log flags
// ---------------------------------------------------------------------------

const ENABLE_VERBOSE_GAME_CACHE_LOGS = false;

// ---------------------------------------------------------------------------
// Session cache for resolved media paths (prevents repeated disk checks)
// ---------------------------------------------------------------------------

const resolvedMediaSessionCache = new Map<string, GameMediaPaths | null>();

function getCachedResolvedMedia(appId: string): GameMediaPaths | null | undefined {
  if (resolvedMediaSessionCache.has(appId)) {
    return resolvedMediaSessionCache.get(appId) ?? null;
  }
  return undefined; // not in cache
}

// ---------------------------------------------------------------------------
// Canonical game cache access
// ---------------------------------------------------------------------------

export async function loadGameAppInfo(appId: string): Promise<GameAppInfo | null> {
  return getGameAppInfo(appId);
}

// Like loadGameAppInfo, but if appinfo has null media paths, checks disk
// for existing landscape.jpg/cover.jpg files and writes them back to appinfo.
// Results are session-cached. Uses repairedAppInfoIds Set to avoid repeated repair.
export async function loadGameAppInfoWithMediaFallback(appId: string): Promise<GameAppInfo | null> {
  const cached = getCachedResolvedMedia(appId);
  if (cached !== undefined) {
    // Merge cached fallback paths into a fresh load of appinfo
    const appInfo = await getGameAppInfo(appId).catch(() => null);
    if (appInfo) {
      if (cached) {
        appInfo.media = cached;
      }
      return appInfo;
    }
    // appinfo.json doesn't exist yet (async write in-flight or never written),
    // but we have cached media paths from a previous disk check — return a
    // synthetic GameAppInfo so the caller sees the local media paths.
    if (cached) {
      return { appId, provider: "steam", name: null, updatedAt: null, media: cached, remote: null };
    }
    return null;
  }

  const appInfo = await getGameAppInfo(appId).catch(() => null);

  // If appinfo has media paths but they point to .tmp, treat as missing
  // and let the disk fallback repair them.
  const hasValidMedia = appInfo?.media && (
    (appInfo.media.landscapePath && !appInfo.media.landscapePath.endsWith(".tmp")) ||
    (appInfo.media.coverPath && !appInfo.media.coverPath.endsWith(".tmp"))
  );

  if (hasValidMedia) {
    resolvedMediaSessionCache.set(appId, appInfo.media);
    return appInfo;
  }

  // Fallback: check disk directly — but only if not already repaired this session
  if (!isAppInfoRepaired(appId)) {
    try {
      const diskPaths = await resolveGameMediaPaths(appId);
      if (diskPaths && (diskPaths.landscapePath || diskPaths.coverPath)) {
        resolvedMediaSessionCache.set(appId, diskPaths);
        markAppInfoRepaired(appId);
        const name = appInfo?.name ?? null;
        const remote = appInfo?.remote ?? null;
        // Only write if mediaPaths differ from current
        const currentMedia = appInfo?.media;
        const needsWrite = !currentMedia ||
          currentMedia.landscapePath !== diskPaths.landscapePath ||
          currentMedia.coverPath !== diskPaths.coverPath;
        if (needsWrite) {
          updateGameAppinfoMedia(appId, name, diskPaths, remote).catch(() => {});
        }
        if (appInfo) {
          appInfo.media = diskPaths;
          return appInfo;
        }
        return { appId, provider: "steam", name: null, updatedAt: null, media: diskPaths, remote: null };
      }
    } catch {
      // non-critical
    }
    // Mark as repaired even if no files found — prevents repeated disk checks
    markAppInfoRepaired(appId);
  }

  resolvedMediaSessionCache.set(appId, null);
  return appInfo;
}

// Clear the session cache (e.g. after artwork refresh)
export function clearResolvedMediaSessionCache(): void {
  resolvedMediaSessionCache.clear();
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
): Promise<GameMediaPaths> {
  const paths: GameMediaPaths = { landscapePath: null, coverPath: null };

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

  // Update canonical appinfo — populate both old-compat and new-canonical
  try {
    await updateGameAppinfoMedia(appId, name, paths, null);
  } catch {
    // non-critical
  }

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

export function pickLandscapeImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return filterTmp(appInfo.media.landscapePath) || filterTmp(appInfo.media.coverPath) || null;
}

export function pickCoverImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return filterTmp(appInfo.media.coverPath) || null;
}

export function pickHeroBackgroundImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return filterTmp(appInfo.media.landscapePath) || null;
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
  landscapeSrc?: string;
  coverSrc?: string;
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

  // --- Landscape priority ---
  // 1. appinfo.media.landscapePath (canonical new format)
  if (appinfo?.media?.landscapePath) {
    result.landscapeSrc = appinfo.media.landscapePath;
  }
  // 2. appinfo.landscapePath / landscape_path (backward compat)
  //    This is covered by #1 since serde reads both into landscapePath.
  // 3. Physical file check — handled by loadGameAppInfoWithMediaFallback
  // 4. Remote header_image already available
  else if (remoteHeader) {
    result.landscapeSrc = remoteHeader;
  }
  // 5. Physical cover.jpg fallback
  else if (appinfo?.media?.coverPath) {
    result.landscapeSrc = appinfo.media.coverPath;
  }
  // 6. Remote background fallback
  else if (remoteBackground) {
    result.landscapeSrc = remoteBackground;
  }
  // 7. Store capsule fallback
  else if (remoteCapsule) {
    result.landscapeSrc = remoteCapsule;
  }
  // 8. game.imageUrl fallback
  else if (game?.imageUrl) {
    result.landscapeSrc = game.imageUrl;
  }

  // --- Cover priority ---
  // 1. appinfo.media.coverPath
  if (appinfo?.media?.coverPath && appinfo.media.coverPath !== result.landscapeSrc) {
    result.coverSrc = appinfo.media.coverPath;
  }
  // 2. Physical cover (already in appinfo.media.coverPath from #1)
  // 3. Remote capsule image
  else if (remoteCapsule && remoteCapsule !== result.landscapeSrc) {
    result.coverSrc = remoteCapsule;
  }
  // 4. Landscape fallback only if no other option
  else if (!result.coverSrc && result.landscapeSrc) {
    result.coverSrc = result.landscapeSrc;
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
  try {
    return convertFileSrc(path, "asset");
  } catch {
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
      console.warn("[MediaCache] convertFileSrc failed for", path);
    }
    return null;
  }
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
