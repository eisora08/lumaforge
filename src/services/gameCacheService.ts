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

// ---------------------------------------------------------------------------
// Debug log flags
// ---------------------------------------------------------------------------

const ENABLE_VERBOSE_GAME_CACHE_LOGS = false;

// ---------------------------------------------------------------------------
// Canonical game cache access
// ---------------------------------------------------------------------------

export async function loadGameAppInfo(appId: string): Promise<GameAppInfo | null> {
  return getGameAppInfo(appId);
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
  const paths: GameMediaPaths = { landscape_path: null, cover_path: null };

  // Download landscape
  try {
    paths.landscape_path = await cacheLandscapeImage(appId, landscapeUrls, false);
  } catch (err) {
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
      console.log(`[GameCache] landscape failed for ${appId}:`, err);
    }
  }

  // Download cover (optional — only if URLs provided)
  if (coverUrls) {
    try {
      paths.cover_path = await cacheCoverImage(appId, coverUrls, false);
    } catch (err) {
      if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
        console.log(`[GameCache] cover failed for ${appId}:`, err);
      }
    }
  }

  // Update canonical appinfo
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
      landscape: !!paths.landscape_path,
      cover: !!paths.cover_path,
    });
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Check if any media exists in the canonical cache
// ---------------------------------------------------------------------------

export function hasCanonicalMedia(appInfo: GameAppInfo | null): boolean {
  if (!appInfo?.media) return false;
  return !!(appInfo.media.landscape_path || appInfo.media.cover_path);
}

// ---------------------------------------------------------------------------
// Image priority helpers — return local file path (or null)
// ---------------------------------------------------------------------------

export function pickLandscapeImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return appInfo.media.landscape_path || appInfo.media.cover_path || null;
}

export function pickCoverImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return appInfo.media.cover_path || null;
}

export function pickHeroBackgroundImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return appInfo.media.landscape_path || null;
}

export function pickStoreImage(appInfo: GameAppInfo | null): string | null {
  if (!appInfo?.media) return null;
  return appInfo.media.landscape_path || appInfo.media.cover_path || null;
}

// ---------------------------------------------------------------------------
// Local path utility
// ---------------------------------------------------------------------------

export function isLocalPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/");
}

export function isHttpUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

export function localPathToUrl(path: string): string {
  if (isHttpUrl(path)) return path;
  try {
    return convertFileSrc(path, "asset");
  } catch {
    return path;
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
