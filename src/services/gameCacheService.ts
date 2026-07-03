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
  writeMediaManifest as writeMediaManifestTauri,
  getMediaManifestsBatch,
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
  MediaManifest,
  MediaManifestFiles,
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
// MediaIndex — formal runtime media entry
// *Path fields are relative (from appinfo)
// *Url fields are runtime-only (never persisted)
// has* flags are derived from path existence
// ---------------------------------------------------------------------------

export type MediaIndexEntry = {
  provider: string;
  appId: string;
  coverPath: string | null;
  coverUrl: string | null;
  hasCover: boolean;
  landscapePath: string | null;
  landscapeUrl: string | null;
  hasLandscape: boolean;
  backgroundPath: string | null;
  backgroundUrl: string | null;
  hasBackground: boolean;
  logoPath: string | null;
  logoUrl: string | null;
  hasLogo: boolean;
  iconPath: string | null;
  iconUrl: string | null;
  hasIcon: boolean;
  updatedAt: number;
};

const mediaIndexStore = new Map<string, MediaIndexEntry>();

export function getMediaEntry(appId: string, provider = "steam"): MediaIndexEntry | undefined {
  return mediaIndexStore.get(`${provider}:${appId}`);
}

export function setMediaEntry(entry: MediaIndexEntry): void {
  const key = `${entry.provider}:${entry.appId}`;
  mediaIndexStore.set(key, entry);
}

export function getAllMediaEntries(): MediaIndexEntry[] {
  return Array.from(mediaIndexStore.values());
}

export function seedMediaIndexFromManifests(
  manifests: Record<string, MediaManifest>,
  resolved: Record<string, { coverUrl: string | null; landscapeUrl: string | null; backgroundUrl: string | null; logoUrl: string | null; iconUrl: string | null }>,
): void {
  let count = 0;
  for (const [appId, manifest] of Object.entries(manifests)) {
    const urls = resolved[appId];
    if (!urls) continue;
    const entry: MediaIndexEntry = {
      provider: manifest.provider,
      appId: manifest.appid,
      coverPath: manifest.files.cover.exists ? manifest.files.cover.path : null,
      coverUrl: manifest.files.cover.exists ? (urls.coverUrl ?? null) : null,
      hasCover: manifest.files.cover.exists,
      landscapePath: manifest.files.landscape.exists ? manifest.files.landscape.path : null,
      landscapeUrl: manifest.files.landscape.exists ? (urls.landscapeUrl ?? null) : null,
      hasLandscape: manifest.files.landscape.exists,
      backgroundPath: manifest.files.background.exists ? manifest.files.background.path : null,
      backgroundUrl: manifest.files.background.exists ? (urls.backgroundUrl ?? null) : null,
      hasBackground: manifest.files.background.exists,
      logoPath: manifest.files.logo.exists ? manifest.files.logo.path : null,
      logoUrl: manifest.files.logo.exists ? (urls.logoUrl ?? null) : null,
      hasLogo: manifest.files.logo.exists,
      iconPath: manifest.files.icon.exists ? manifest.files.icon.path : null,
      iconUrl: manifest.files.icon.exists ? (urls.iconUrl ?? null) : null,
      hasIcon: manifest.files.icon.exists,
      updatedAt: manifest.updatedAt,
    };
    setMediaEntry(entry);
    count++;
  }
}

// ---------------------------------------------------------------------------
// Debug log flags
// ---------------------------------------------------------------------------

const ENABLE_VERBOSE_GAME_CACHE_LOGS = false;
const ENABLE_VERBOSE_MEDIA_CACHE_LOGS = false;
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

// ---------------------------------------------------------------------------
// Title helpers — resolve display titles with canonical fallback
// ---------------------------------------------------------------------------

export function isPlaceholderSteamTitle(title: string | null | undefined, _appId: string): boolean {
  if (!title) return true;
  return /^Steam App \d+$/.test(title);
}

export function resolveCanonicalDisplayTitle(
  appId: string,
  game?: { title?: string; metadata?: { name?: string } } | null,
  appInfoEntry?: { name?: string | null } | null,
  canonicalInfo?: { name?: string | null } | null,
): string {
  // All sources are filtered through isPlaceholderSteamTitle so that
  // fallback metadata names like "Steam App 12345" never leak through.
  const canonName = canonicalInfo?.name && !isPlaceholderSteamTitle(canonicalInfo.name, appId) ? canonicalInfo.name : null;
  const appInfoName = appInfoEntry?.name && !isPlaceholderSteamTitle(appInfoEntry.name, appId) ? appInfoEntry.name : null;
  const metaName = game?.metadata?.name && !isPlaceholderSteamTitle(game.metadata.name, appId) ? game.metadata.name : null;
  const gameTitle = game?.title && !isPlaceholderSteamTitle(game.title, appId) ? game.title : null;
  return canonName || appInfoName || metaName || gameTitle || `Steam App ${appId}`;
}

// ---------------------------------------------------------------------------
// Resolve titles for dashboard sections: batch-load canonical appinfos,
// then resolve each game's display title with full fallback chain.
// For games where canonical name is null/placeholder, attempts to fill
// the name from metadata resolver / store details and writes back.
// Returns a Record<appId, { title: string; source: string }>.
export async function resolveDashboardTitles(
  games: Array<{ appId: string; title?: string }>,
): Promise<Record<string, { title: string; source: string }>> {
  const result: Record<string, { title: string; source: string }> = {};
  const ids = games.map(g => g.appId).filter(Boolean);
  if (ids.length === 0) return result;

  const { readCanonicalAppinfos } = await import("./tauri");
  const canonicalInfos = await readCanonicalAppinfos(ids).catch(() => ({} as Record<string, any>));

  for (const game of games) {
    if (!game.appId) continue;
    let ci = canonicalInfos[game.appId] ?? null;
    const placeholderCi = !ci?.name || isPlaceholderSteamTitle(ci?.name, game.appId);

    // If canonical appinfo has no real name, try filling from metadata/store
    if (placeholderCi) {
      const filled = await fillCanonicalName(game.appId);
      if (filled) {
        ci = { appId: game.appId, provider: "steam", name: filled, updatedAt: null, media: null, mediaSources: null, remote: null };
      }
    }

    const title = resolveCanonicalDisplayTitle(game.appId, game as any, null, ci);

    // Determine winning source
    if (ci?.name && !isPlaceholderSteamTitle(ci.name, game.appId)) {
      result[game.appId] = { title, source: "canonical" };
    } else if ((game as any)?.metadata?.name && !isPlaceholderSteamTitle((game as any)?.metadata?.name, game.appId)) {
      result[game.appId] = { title, source: "metadata" };
    } else if (game.title && !isPlaceholderSteamTitle(game.title, game.appId)) {
      result[game.appId] = { title, source: "snapshot" };
    } else {
      result[game.appId] = { title, source: "fallback" };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fill canonical appinfo name from metadata resolver or store details,
// writing back to disk so subsequent reads get the real name.
// Returns the resolved name (or null if unresolvable).
// ---------------------------------------------------------------------------
// Resolve canonical name for a game, trying local sources in order:
// 1. canonical appinfo (appinfo.json on disk)
// 2. metadata cache (resolveGameMetadata — disk cache, no network)
// 3. store details (getStoreDetails — may have cached network data)
// Writes the resolved name to canonical appinfo for persistence.
// Safe to call from async contexts (not render).
export async function resolveCanonicalName(appId: string): Promise<string | null> {
  const appInfo = await getGameAppInfo(appId).catch(() => null);
  if (appInfo?.name && !isPlaceholderSteamTitle(appInfo.name, appId)) {
    return appInfo.name;
  }
  return fillCanonicalName(appId);
}

async function fillCanonicalName(appId: string): Promise<string | null> {
  const { resolveGameMetadata } = await import("./gameMetadataResolver");
  const appInfo = await getGameAppInfo(appId).catch(() => null);
  if (appInfo?.name && !isPlaceholderSteamTitle(appInfo.name, appId)) {
    return appInfo.name;
  }
  const appIdNum = Number(appId);
  let resolvedName: string | null = null;
  let source = "";
  if (!isNaN(appIdNum)) {
    const meta: Record<number, import("../types/gameMetadata").SteamAppMetadata> = await resolveGameMetadata([appIdNum]).catch(() => ({} as Record<number, import("../types/gameMetadata").SteamAppMetadata>));
    const m = meta[appIdNum];
    if (m?.name && !isPlaceholderSteamTitle(m.name, appId)) {
      resolvedName = m.name;
      source = "metadata";
    }
  }
  if (!resolvedName) {
    const sd = await getStoreDetails(appId).catch(() => null);
    const sdData = sd?.data as { name?: string } | null;
    if (sdData?.name && !isPlaceholderSteamTitle(sdData.name, appId)) {
      resolvedName = sdData.name;
      source = "store-details";
    }
  }
  if (resolvedName) {
    console.log(`[NAME][CANONICAL_WRITE] appid=${appId} name=${resolvedName} source=${source}`);
    updateGameAppinfoMedia(
      appId, resolvedName,
      { coverPath: null, backgroundPath: null, logoPath: null, iconPath: null, landscapePath: null },
      null,
    ).catch(() => {});
    return resolvedName;
  }
  return null;
}

// ---------------------------------------------------------------------------
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
    const hasKeyMedia = !!(media.landscapePath) && !!(media.coverPath || media.backgroundPath);
    if (hasKeyMedia) {
      markAppInfoRepaired(g.appId);
    }
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
  // Session cache hit — return appinfo with validated paths merged.
  // If cache has insufficient media (missing background/logo/icon), fall through to repair.
  const cached = getCachedResolvedMedia(appId);
  if (cached !== undefined) {
    if (cached && !(cached.backgroundPath || cached.logoPath || cached.iconPath)) {
      resolvedMediaSessionCache.delete(appId);
    } else {
      const appInfo = await getGameAppInfo(appId).catch(() => null);
      if (appInfo) {
        if (cached) {
          appInfo.media = cached;
        }
        // Resolve relative paths to absolute — cached paths from snapshot seeding
        // may be "media/landscape.jpg" which consumers cannot use as asset URLs.
        const hasRelative = cached && Object.values(cached).some(
          (v) => typeof v === 'string' && (v.startsWith('media/') || v.startsWith('img/'))
        );
        if (hasRelative) {
          const resolved = await resolveMediaPaths(appId, cached);
          if (resolved) {
            appInfo.media = resolved;
            resolvedMediaSessionCache.set(appId, resolved);
          }
        }
        return appInfo;
      }
      if (cached) {
        const hasRelative = Object.values(cached).some(
          (v) => typeof v === 'string' && (v.startsWith('media/') || v.startsWith('img/'))
        );
        if (hasRelative) {
          const resolved = await resolveMediaPaths(appId, cached);
          if (resolved) {
            resolvedMediaSessionCache.set(appId, resolved);
            return { appId, provider: "steam", name: null, updatedAt: null, media: resolved, mediaSources: null, remote: null };
          }
        }
        return { appId, provider: "steam", name: null, updatedAt: null, media: cached, mediaSources: null, remote: null };
      }
      return null;
    }
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

        // Convert absolute disk path to relative (media/<filename>)
        const absToRel = (abs: string | null): string | null => {
          if (!abs) return null;
          const parts = abs.replace(/\\/g, '/').split('/');
          const filename = parts[parts.length - 1];
          return filename ? `media/${filename}` : null;
        };

        // Build relative-only validatedMedia: prefer appinfo paths (already relative),
        // fall back to deriving relative from disk absolute paths.
        const appinfoMedia = appInfo?.media;
        const validatedMedia: GameMediaPaths = {
          landscapePath: appinfoMedia?.landscapePath ?? absToRel(diskPaths.landscapePath) ?? null,
          coverPath: appinfoMedia?.coverPath ?? absToRel(diskPaths.coverPath) ?? null,
          backgroundPath: appinfoMedia?.backgroundPath ?? absToRel(diskPaths.backgroundPath) ?? null,
          logoPath: appinfoMedia?.logoPath ?? absToRel(diskPaths.logoPath) ?? null,
          iconPath: appinfoMedia?.iconPath ?? absToRel(diskPaths.iconPath) ?? null,
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

        // Detect stale paths in appinfo (relative path points to file that no longer exists)
        const hasStalePaths = hasAppInfoMedia && (
          (appinfoMedia?.landscapePath && !diskPaths.landscapePath) ||
          (appinfoMedia?.coverPath && !diskPaths.coverPath) ||
          (appinfoMedia?.backgroundPath && !diskPaths.backgroundPath) ||
          (appinfoMedia?.logoPath && !diskPaths.logoPath) ||
          (appinfoMedia?.iconPath && !diskPaths.iconPath)
        );

        // Write corrected appinfo if stale paths detected or new files found
        if (hasDiskFiles && (hasStalePaths || !hasAppInfoMedia)) {
          const name = appInfo?.name ?? null;
          const remote = appInfo?.remote ?? null;
          const currentMedia = appinfoMedia;
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
            const mediaSources = appInfo?.mediaSources ?? null;
            updateGameAppinfoMedia(appId, name, validatedMedia, remote, mediaSources).catch(() => {});
            invalidateCanonicalMediaCache(appId);
            notifyMediaUpdated(appId).catch(() => {});
          }
        }

        // Resolve relative paths to absolute for the session cache (UI uses these)
        const resolvedForCache = await resolveMediaPaths(appId, validatedMedia);
        resolvedMediaSessionCache.set(appId, resolvedForCache);
        if (appInfo) {
          appInfo.media = resolvedForCache;
          return appInfo;
        }
        const fallbackName = (appInfo as GameAppInfo | null)?.name ?? null;
        if (hasDiskFiles) {
          return { appId, provider: "steam", name: fallbackName, updatedAt: null, media: resolvedForCache, mediaSources: null, remote: null };
        }
      }
    } catch {
      // non-critical — disk check failed, fall through to appinfo
    }
  }

  // After repair (or when repair was already done this session), re-check disk
  // for new background/logo/icon files that the cached appinfo may be missing.
  // This fixes the case where media files appeared on disk after the last repair.
  if (appInfo?.media && (!appInfo.media.backgroundPath || !appInfo.media.logoPath || !appInfo.media.iconPath)) {
    try {
      const diskPaths = await resolveGameMediaPaths(appId);
      if (diskPaths) {
        const absToRel = (abs: string | null): string | null => {
          if (!abs) return null;
          const parts = abs.replace(/\\/g, '/').split('/');
          const filename = parts[parts.length - 1];
          return filename ? `media/${filename}` : null;
        };

        const newBackground = !appInfo.media.backgroundPath && !!diskPaths.backgroundPath;
        const newLogo = !appInfo.media.logoPath && !!diskPaths.logoPath;
        const newIcon = !appInfo.media.iconPath && !!diskPaths.iconPath;
        const newLandscape = !appInfo.media.landscapePath && !!diskPaths.landscapePath;
        const newCover = !appInfo.media.coverPath && !!diskPaths.coverPath;

        if (newBackground || newLogo || newIcon || newLandscape || newCover) {
          const updatedMedia: GameMediaPaths = {
            landscapePath: appInfo.media.landscapePath ?? absToRel(diskPaths.landscapePath) ?? null,
            coverPath: appInfo.media.coverPath ?? absToRel(diskPaths.coverPath) ?? null,
            backgroundPath: appInfo.media.backgroundPath ?? absToRel(diskPaths.backgroundPath) ?? null,
            logoPath: appInfo.media.logoPath ?? absToRel(diskPaths.logoPath) ?? null,
            iconPath: appInfo.media.iconPath ?? absToRel(diskPaths.iconPath) ?? null,
          };

          await updateGameAppinfoMedia(appId, appInfo.name, updatedMedia, appInfo.remote, appInfo.mediaSources).catch(() => {});
          invalidateCanonicalMediaCache(appId);
          notifyMediaUpdated(appId).catch(() => {});

          const resolvedForCache = await resolveMediaPaths(appId, updatedMedia);
          resolvedMediaSessionCache.set(appId, resolvedForCache);
          appInfo.media = resolvedForCache;
          return appInfo;
        }
      }
    } catch {
      // non-critical
    }
  }

  // No disk files found — use appinfo as-is, but resolve any relative paths
  if (appInfo?.media) {
    const resolved = await resolveMediaPaths(appId, appInfo.media);
    if (resolved) {
      appInfo.media = resolved;
      resolvedMediaSessionCache.set(appId, resolved);
    }
  }
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
// Resolves relative paths (media/...) to absolute before converting to URL.
async function resolveSidebarMediaFromPaths(
  appId: string,
  appInfo?: GameAppInfo | null,
  snapshotMedia?: GameMediaPaths | null,
): Promise<ResolvedSidebarMedia> {
  const resolveRole = async (
    path: string | null | undefined,
  ): Promise<MediaItemInfo> => {
    if (path && !isTmpPath(path)) {
      const absPath = path.startsWith("media/") || path.startsWith("img/")
        ? await resolveRelativeMediaPath(appId, path).catch(() => path)
        : path;
      if (absPath) {
        return { src: localPathToUrl(absPath), localPath: absPath, exists: true };
      }
    }
    return { src: null, localPath: null, exists: false };
  };

  const getPath = (role: keyof GameMediaPaths): string | null | undefined => {
    if (snapshotMedia && snapshotMedia[role]) return snapshotMedia[role];
    if (appInfo?.media && appInfo.media[role]) return appInfo.media[role];
    return null;
  };

  const [landscape, cover, background, logo, icon] = await Promise.all([
    resolveRole(getPath("landscapePath")),
    resolveRole(getPath("coverPath")),
    resolveRole(getPath("backgroundPath")),
    resolveRole(getPath("logoPath")),
    resolveRole(getPath("iconPath")),
  ]);

  return { landscape, cover, background, logo, icon };
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

// Path resolver for provider-relative paths stored in JSON.
// Converts relative paths like "media/landscape.jpg" to absolute paths
// by prepending the known app data base: <appData>/games/<provider>/<appid>/
const appDataBaseCache = new Map<string, string>();

async function getAppDataBase(): Promise<string> {
  const cached = appDataBaseCache.get("base");
  if (cached) return cached;
  try {
    const { appDataDir } = await import("@tauri-apps/api/path");
    const base = await appDataDir();
    appDataBaseCache.set("base", base);
    return base;
  } catch {
    return "";
  }
}

/** Resolve a provider-relative game media path to an absolute filesystem path.
 *  If the path is already absolute (starts with drive letter or /), return as-is.
 *  If the path is a URL (http/https), return as-is.
 *  Otherwise prepend <appData>/games/<provider>/<appid>/
 */
export async function resolveRelativeMediaPath(
  appId: string,
  relativePath: string,
  provider = "steam",
): Promise<string> {
  if (!relativePath) return relativePath;
  if (/^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith("/")) return relativePath;
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  if (relativePath.startsWith("data:") || relativePath.startsWith("asset://") || relativePath.startsWith("file://")) return relativePath;

  const base = await getAppDataBase();
  if (!base) return relativePath;
  const abs = `${base}\\games\\${provider}\\${appId}\\${relativePath.replace(/\//g, "\\")}`;
  return abs;
}

/** Resolve a relative achievement image path to an absolute filesystem path.
 *  e.g. "img/hash.jpg" → <appData>/achievements/<provider>/<appid>/img/hash.jpg
 */
export async function resolveRelativeAchievementImagePath(
  appId: string,
  relativePath: string,
  provider = "steam",
): Promise<string> {
  if (!relativePath) return relativePath;
  if (/^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith("/")) return relativePath;
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  if (relativePath.startsWith("data:") || relativePath.startsWith("asset://") || relativePath.startsWith("file://")) return relativePath;

  const base = await getAppDataBase();
  if (!base) return relativePath;
  const abs = `${base}\\achievements\\${provider}\\${appId}\\${relativePath.replace(/\//g, "\\")}`;
  return abs;
}

/** Resolve all media paths in a GameMediaPaths object from relative to absolute. */
export async function resolveMediaPaths(
  appId: string,
  media: GameMediaPaths | null | undefined,
  provider = "steam",
): Promise<GameMediaPaths | null> {
  if (!media) return null;
  const [landscape, cover, background, logo, icon] = await Promise.all([
    media.landscapePath ? resolveRelativeMediaPath(appId, media.landscapePath, provider) : null,
    media.coverPath ? resolveRelativeMediaPath(appId, media.coverPath, provider) : null,
    media.backgroundPath ? resolveRelativeMediaPath(appId, media.backgroundPath, provider) : null,
    media.logoPath ? resolveRelativeMediaPath(appId, media.logoPath, provider) : null,
    media.iconPath ? resolveRelativeMediaPath(appId, media.iconPath, provider) : null,
  ]);
  return { landscapePath: landscape, coverPath: cover, backgroundPath: background, logoPath: logo, iconPath: icon };
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
  // Handle relative paths — they cannot be converted to asset URLs directly
  if (path.startsWith("media/") || path.startsWith("img/")) {
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
      console.log("[MediaCache] relative path in localPathToUrl (needs resolution) —", path);
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

export async function resolveGameMediaUrl(
  appId: string,
  path: string | null | undefined,
  provider = "steam",
): Promise<string | null> {
  if (!path) return null;
  if (isHttpUrl(path)) return path;
  if (path.startsWith("asset://") || path.startsWith("data:") || path.startsWith("file://")) return path;
  if (path.endsWith(".tmp")) {
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) console.log("[MEDIA][RESOLVE] ignored .tmp path appId=" + appId + " path=" + path);
    return null;
  }
  if (path.startsWith("media/") || path.startsWith("img/")) {
    const absPath = await resolveRelativeMediaPath(appId, path, provider);
    const url = localPathToUrl(absPath);
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) console.log("[MEDIA][RESOLVE] appId=" + appId + " input=" + path + " resolved=" + absPath + " url=" + (!!url));
    return url;
  }
  return localPathToUrl(path);
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
  // Run portable path migration for game media
  try {
    const { migrateGameMediaToRelative, migrateAchievementsToProviderFolders } = await import("./tauri");
    const fixed = await migrateGameMediaToRelative();
    console.log(`[GameCache] game media absolute->relative migration: ${fixed} appinfos fixed`);
    const achResult = await migrateAchievementsToProviderFolders();
    console.log(`[GameCache] achievement folder migration: found=${achResult.found} migrated=${achResult.migrated}`);
  } catch (e) {
    console.warn("[GameCache] portable path migration error:", e);
  }
}

// ---------------------------------------------------------------------------
// Media Manifest generation
// ---------------------------------------------------------------------------

export async function generateMediaManifest(
  appId: string,
  media: GameMediaPaths | null,
  provider = "steam",
): Promise<void> {
  if (!media) return;
  const now = Math.floor(Date.now() / 1000);
  const { getGameMediaPaths: getPaths } = await import("./tauri");
  let resolved: GameMediaPathsResult | null = null;
  try {
    resolved = await getPaths(appId);
  } catch {
    resolved = null;
  }
  const entryForRole = (role: string): { path: string; exists: boolean; size: number | null; modifiedAt: number | null } => {
    const relPath = media[`${role}Path` as keyof typeof media] as string | null;
    const existsKey = `${role}Exists` as keyof GameMediaPathsResult;
    const pathKey = `${role}Path` as keyof GameMediaPathsResult;
    if (!relPath) {
      return { path: `media/${role}.jpg`, exists: false, size: null, modifiedAt: null };
    }
    if (resolved) {
      const exists = !!(resolved[existsKey] as boolean);
      const resolvedPath = resolved[pathKey] as string | null;
      return { path: resolvedPath ?? relPath, exists, size: null, modifiedAt: null };
    }
    return { path: relPath, exists: false, size: null, modifiedAt: null };
  };

  const manifest: MediaManifest = {
    provider,
    appid: appId,
    version: 1,
    updatedAt: now,
    files: {
      cover: entryForRole("cover"),
      landscape: entryForRole("landscape"),
      background: entryForRole("background"),
      logo: entryForRole("logo"),
      icon: entryForRole("icon"),
    } as MediaManifestFiles,
  };

  await writeMediaManifestTauri(appId, manifest);
  console.log(`[MEDIA][MANIFEST] written appid=${appId} cover=${manifest.files.cover.exists} landscape=${manifest.files.landscape.exists} background=${manifest.files.background.exists}`);
}

// ---------------------------------------------------------------------------
// MediaIndex helpers — seed from manifests on startup
// ---------------------------------------------------------------------------

export async function seedMediaIndexFromStartup(
  appIds: string[],
): Promise<void> {
  if (appIds.length === 0) return;
  const manifests = await getMediaManifestsBatch(appIds);
  if (Object.keys(manifests).length === 0) return;
  const resolved: Record<string, { coverUrl: string | null; landscapeUrl: string | null; backgroundUrl: string | null; logoUrl: string | null; iconUrl: string | null }> = {};
  for (const [appId, manifest] of Object.entries(manifests)) {
    const resolvedPaths = await resolveMediaPaths(appId, {
      coverPath: manifest.files.cover.exists ? manifest.files.cover.path : null,
      landscapePath: manifest.files.landscape.exists ? manifest.files.landscape.path : null,
      backgroundPath: manifest.files.background.exists ? manifest.files.background.path : null,
      logoPath: manifest.files.logo.exists ? manifest.files.logo.path : null,
      iconPath: manifest.files.icon.exists ? manifest.files.icon.path : null,
    }, manifest.provider);
    resolved[appId] = {
      coverUrl: resolvedPaths?.coverPath ? localPathToUrl(resolvedPaths.coverPath) : null,
      landscapeUrl: resolvedPaths?.landscapePath ? localPathToUrl(resolvedPaths.landscapePath) : null,
      backgroundUrl: resolvedPaths?.backgroundPath ? localPathToUrl(resolvedPaths.backgroundPath) : null,
      logoUrl: resolvedPaths?.logoPath ? localPathToUrl(resolvedPaths.logoPath) : null,
      iconUrl: resolvedPaths?.iconPath ? localPathToUrl(resolvedPaths.iconPath) : null,
    };
  }
  seedMediaIndexFromManifests(manifests, resolved);
  console.log(`[MEDIA_INDEX] seeded from manifests count=${Object.keys(manifests).length}`);
}

// ---------------------------------------------------------------------------
// Startup media hydration — fill missing appinfo fields from disk files
// ---------------------------------------------------------------------------

export async function hydrateMediaOnStartup(
  appIds: string[],
): Promise<{ updatedAppInfos: number; withBackground: number; withLandscape: number; withIcon: number; withLogo: number }> {
  if (appIds.length === 0) return { updatedAppInfos: 0, withBackground: 0, withLandscape: 0, withIcon: 0, withLogo: 0 };
  const { resolveGameMediaPaths, getGameAppInfo, updateGameAppinfoMedia } = await import("./tauri");
  let updatedAppInfos = 0;
  let withBackground = 0;
  let withLandscape = 0;
  let withIcon = 0;
  let withLogo = 0;
  for (const appId of appIds) {
    try {
      const diskPaths = await resolveGameMediaPaths(appId);
      if (!diskPaths) continue;
      const hasDiskFiles = !!(diskPaths.landscapePath || diskPaths.coverPath || diskPaths.backgroundPath || diskPaths.logoPath || diskPaths.iconPath);
      if (!hasDiskFiles) continue;
      const appInfo = await getGameAppInfo(appId);
      if (!appInfo) continue;
      const existing = appInfo.media;
      const absToRel = (abs: string | null): string | null => {
        if (!abs) return null;
        const parts = abs.replace(/\\/g, '/').split('/');
        const filename = parts[parts.length - 1];
        return filename ? `media/${filename}` : null;
      };
      const needsUpdate = (existing?.backgroundPath ? false : true) && !!diskPaths.backgroundPath
        || (existing?.iconPath ? false : true) && !!diskPaths.iconPath
        || (existing?.logoPath ? false : true) && !!diskPaths.logoPath;
      if (!needsUpdate) continue;
      const merged: Record<string, string | null> = {
        backgroundPath: existing?.backgroundPath ?? absToRel(diskPaths.backgroundPath) ?? null,
        iconPath: existing?.iconPath ?? absToRel(diskPaths.iconPath) ?? null,
        logoPath: existing?.logoPath ?? absToRel(diskPaths.logoPath) ?? null,
        landscapePath: existing?.landscapePath ?? absToRel(diskPaths.landscapePath) ?? null,
        coverPath: existing?.coverPath ?? absToRel(diskPaths.coverPath) ?? null,
      };
      await updateGameAppinfoMedia(appId, null, merged as any, null).catch(() => {});
      if (merged.backgroundPath) withBackground++;
      if (merged.landscapePath) withLandscape++;
      if (merged.iconPath) withIcon++;
      if (merged.logoPath) withLogo++;
      updatedAppInfos++;
      console.log(`[MEDIA][HYDRATE] appid=${appId} found background=${!!diskPaths.backgroundPath} cover=${!!diskPaths.coverPath} icon=${!!diskPaths.iconPath} landscape=${!!diskPaths.landscapePath} logo=${!!diskPaths.logoPath}`);
      console.log(`[MEDIA][HYDRATE] appid=${appId} updatedFields=${Object.values(merged).filter(Boolean).length}`);
      // Update MediaIndex
      const entry = getMediaEntry(appId);
      if (entry) {
        const updated = { ...entry };
        for (const [field, path] of Object.entries(merged)) {
          const key = field.replace("Path", "") as keyof typeof updated;
          const hasKey = `has${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof typeof updated;
          if (path) {
            (updated as any)[field] = path;
            (updated as any)[hasKey] = true;
          }
        }
        updated.updatedAt = Date.now();
        setMediaEntry(updated);
      }
    } catch {
      // Non-critical — skip failed app
    }
  }
  console.log(`[BOOT][MEDIA_HYDRATE] games=${appIds.length}`);
  console.log(`[BOOT][MEDIA_HYDRATE] updatedAppInfos=${updatedAppInfos}`);
  console.log(`[BOOT][MEDIA_HYDRATE] withBackground=${withBackground}`);
  console.log(`[BOOT][MEDIA_HYDRATE] withLandscape=${withLandscape}`);
  console.log(`[BOOT][MEDIA_HYDRATE] withIcon=${withIcon}`);
  console.log(`[BOOT][MEDIA_HYDRATE] withLogo=${withLogo}`);
  return { updatedAppInfos, withBackground, withLandscape, withIcon, withLogo };
}
