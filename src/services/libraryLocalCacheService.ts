  import {
    readLibraryAppinfo,
    updateLibraryAppinfoEntry,
    readLibraryGameDetails,
    getGameMediaCache,
    saveGameMediaCache,
    clearGameMediaCache,
    readImageAsDataUrl,
    cacheLibraryGameMedia,
  } from "./tauri";
  import {
    cacheMediaForGame,
    hasCanonicalMedia,
    isLocalPath,
    isHttpUrl,
  } from "./gameCacheService";

  import type {
    LibraryAppInfoEntry,
    LibraryAppInfoMap,
    LibraryGameDetailsEntry,
    GameMediaCacheEntry,
    GameMediaPaths,
    SteamGridDbRef,
  } from "./tauri";
  import type { GameAppInfo, LandscapeUrls, CoverUrls } from "./gameCacheService";

  // ---------------------------------------------------------------------------
  // Debug log flags
  // ---------------------------------------------------------------------------

  const ENABLE_VERBOSE_LIBRARY_CACHE_LOGS = false;
  const ENABLE_VERBOSE_MEDIA_CACHE_LOGS = false;

  // ---------------------------------------------------------------------------
  // In-memory old-style appinfo cache (library/appinfo.json)
  // Kept for backward compat; new code should use canonical game cache.
  // ---------------------------------------------------------------------------

  let _appInfoCache: LibraryAppInfoMap | null = null;

  async function ensureAppInfoLoaded(): Promise<LibraryAppInfoMap> {
    if (_appInfoCache === null) {
      try {
        _appInfoCache = await readLibraryAppinfo();
        if (ENABLE_VERBOSE_LIBRARY_CACHE_LOGS) {
          const size = Object.keys(_appInfoCache).length;
          console.log(`[LibraryCache] appinfo loaded (${size} entries)`);
        }
      } catch {
        _appInfoCache = {};
      }
    }
    return _appInfoCache!;
  }

  export function clearAppInfoMemoryCache(): void {
    _appInfoCache = null;
  }

  export async function loadLibraryAppInfo(): Promise<LibraryAppInfoMap> {
    return await ensureAppInfoLoaded();
  }

  export async function getLibraryAppInfo(
    appId: string
  ): Promise<LibraryAppInfoEntry | null> {
    const map = await ensureAppInfoLoaded();
    return map[appId] ?? null;
  }

  export async function updateLibraryAppInfo(
    appId: string,
    entry: LibraryAppInfoEntry
  ): Promise<boolean> {
    try {
      await updateLibraryAppinfoEntry(appId, entry);
      if (_appInfoCache) {
        _appInfoCache[appId] = entry;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Game details (library/details/{appid}.json) — DEPRECATED
  // New writes go to canonical games/steam/{appid}/store-details.json
  // ---------------------------------------------------------------------------

  export async function getLibraryGameDetails(
    appId: string
  ): Promise<LibraryGameDetailsEntry | null> {
    try {
      return await readLibraryGameDetails(appId);
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Game media key – stable key generation (for old cache lookup)
  // ---------------------------------------------------------------------------

  function stableHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }

  export type GameMediaKeyInput = {
    appId?: string;
    id?: string;
    executablePath?: string;
    source?: string;
  };

  export function getGameMediaKey(game: GameMediaKeyInput): string {
    if (game.appId) {
      return `steam-${game.appId}`;
    }
    if (game.id) {
      return `local-${game.id}`;
    }
    if (game.executablePath) {
      return `exe-${stableHash(game.executablePath)}`;
    }
    return `unknown-${Date.now()}`;
  }

  // ---------------------------------------------------------------------------
  // Old-style media cache access (library/media/{game_key}/metadata.json)
  // Kept for backward compat. New code should read canonical GameAppInfo.
  // ---------------------------------------------------------------------------

  export async function getGameMediaCacheForGame(
    game: GameMediaKeyInput
  ): Promise<GameMediaCacheEntry | null> {
    const key = getGameMediaKey(game);
    try {
      const entry = await getGameMediaCache(key);
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
        console.log(`[MediaCache] ${entry ? "hit" : "miss"} for key "${key}"`);
      }
      return entry;
    } catch {
      return null;
    }
  }

  export async function getMediaCacheForAppId(
    appId: string
  ): Promise<GameMediaCacheEntry | null> {
    try {
      return await getGameMediaCacheForGame({ appId });
    } catch {
      return null;
    }
  }

  export async function saveGameMediaCacheForGame(
    game: GameMediaKeyInput,
    entry: GameMediaCacheEntry
  ): Promise<GameMediaCacheEntry | null> {
    const key = getGameMediaKey(game);
    try {
      return await saveGameMediaCache(key, entry);
    } catch {
      return null;
    }
  }

  export async function clearGameMediaCacheForGame(
    game: GameMediaKeyInput
  ): Promise<boolean> {
    const key = getGameMediaKey(game);
    try {
      await clearGameMediaCache(key);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // ensureCanonicalLibraryMediaCached — cache to games/steam/{appid}/media/
  // Simplified to only landscape + cover.
  // ---------------------------------------------------------------------------

  export async function ensureCanonicalLibraryMediaCached(
    game: {
      appId?: string;
      title?: string;
      imageUrl?: string;
      headerImage?: string;
      backgroundImage?: string;
      metadata?: Record<string, any>;
    },
    artwork?: Record<string, any> | null,
  ): Promise<GameMediaPaths | null> {
    if (!game.appId) return null;
    const appId = game.appId;
    const meta = game.metadata || {};

    // Build landscape URLs with priority: SGDB grid > SGDB hero > store header > store background
    const landscapeUrls: LandscapeUrls = {
      sgdb_grid_url: artwork?.sgdbGridUrl || artwork?.sgdbGridThumbUrl || null,
      sgdb_hero_url: artwork?.sgdbHeroUrl || null,
      store_header_url: game.headerImage || meta?.header_image || null,
      store_background_url: game.backgroundImage || meta?.background || meta?.background_raw || null,
    };

    // Build cover URLs with priority: SGDB vertical grid > store capsule > store capsulev5 > store header
    const coverUrls: CoverUrls | null = artwork?.sgdbCoverUrl || meta?.capsule_image || meta?.capsule_image_v5 ? {
      sgdb_cover_url: artwork?.sgdbCoverUrl || null,
      store_capsule_url: meta?.capsule_image || null,
      store_capsule_v5_url: meta?.capsule_image_v5 || null,
      store_header_url: meta?.header_image || null,
    } : null;

    if (!landscapeUrls.sgdb_grid_url && !landscapeUrls.sgdb_hero_url && !landscapeUrls.store_header_url && !landscapeUrls.store_background_url && !coverUrls) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
        console.log(`[MediaCache] no URLs available for canonical cache of ${appId}`);
      }
      return null;
    }

    const sgdbRef: SteamGridDbRef | null = artwork ? {
      grid_url: artwork.sgdbGridUrl || null,
      hero_url: artwork.sgdbHeroUrl || null,
      logo_url: artwork.sgdbLogoUrl || null,
      icon_url: artwork.sgdbIconUrl || null,
      cover_url: artwork.sgdbCoverUrl || null,
    } : null;

    try {
      const paths = await cacheMediaForGame(appId, game.title || null, landscapeUrls, coverUrls, sgdbRef);
      // Backward compat: also update old library/appinfo.json
      if (game.appId) {
        await updateLibraryAppInfo(game.appId, {
          app_id: game.appId,
          name: game.title || null,
          header_image: game.imageUrl || null,
          cover_path: paths.coverPath,
          grid_path: paths.landscapePath,
          hero_path: null,
          logo_path: null,
          icon_path: null,
          updated_at: nowTimestamp(),
        }).catch(() => {});
        if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
          console.log(`[MediaCache] backward compat appinfo updated for ${appId}`);
        }
      }
      return paths;
    } catch (err) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
        console.log(`[MediaCache] canonical cache error for ${appId}:`, err);
      }
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // ensureLibraryMediaCached — OLD path (library/media/)
  // Kept for backward compat; delegates to canonical cache for Steam games.
  // ---------------------------------------------------------------------------

  export async function ensureLibraryMediaCached(
    game: {
      appId?: string;
      id?: string;
      source?: string;
      executablePath?: string;
      title?: string;
      imageUrl?: string;
      headerImage?: string;
      backgroundImage?: string;
      artwork?: string;
      metadata?: Record<string, any>;
    },
    artwork?: Record<string, any> | null,
  ): Promise<GameMediaCacheEntry | null> {
    // For Steam games with appId, use canonical cache instead
    if (game.appId) {
      const paths = await ensureCanonicalLibraryMediaCached(game, artwork);
      if (paths) {
        return {
          game_key: `steam-${game.appId}`,
          app_id: game.appId,
          title: game.title || null,
          cover_path: paths.coverPath,
          grid_path: paths.landscapePath,
          hero_path: null,
          logo_path: null,
          icon_path: null,
          quick_cover_path: null,
          updated_at: null,
        };
      }
      return null;
    }

    // Non-Steam games: use old path
    const gameKey = getGameMediaKey(game);
    const meta = game.metadata || {};

    let coverUrl: string | undefined;
    let gridUrl: string | undefined;

    if (artwork) {
      gridUrl = gridUrl || artwork.sgdbGridUrl;
      coverUrl = coverUrl || artwork.sgdbCoverUrl;
    }
    gridUrl = gridUrl || game.imageUrl;
    gridUrl = gridUrl || meta.capsule_image_v5 || meta.capsule_image;
    coverUrl = coverUrl || meta.cover_url || meta.library_cover_image;

    if (!gridUrl && !coverUrl) return null;

    try {
      const entry = await cacheLibraryGameMedia(gameKey, game.appId || null, game.title || null, { coverUrl, gridUrl });
      if (game.appId && (entry.cover_path || entry.grid_path)) {
        await updateLibraryAppInfo(game.appId, {
          app_id: game.appId,
          name: game.title || null,
          header_image: game.imageUrl || null,
          cover_path: entry.cover_path,
          grid_path: entry.grid_path,
          hero_path: null,
          logo_path: null,
          icon_path: null,
          updated_at: nowTimestamp(),
        }).catch(() => {});
      }
      return entry;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Image priority helpers — check canonical cache first, then old paths
  // ---------------------------------------------------------------------------

  export function pickImageFromLocalCache(
    _game: { imageUrl?: string },
    appinfoEntry: LibraryAppInfoEntry | null,
    mediaEntry: GameMediaCacheEntry | null,
    canonicalAppInfo?: GameAppInfo | null,
  ): string | null {
    // Canonical landscape takes priority
    if (canonicalAppInfo?.media?.landscapePath) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] using canonical landscapePath");
      return canonicalAppInfo.media.landscapePath;
    }
    if (canonicalAppInfo?.media?.coverPath) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] using canonical coverPath");
      return canonicalAppInfo.media.coverPath;
    }
    // Fallback to old media entry paths
    if (mediaEntry?.grid_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] using media grid_path");
      return mediaEntry.grid_path;
    }
    if (mediaEntry?.cover_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] using media cover_path");
      return mediaEntry.cover_path;
    }
    if (mediaEntry?.quick_cover_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] using media quick_cover_path");
      return mediaEntry.quick_cover_path;
    }
    if (appinfoEntry?.cover_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] using appinfo cover_path");
      return appinfoEntry.cover_path;
    }
    if (appinfoEntry?.grid_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] using appinfo grid_path");
      return appinfoEntry.grid_path;
    }
    if (appinfoEntry?.header_image) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] using appinfo header_image");
      return appinfoEntry.header_image;
    }
    if (appinfoEntry?.hero_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] using appinfo hero_path");
      return appinfoEntry.hero_path;
    }
    if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] fallback placeholder — no local media");
    return null;
  }

  export function pickSidebarImage(
    _game: { imageUrl?: string },
    appinfoEntry: LibraryAppInfoEntry | null,
    mediaEntry: GameMediaCacheEntry | null,
    canonicalAppInfo?: GameAppInfo | null,
  ): string | null {
    if (canonicalAppInfo?.media?.landscapePath) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] sidebar using canonical landscape");
      return canonicalAppInfo.media.landscapePath;
    }
    if (canonicalAppInfo?.media?.coverPath) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] sidebar using canonical cover");
      return canonicalAppInfo.media.coverPath;
    }
    if (mediaEntry?.icon_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] sidebar using media icon_path");
      return mediaEntry.icon_path;
    }
    if (mediaEntry?.grid_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] sidebar using media grid_path");
      return mediaEntry.grid_path;
    }
    if (mediaEntry?.cover_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] sidebar using media cover_path");
      return mediaEntry.cover_path;
    }
    if (mediaEntry?.quick_cover_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] sidebar using media quick_cover_path");
      return mediaEntry.quick_cover_path;
    }
    if (appinfoEntry?.icon_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] sidebar using appinfo icon_path");
      return appinfoEntry.icon_path;
    }
    if (appinfoEntry?.cover_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] sidebar using appinfo cover_path");
      return appinfoEntry.cover_path;
    }
    if (appinfoEntry?.grid_path) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] sidebar using appinfo grid_path");
      return appinfoEntry.grid_path;
    }
    if (appinfoEntry?.header_image) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] sidebar using appinfo header_image");
      return appinfoEntry.header_image;
    }
    if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log("[MediaCache] sidebar fallback placeholder");
    return null;
  }

  // ---------------------------------------------------------------------------
  // hasLocalMedia — check canonical cache first
  // ---------------------------------------------------------------------------

  export function hasLocalMedia(
    appinfoEntry: LibraryAppInfoEntry | null,
    mediaEntry: GameMediaCacheEntry | null,
    canonicalAppInfo?: GameAppInfo | null,
  ): boolean {
    if (canonicalAppInfo && hasCanonicalMedia(canonicalAppInfo)) return true;
    if (!appinfoEntry && !mediaEntry) return false;
    const result = !!(
      mediaEntry?.grid_path ||
      mediaEntry?.cover_path ||
      mediaEntry?.hero_path ||
      mediaEntry?.icon_path ||
      mediaEntry?.quick_cover_path ||
      mediaEntry?.logo_path ||
      appinfoEntry?.cover_path ||
      appinfoEntry?.grid_path ||
      appinfoEntry?.hero_path ||
      appinfoEntry?.icon_path
    );
    if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
      console.log(`[MediaCache] hasLocalMedia=${result}`);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Data normalization helpers
  // ---------------------------------------------------------------------------

  export function normalizeAppId(value: unknown): string {
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return value.trim();
    return "";
  }

  export function isValidAppId(value: unknown): value is string {
    if (typeof value === "string") return /^\d{1,10}$/.test(value.trim());
    if (typeof value === "number") return Number.isInteger(value) && value > 0 && value <= 9999999999;
    return false;
  }

  export function nowTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  export function pickTitleFromLocalCache(
    _game: { title?: string; customTitle?: string; name?: string },
    appinfoEntry: LibraryAppInfoEntry | null,
  ): string | null {
    if (_game.customTitle) return _game.customTitle;
    if (appinfoEntry?.name) return appinfoEntry.name;
    if (_game.title) return _game.title;
    if (_game.name) return _game.name;
    return null;
  }

  export function computeDisplayTitle(
    game: { title: string; appId?: string; customTitle?: string; name?: string },
    appinfoEntry: LibraryAppInfoEntry | null,
    metadataName?: string | null,
  ): string {
    const title = pickTitleFromLocalCache(game, appinfoEntry) || metadataName || (game.appId ? `Steam App ${game.appId}` : "Unknown Game");
    if (ENABLE_VERBOSE_LIBRARY_CACHE_LOGS) {
      console.log(`[LibraryCache] resolved title: "${title}" for app ${game.appId || "unknown"}`);
    }
    return title;
  }



  export { isHttpUrl, isLocalPath };

  export { localPathToUrl } from "./gameCacheService";

  export async function resolveLocalImageAsDataUrl(path: string): Promise<string | null> {
    if (isHttpUrl(path)) return path;
    try {
      return await readImageAsDataUrl(path);
    } catch {
      return null;
    }
  }
