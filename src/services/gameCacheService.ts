import {
  getGameAppInfo,
  saveGameAppInfo,
  getStoreDetails,
  saveStoreDetails,
  updateGameMetadataJson,
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
  readMediaManifest as readMediaManifestTauri,
  getMediaManifestsBatch,
  saveGameMediaFile as saveGameMediaFileTauri,
  listProviderMediaFiles,
} from "./tauri";
import type { ProviderMediaFileEntry } from "./tauri";
import {
  parseProviderMediaComponents,
  ROLE_EXTENSION_CANDIDATES,
} from "./providerMediaPaths";
import type { MediaRole } from "./providerMediaPaths";
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
  GameRemoteRefsInput,
  GameMediaSources,
} from "./tauri";
import type { LibraryGame } from "../types/libraryGame";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { SgdbArtworkData } from "./storeArtworkResolver";
import type { RawgArtworkData, IgdbArtworkData } from "./storeArtworkResolver";
import type {
  GameMediaKind,
  GameMediaSource,
  ResolvedGameMediaAsset,
  ResolvedGameMediaBundle,
  ResolvedGameTrailer,
} from "../types/gameMedia";
import { resolveGameTrailers } from "./gameMetadataResolver";

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
  GameRemoteRefsInput,
  GameMediaSources,
};

// Re-export for data URL fallback
export { readGameMediaDataUrl };

// ── Phase 10: Cache freshness TTL ──
// All session caches are invalidated after APPINFO_CACHE_TTL_MS.
// Prevents stale data from being returned when appinfo.json is updated
// by an external process (e.g., Steam, another LumaForge instance).
const APPINFO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Phase 8: SQLite-backed name cache ──
// Reads SQLite `games` table once (via readAllGames) and uses it as the
// primary name source, avoiding per-game appinfo.json reads for name resolution.
let _sqliteNameCache: Record<string, string> = {};
let _sqliteNameCacheTs = 0;
const SQLITE_NAME_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getSqliteName(appId: string): Promise<string | null> {
  const now = Date.now();
  if (now - _sqliteNameCacheTs > SQLITE_NAME_CACHE_TTL_MS) {
    try {
      const { readAllGames } = await import("./tauri");
      const games = await readAllGames();
      _sqliteNameCache = {};
      for (const g of games) {
        if (g.title) _sqliteNameCache[g.appId] = g.title;
      }
      _sqliteNameCacheTs = now;
    } catch {
      return null;
    }
  }
  return _sqliteNameCache[appId] ?? null;
}

// ── Session-level appinfo cache ──
// Avoids repeated `getGameAppInfo` Tauri invokes for the same appId during a session.
// Cleared when appinfo is written (via clearSessionAppInfoCache).
import { countAppinfoRead, countAppinfoCacheHit, isRecentlyNavigated, isInteractionBusy } from "./perfCounters";

type CacheEntry<T> = { value: T; ts: number };

const _sessionAppinfoCache = new Map<string, CacheEntry<GameAppInfo | null>>();

function isCacheEntryFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  if (!entry) return false;
  return (Date.now() - entry.ts) < APPINFO_CACHE_TTL_MS;
}

export function clearSessionAppInfoCache(appId?: string): void {
  if (appId) {
    _sessionAppinfoCache.delete(appId);
  } else {
    _sessionAppinfoCache.clear();
  }
}

export async function getCachedGameAppInfo(appId: string): Promise<GameAppInfo | null> {
  const cached = _sessionAppinfoCache.get(appId);
  if (isCacheEntryFresh(cached)) {
    countAppinfoCacheHit();
    return cached.value;
  }
  countAppinfoRead();
  const result = await getGameAppInfo(appId).catch(() => null);
  _sessionAppinfoCache.set(appId, { value: result, ts: Date.now() });
  return result;
}

// ── Frontend-side no-op guard for updateGameAppinfoMedia ──
// Compares proposed appinfo fields against existing on disk before calling Rust.
// Prevents unnecessary IPC calls when nothing has changed.

export type AppinfoProposal = {
  name: string | null;
  media: GameMediaPaths;
  remote?: GameRemoteRefsInput | null;
  mediaSources?: GameMediaSources | null;
};

export async function hasAppinfoEffectiveChange(
  appId: string,
  proposed: AppinfoProposal,
): Promise<boolean> {
  try {
    const existing = await getCachedGameAppInfo(appId);
    if (!existing) return true;
    if ((existing.name ?? null) !== (proposed.name ?? null)) return true;
    const exMedia = existing.media ?? ({} as GameMediaPaths);
    const keys: (keyof GameMediaPaths)[] = ["coverPath", "backgroundPath", "logoPath", "iconPath", "landscapePath"];
    for (const k of keys) {
      if ((exMedia[k] ?? null) !== (proposed.media[k] ?? null)) return true;
    }
    if (proposed.remote !== undefined) {
      const existingRemote = existing.remote ?? null;
      const proposedRemote = proposed.remote ?? null;
      const remoteJson = (v: unknown) => v ? JSON.stringify(v) : "null";
      if (remoteJson(existingRemote) !== remoteJson(proposedRemote)) return true;
    }
    if (proposed.mediaSources !== undefined) {
      const existingSources = existing.mediaSources ?? null;
      const proposedSources = proposed.mediaSources ?? null;
      const sourcesJson = (v: unknown) => v ? JSON.stringify(v) : "null";
      if (sourcesJson(existingSources) !== sourcesJson(proposedSources)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

export async function updateGameAppinfoMediaIfChanged(
  appId: string,
  name: string | null,
  media: GameMediaPaths,
  remote?: GameRemoteRefsInput | null,
  mediaSources?: GameMediaSources | null,
  caller?: string,
): Promise<boolean> {
  const hasChange = await hasAppinfoEffectiveChange(appId, { name, media, remote, mediaSources });
  if (!hasChange) {
    if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][APPINFO_SKIP] appid=${appId} reason=already-synced-before-rust caller=${caller ?? "unknown"}`);
    return false;
  }
  if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][APPINFO_CALL] caller=${caller ?? "unknown"} appid=${appId}`);
  await updateGameAppinfoMedia(appId, name, media, remote, mediaSources);
  // Invalidate session cache so subsequent reads get fresh data
  _sessionAppinfoCache.delete(appId);
  return true;
}

// ── saveGameMediaFile wrapper ──
// Saves a base64-encoded image file to the game's media directory via Rust,
// then updates appinfo with the new relative path. Returns the relative path.
export async function saveGameMediaFile(
  appId: string,
  role: string,
  contentBase64: string,
  ext: string,
): Promise<string> {
  return await saveGameMediaFileTauri(appId, role, contentBase64, ext);
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

// ── Logging flags (all false by default for stabilization) ──
export const DEBUG_MEDIA_DETAILS = false;
export const DEBUG_MEDIA_RESOLVE = false;

// ── Emergency stabilization: disable global auto media repair ──
export const AUTO_MEDIA_REPAIR_GLOBAL = false;
export const AUTO_MEDIA_REPAIR_VISIBLE_ONLY = true;
let _globalRepairSkipLogged = false;

function logGlobalRepairSkipOnce(): void {
  if (!_globalRepairSkipLogged) {
    _globalRepairSkipLogged = true;
    console.log("[MEDIA][GLOBAL_REPAIR_SKIP] reason=disabled");
  }
}

// ── Media health metadata with TTL ──
export type MediaHealth = {
  complete: boolean;
  checkedAt: number;
  missing: string[];
  lastRepairAttemptAt?: number;
  lastRepairError?: string;
};

const MEDIA_COMPLETE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MEDIA_INCOMPLETE_RETRY_MS = 10 * 60 * 1000;   // 10 minutes
const MEDIA_FAILED_COOLDOWN_MS = 5 * 60 * 1000;     // 5 minutes after failed repair
const MEDIA_NO_SOURCE_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes for no-source-url failures

const _mediaHealthStore = new Map<string, MediaHealth>();

export function getMediaHealth(appId: string): MediaHealth | undefined {
  return _mediaHealthStore.get(appId);
}

export function setMediaHealth(appId: string, health: MediaHealth): void {
  _mediaHealthStore.set(appId, health);
}

export function isMediaHealthStale(appId: string): boolean {
  const h = _mediaHealthStore.get(appId);
  if (!h) return true;
  const ttl = h.complete ? MEDIA_COMPLETE_TTL_MS : MEDIA_INCOMPLETE_RETRY_MS;
  return Date.now() - h.checkedAt > ttl;
}

export function isMediaRepairOnCooldown(appId: string): boolean {
  const h = _mediaHealthStore.get(appId);
  if (!h) return false;
  if (!h.lastRepairAttemptAt) return false;
  const cooldown = h.lastRepairError === "no-source-url" ? MEDIA_NO_SOURCE_COOLDOWN_MS : MEDIA_FAILED_COOLDOWN_MS;
  return Date.now() - h.lastRepairAttemptAt < cooldown;
}

export function isNoSourceCooldown(appId: string): boolean {
  const h = _mediaHealthStore.get(appId);
  if (!h) return false;
  if (h.lastRepairError !== "no-source-url") return false;
  if (!h.lastRepairAttemptAt) return false;
  return Date.now() - h.lastRepairAttemptAt < MEDIA_NO_SOURCE_COOLDOWN_MS;
}

/** Known Steam system/tool appIds that should not have media repair applied. */
const SYSTEM_TOOL_APP_IDS = new Set([
  "228980", // Steamworks Common Redistributables
  "2371090", // Steam Game Notes (config)
  "1070560", // Steam Linux Runtime
  "1391110", // Steamworks Shared
  "1798010", // Proton Experimental
  "1493710", // Proton 5.0
  "1580130", // Proton 6.0
  "1883940", // Proton 7.0
  "2348590", // Proton 8.0
  "858280", // Steamworks Example
  "1273400", // Steam Network Access
  "15540", // Half-Life 2: Update (tool)
]);

export function isSystemToolApp(appId: string | number): boolean {
  return SYSTEM_TOOL_APP_IDS.has(String(appId));
}

/** The 5 canonical media roles that LumaForge manages per game. */
export const CANONICAL_GAME_MEDIA_ROLES: Array<{ key: string; type: string }> = [
  { key: "cover", type: "cover" },
  { key: "landscape", type: "landscape" },
  { key: "background", type: "background" },
  { key: "logo", type: "logo" },
  { key: "icon", type: "icon" },
];

/** Deduplicate an array of items by their `appId` field, keeping first occurrence. */
export function deduplicateByAppId<T extends { appId?: string | undefined | null }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!item.appId) continue;
    if (seen.has(item.appId)) continue;
    seen.add(item.appId);
    out.push(item);
  }
  return out;
}

/**
 * Returns a stable unique identifier for any LibraryGame.
 * Priority: libraryId > steam:appId > id.
 * Manual games use `manual:<uuid>`, Steam games use `steam:<appId>`.
 */
export function getLibraryGameStableId(game: { libraryId?: string; appId?: string; id: string }): string {
  if (game.libraryId) return game.libraryId;
  if (game.appId) return `steam:${game.appId}`;
  return game.id;
}

/**
 * Returns the stable key used by FavoritesContext for any game type.
 * For Steam games: appId (e.g. "480").
 * For manual games: libraryId (e.g. "manual:<uuid>").
 * Consistent with `LibraryGameDetails.tsx` which uses `game.appId || game.id`.
 */
export function getFavoriteKey(game: { appId?: string | null; libraryId?: string | null; id?: string; source?: string }): string | null {
  // Manual games always use their stable libraryId so the key never changes when appId is set later
  if (game.source === "manual" && game.libraryId) return game.libraryId;
  if (game.appId) return game.appId;
  if (game.libraryId) return game.libraryId;
  if (game.id) return game.id;
  return null;
}

const FAVORITES_STORAGE_KEY = "lumaforge-favorites-v1";

/**
 * Delete-only reconciler for manual-game favorite keys.
 *
 * When a manual game later gains a Steam appId (e.g. flows that set
 * `entry.appId`), favorite entries stored under the numeric appId would
 * double-display next to the canonical `manual:<uuid>` key. Rule: if BOTH
 * the appId AND the libraryId are favorited, delete the appId key. The
 * "appId-only" case is ambiguous (could be a real Steam favorite) and is
 * never touched. Idempotent — safe to call repeatedly.
 */
export function reconcileManualFavoriteKeys(manualGames: { libraryId?: string | null; appId?: string | null }[]): boolean {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    const ids = new Set<string>(parsed.filter((x): x is string => typeof x === "string"));
    let changed = false;
    for (const game of manualGames) {
      if (!game.libraryId || !game.appId) continue;
      if (ids.has(game.appId) && ids.has(game.libraryId)) {
        ids.delete(game.appId);
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(ids)));
      window.dispatchEvent(new CustomEvent("lumaforge-data-changed", { detail: { key: FAVORITES_STORAGE_KEY } }));
    }
    return changed;
  } catch {
    return false;
  }
}

/** Deduplicate an array of LibraryGame by stable identity, keeping first occurrence. */
export function deduplicateByStableId<T extends { libraryId?: string; appId?: string; id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = getLibraryGameStableId(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Known media filenames that map to media roles. */
const KNOWN_MEDIA_FILENAMES = new Set([
  "cover.jpg", "cover.png",
  "landscape.jpg", "landscape.png",
  "background.jpg", "background.png",
  "logo.png", "logo.jpg",
  "icon.png", "icon.jpg",
]);

/**
 * Normalize a media path for MediaIndex/manifest storage.
 * Always returns `media/<filename>` or `null`.
 * Absolute paths, temp files, remote URLs, and unknown filenames all become null.
 */
export function normalizeMediaPathForIndex(path: string | null | undefined): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  // Remote URLs, asset/data/file URIs are not local media paths
  if (/^https?:\/\//i.test(trimmed)) return null;
  if (/^(asset|data|file):/i.test(trimmed)) return null;
  // Skip .tmp files
  if (trimmed.endsWith(".tmp")) return null;
  // Extract filename from absolute or relative path
  const filename = trimmed.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  if (!filename) return null;
  if (!KNOWN_MEDIA_FILENAMES.has(filename)) {
    // If it doesn't match known names, still accept but prefix with media/
    return `media/${filename}`;
  }
  return `media/${filename}`;
}

// ---------------------------------------------------------------------------
// Canonical LibraryGame dedup — merges Steam + Lua entries for same appId
// ---------------------------------------------------------------------------

const DEBUG_SIDEBAR_FILTER = false;
const _sidebarFilteredLogged = new Set<string>();

export function hasActiveInstalledLuaScript(game: LibraryGame): boolean {
  if (!Array.isArray(game.luaScripts) || game.luaScripts.length === 0) {
    return false;
  }

  return game.luaScripts.some((script: any) => {
    if (!script) return false;

    const hasRealLocalReference =
      typeof script.path === "string" ||
      typeof script.file_path === "string" ||
      typeof script.filePath === "string" ||
      typeof script.luaPath === "string" ||
      typeof script.installPath === "string" ||
      typeof script.targetPath === "string";

    const explicitlyDisabled =
      script.isDisabled === true ||
      script.is_disabled === true ||
      script.disabled === true ||
      script.status === "disabled" ||
      script.installStatus === "disabled";

    const explicitlyActive =
      script.status === "active" ||
      script.installStatus === "active" ||
      script.active === true ||
      script.isActive === true ||
      script.is_active === true;

    return hasRealLocalReference && explicitlyActive && !explicitlyDisabled;
  });
}

export function isSidebarInstalledGame(game: LibraryGame): boolean {
  if ((game as any).hidden === true) return false;

  const steamInstalled = game.steamInstalled === true;

  const localInstalled =
    (game.source === "local" || game.source === "manual") &&
    typeof game.executablePath === "string" &&
    game.executablePath.length > 0;

  const explicitInstalledStatus =
    (game as any).installedStatus === "active" ||
    (game as any).installStatus === "active" ||
    (game as any).status === "installed";

  const luaActive = hasActiveInstalledLuaScript(game);

  // Provider-neutral installed check: Epic/GOG/Debrid (and future providers)
  // set isInstalled=true when the game exists on disk from any source.
  const providerNeutralInstalled =
    (game.source === "epic" || game.source === "gog" || game.source === "debrid") &&
    game.isInstalled === true;

  const included = Boolean(
    steamInstalled ||
    localInstalled ||
    explicitInstalledStatus ||
    luaActive ||
    providerNeutralInstalled
  );

  if (DEBUG_SIDEBAR_FILTER && game.appId) {
    console.log(
      `[SIDEBAR][INSTALLED_PREDICATE] appid=${game.appId} title="${game.title}" ` +
      `steamInstalled=${steamInstalled} localInstalled=${localInstalled} ` +
      `explicitInstalledStatus=${explicitInstalledStatus} luaActive=${luaActive} ` +
      `isPlayable=${!!game.isPlayable} isLuaActive=${!!game.isLuaActive} ` +
      `source=${game.source} included=${included}`
    );
  }
  if (game.source === "lua" && !included && game.appId) {
    if (!_sidebarFilteredLogged.has(game.appId)) {
      _sidebarFilteredLogged.add(game.appId);
      console.log(`[LUA][SIDEBAR_FILTERED_OUT] appId=${game.appId} title="${game.title}" hasLua=${game.hasLua} scripts=${game.luaScripts?.length ?? 0} luaActive=${luaActive} steamInstalled=${steamInstalled}`);
    }
  }

  return included;
}

export function getSidebarLabel(game: LibraryGame): string {
  const steamInstalled = game.steamInstalled === true;

  const localInstalled =
    (game.source === "local" || game.source === "manual") &&
    typeof game.executablePath === "string" &&
    game.executablePath.length > 0;

  const explicitInstalledStatus =
    (game as any).installedStatus === "active" ||
    (game as any).installStatus === "active" ||
    (game as any).status === "installed";

  const luaActive = hasActiveInstalledLuaScript(game);

  // Provider-neutral installed check for Epic/GOG/Debrid
  const providerNeutralInstalled =
    (game.source === "epic" || game.source === "gog" || game.source === "debrid") &&
    game.isInstalled === true;

  if (steamInstalled && luaActive) return "Steam + Lua";
  if (steamInstalled) return "Steam";
  if (luaActive) return "Lua";
  if (providerNeutralInstalled) {
    if (game.source === "epic") return "Epic";
    if (game.source === "debrid") return "Debrid";
    return "GOG";
  }
  if (localInstalled) return game.source === "manual" ? "Manual" : "Local";
  if (explicitInstalledStatus) return "Installed";

  return "Not installed";
}
export function dedupeLibraryGames(games: LibraryGame[]): LibraryGame[] {
  if (games.length <= 1) return games;
  const before = games.length;
  // Composite key: "appId:source" — entries with same appId but DIFFERENT source
  // are kept as separate entries (Steam, Debrid, Manual, Epic all coexist).
  // Merge only happens when both appId AND source match (e.g. Steam + Lua).
  const byKey = new Map<string, LibraryGame>();
  const noAppId: LibraryGame[] = [];

  function dedupKey(game: LibraryGame): string {
    return game.appId ? `${game.appId}:${game.source || "unknown"}` : "";
  }

  for (const game of games) {
    const key = dedupKey(game);
    if (!key) {
      // Games without appId — keep as-is but dedup by id
      if (!noAppId.find((g) => g.id === game.id)) {
        noAppId.push(game);
      }
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...game });
      continue;
    }
    // Merge happens only for same appId AND same source (Steam + Lua, etc.)
    const merged = { ...existing };

    // Boolean flags: true wins
    merged.steamInstalled = existing.steamInstalled || game.steamInstalled;
    merged.isPlayable = existing.isPlayable || game.isPlayable;
    merged.isInstallable = existing.isInstallable || game.isInstallable;
    merged.hasLua = existing.hasLua || game.hasLua;
    merged.isLuaActive = existing.isLuaActive || game.isLuaActive;
    merged.isLuaDisabled = existing.isLuaDisabled && game.isLuaDisabled;
    merged.hasLuaSource = existing.hasLuaSource || game.hasLuaSource;
    merged.isFavorite = existing.isFavorite || game.isFavorite;

    // Title: prefer non-placeholder
    if (game.title && !game.title.startsWith("Steam App ") && (existing.title.startsWith("Steam App ") || !existing.title)) {
      merged.title = game.title;
    }
    if (game.customTitle) merged.customTitle = game.customTitle || existing.customTitle;

    // Scripts & sources: union by app_id/path/file_name
    const seenScripts = new Set(existing.luaScripts.map((s) => `${s.app_id}:${s.path}:${s.file_name}`));
    merged.luaScripts = [...existing.luaScripts];
    for (const s of game.luaScripts || []) {
      const scriptKey = `${s.app_id}:${s.path}:${s.file_name}`;
      if (!seenScripts.has(scriptKey)) {
        seenScripts.add(scriptKey);
        merged.luaScripts.push(s);
      }
    }
    const seenSources = new Set(existing.sources.map((s) => `${s.providerId}:${s.fileType}:${s.downloadUrl}`));
    merged.sources = [...existing.sources];
    for (const s of game.sources || []) {
      const sourceKey = `${s.providerId}:${s.fileType}:${s.downloadUrl}`;
      if (!seenSources.has(sourceKey)) {
        seenSources.add(sourceKey);
        merged.sources.push(s);
      }
    }

    // Source: prefer "steam" over "lua" for the source field (steam is richer)
    if (game.source === "steam" || existing.source !== "steam") {
      merged.source = game.source;
    }

    // Media: prefer whichever has imageUrl
    if (!merged.imageUrl && game.imageUrl) merged.imageUrl = game.imageUrl;

    // Stats: pick latest/best values
    if (game.steamLastPlayedAt !== undefined) {
      merged.steamLastPlayedAt = Math.max(
        existing.steamLastPlayedAt ?? 0,
        game.steamLastPlayedAt,
      ) || undefined;
    }
    if (game.steamPlaytimeMinutes !== undefined) {
      merged.steamPlaytimeMinutes = Math.max(
        existing.steamPlaytimeMinutes ?? 0,
        game.steamPlaytimeMinutes,
      ) || undefined;
    }
    if (game.localLastPlayedAt !== undefined) {
      merged.localLastPlayedAt = Math.max(
        existing.localLastPlayedAt ?? 0,
        game.localLastPlayedAt,
      ) || undefined;
    }
    if (game.localPlaytimeMinutes !== undefined) {
      merged.localPlaytimeMinutes = Math.max(
        existing.localPlaytimeMinutes ?? 0,
        game.localPlaytimeMinutes,
      ) || undefined;
    }

    // Achievements: prefer richer
    if (!merged.achievementUnlocked && game.achievementUnlocked) merged.achievementUnlocked = game.achievementUnlocked;
    if (!merged.achievementTotal && game.achievementTotal) merged.achievementTotal = game.achievementTotal;
    if (!merged.achievementsSupported && game.achievementsSupported) merged.achievementsSupported = game.achievementsSupported;

    // Metadata: prefer one with metadata
    if (!merged.metadata && game.metadata) merged.metadata = game.metadata;

    // Executables: prefer one with more info
    if (!merged.executablePath && game.executablePath) merged.executablePath = game.executablePath;
    if (!merged.installDir && game.installDir) merged.installDir = game.installDir;
    if (!merged.libraryPath && game.libraryPath) merged.libraryPath = game.libraryPath;
    if (!merged.sizeOnDisk && game.sizeOnDisk) merged.sizeOnDisk = game.sizeOnDisk;
    if (!merged.lastUpdated && game.lastUpdated) merged.lastUpdated = game.lastUpdated;

    byKey.set(key, merged);
  }

  const result = [...byKey.values(), ...noAppId].sort((a, b) =>
    a.title.localeCompare(b.title),
  );
  const after = result.length;
  const removed = before - after;
  if (removed > 0) {
    console.log(`[LIBRARY][DEDUP] before=${before} after=${after} removed=${removed}`);
  }
  return result;
}

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
  mediaHealth?: MediaHealth;
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
      provider: "steam",
      appId: manifest.appid,
      coverPath: manifest.files.cover.exists ? normalizeMediaPathForIndex(manifest.files.cover.path) : null,
      coverUrl: manifest.files.cover.exists ? (urls.coverUrl ?? null) : null,
      hasCover: manifest.files.cover.exists,
      landscapePath: manifest.files.landscape.exists ? normalizeMediaPathForIndex(manifest.files.landscape.path) : null,
      landscapeUrl: manifest.files.landscape.exists ? (urls.landscapeUrl ?? null) : null,
      hasLandscape: manifest.files.landscape.exists,
      backgroundPath: manifest.files.background.exists ? normalizeMediaPathForIndex(manifest.files.background.path) : null,
      backgroundUrl: manifest.files.background.exists ? (urls.backgroundUrl ?? null) : null,
      hasBackground: manifest.files.background.exists,
      logoPath: manifest.files.logo.exists ? normalizeMediaPathForIndex(manifest.files.logo.path) : null,
      logoUrl: manifest.files.logo.exists ? (urls.logoUrl ?? null) : null,
      hasLogo: manifest.files.logo.exists,
      iconPath: manifest.files.icon.exists ? normalizeMediaPathForIndex(manifest.files.icon.path) : null,
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

const resolvedMediaSessionCache = new Map<string, CacheEntry<GameMediaPaths | null>>();

// Cache for converted src URLs (local path → asset:// URL)
// Prevents repeated convertFileSrc calls on the same path during a session
const resolvedSrcCache = new Map<string, string>();

const MEDIA_PATH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCachedResolvedMedia(appId: string): GameMediaPaths | null | undefined {
  const cached = resolvedMediaSessionCache.get(appId);
  if (cached && (Date.now() - cached.ts) < MEDIA_PATH_CACHE_TTL_MS) {
    return cached.value;
  }
  if (cached) {
    clearCachedGameMediaPaths(appId);
  }
  return undefined; // not in cache or stale
}

export function setCachedResolvedMedia(appId: string, value: GameMediaPaths | null): void {
  resolvedMediaSessionCache.set(appId, { value, ts: Date.now() });
}

// ── Phase 7: Cached game media paths — avoids repeated Tauri invokes ──
// All callers should use this instead of directly calling resolveGameMediaPaths.
export async function getCachedGameMediaPaths(appId: string): Promise<GameMediaPaths | null> {
  const cached = getCachedResolvedMedia(appId);
  if (cached !== undefined) {
    return cached;
  }
  const result = await resolveGameMediaPaths(appId).catch(() => null);
  if (result !== null) {
    setCachedResolvedMedia(appId, result);
  }
  return result;
}

export function clearCachedGameMediaPaths(appId?: string): void {
  if (appId) {
    resolvedMediaSessionCache.delete(appId);
  } else {
    resolvedMediaSessionCache.clear();
  }
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
  // Phase 8: Check SQLite first (cached, single invoke for all games)
  const sqliteName = await getSqliteName(appId);
  if (sqliteName && !isPlaceholderSteamTitle(sqliteName, appId)) {
    return sqliteName;
  }
  // Fallback: appinfo.json (session-cached)
  const appInfo = await getCachedGameAppInfo(appId);
  if (appInfo?.name && !isPlaceholderSteamTitle(appInfo.name, appId)) {
    return appInfo.name;
  }
  return fillCanonicalName(appId);
}

async function fillCanonicalName(appId: string): Promise<string | null> {
  const { resolveGameMetadata } = await import("./gameMetadataResolver");
  const appInfo = await getCachedGameAppInfo(appId);
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
    // Preserve existing media fields — never wipe media when updating name
    const existing = await getCachedGameAppInfo(appId);
    const media = existing?.media ?? null;
    const remote = existing?.remote ?? null;
    const mediaSources = existing?.mediaSources ?? null;
    console.log(`[NAME][CANONICAL_WRITE_SAFE] appid=${appId} name=${resolvedName} source=${source} preserveMedia=${!!media}`);
    updateGameAppinfoMediaIfChanged(
      appId, resolvedName,
      media ?? { coverPath: null, backgroundPath: null, logoPath: null, iconPath: null, landscapePath: null },
      remote, mediaSources,
      "fillCanonicalName",
    ).catch(() => { });
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
    setCachedResolvedMedia(g.appId, hasAny ? media : null);
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
  return getCachedGameAppInfo(appId);
}

// Load appinfo and validate all media paths against disk.
// Always does a disk check once per session per appId.
// Session-caches the validated paths so repeated calls are instant.
// Writes corrected appinfo.json when stale paths are detected.
// When allowRepair=false (default), reads existing data without any repair/write.
export async function loadGameAppInfoWithMediaFallback(appId: string, options?: { allowRepair?: boolean; repairSource?: MediaRepairSource }): Promise<GameAppInfo | null> {
  const allowRepair = options?.allowRepair ?? false;
  const repairSource = options?.repairSource;
  if (!allowRepair) {
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) console.log(`[MEDIA][READ_ONLY] appid=${appId}`);
  } else {
    if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][REPAIR_ALLOWED] appid=${appId} source=${repairSource ?? "unspecified"}`);
  }
  // Session cache hit — return appinfo with validated paths merged.
  // If cache has insufficient media (missing background/logo/icon), fall through to repair.
  const cached = getCachedResolvedMedia(appId);
  if (cached !== undefined) {
    if (cached && !(cached.backgroundPath || cached.logoPath || cached.iconPath)) {
      clearCachedGameMediaPaths(appId);
    } else {
      const appInfo = await getCachedGameAppInfo(appId);
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
            setCachedResolvedMedia(appId, resolved);
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
            setCachedResolvedMedia(appId, resolved);
            return { appId, provider: "steam", name: null, updatedAt: null, media: resolved, mediaSources: null, remote: null, userData: null };
          }
        }
        return { appId, provider: "steam", name: null, updatedAt: null, media: cached, mediaSources: null, remote: null, userData: null };
      }
      return null;
    }
  }

  // Read appinfo.json from disk (session-cached)
  let appInfo = await getCachedGameAppInfo(appId);

  // Stale path repair: detect and clear role-path mismatches on read
  // (e.g. coverPath=media/landscape.jpg caused by the old Rust reclassifier).
  // Only clears paths that point to a WRONG role's filename prefix (e.g. a
  // cover field pointing to a file starting with "landscape.").  Filenames
  // that don't match any role prefix (e.g. "library_hero.jpg" from Steam CDN)
  // are left as-is — they are legitimate CDN-original names.
  // When repair is allowed, persist the corrected state to disk so subsequent
  // reads don't re-detect the same mismatch.
  if (appInfo?.media) {
    const ROLE_FIELD_MAP: Record<string, string> = {
      coverPath: "cover.",
      landscapePath: "landscape.",
      backgroundPath: "background.",
      logoPath: "logo.",
      iconPath: "icon.",
    };
    const ALL_PREFIXES = new Set(Object.values(ROLE_FIELD_MAP));
    const clearedFields: string[] = [];
    for (const [field, expectedPrefix] of Object.entries(ROLE_FIELD_MAP)) {
      const path = (appInfo.media as any)[field] as string | null | undefined;
      if (path && typeof path === "string") {
        const filename = path.replace(/\\/g, "/").split("/").pop() ?? "";
        // Only flag as mismatch if the filename matches a DIFFERENT role's
        // prefix.  If it doesn't match ANY role prefix it's a legitimate
        // CDN-original name (e.g. library_hero.jpg, header.jpg) and should
        // NOT be cleared.
        const matchesWrongRole = [...ALL_PREFIXES].some(
          p => p !== expectedPrefix && filename.startsWith(p),
        );
        if (matchesWrongRole) {
          console.log(`[MEDIA_ROLE_REPAIR] appid=${appId} cleared ${field}=${path} reason=role-path-mismatch-on-read expected=${expectedPrefix}*`);
          (appInfo.media as any)[field] = null;
          clearedFields.push(field);
        }
      }
    }
    if (clearedFields.length === 0 && ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
      console.log(`[MEDIA_ROLE_REPAIR_VERBOSE] appid=${appId} reason=no-role-mismatch-detected`);
    }
    // Persist the repair to disk ALWAYS (regardless of allowRepair) so that
    // the stale role-path does not contaminate future appinfo reads, manifest
    // comparisons, or download queues.  Without this persist, the corrected
    // in-memory state is lost on cache invalidation / page navigation, and
    // the stale path re-appears.
    if (clearedFields.length > 0) {
      await updateGameAppinfoMediaIfChanged(
        appId,
        appInfo.name ?? null,
        appInfo.media,
        appInfo.remote ?? null,
        appInfo.mediaSources ?? null,
        "role-repair",
      ).catch(() => {});
      generateMediaManifest(appId, appInfo.media).catch(() => {});
      console.log(`[MEDIA_ROLE_REPAIR_WRITE] appid=${appId} cleared=${clearedFields.join(",")}`);
      // Invalidate session cache so the next consumer reads corrected state from disk
      _sessionAppinfoCache.delete(appId);
    }
  }

  // Validate all paths against disk (once per session) — only when repair is allowed
  if (allowRepair && !isAppInfoRepaired(appId)) {
    try {
      // First, fix any misclassified media files (e.g. vertical landscape.jpg)
      // so the file names match actual image orientation before scanning disk paths.
      await repairMediaRoles(appId).catch(() => { });
      // Then repair stale paths AND add disk-only paths in appinfo.json
      // This updates appinfo on disk. We re-read appInfo afterward.
      await repairAppinfoMediaPaths(appId).catch(() => { });

      // Re-read appinfo after repair (it may have been updated with disk paths)
      _sessionAppinfoCache.delete(appId);
      const repairedAppInfo = await getCachedGameAppInfo(appId);
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
            await updateGameAppinfoMediaIfChanged(appId, name, validatedMedia, remote, mediaSources, "loadGameAppInfoWithMediaFallback").catch(() => { });
            invalidateCanonicalMediaCache(appId);
            notifyMediaUpdated(appId).catch(() => { });
          }
        }

        // Resolve relative paths to absolute for the session cache (UI uses these)
        const resolvedForCache = await resolveMediaPaths(appId, validatedMedia);
        setCachedResolvedMedia(appId, resolvedForCache);
        if (appInfo) {
          appInfo.media = resolvedForCache;
          return appInfo;
        }
        const fallbackName = (appInfo as GameAppInfo | null)?.name ?? null;
        if (hasDiskFiles) {
          return { appId, provider: "steam", name: fallbackName, updatedAt: null, media: resolvedForCache, mediaSources: null, remote: null, userData: null };
        }
      }
    } catch {
      // non-critical — disk check failed, fall through to appinfo
    }
  }

  // After repair (or when repair was already done this session), re-check disk
  // for new background/logo/icon files (only when repair is allowed)
  if (allowRepair && appInfo?.media && (!appInfo.media.backgroundPath || !appInfo.media.logoPath || !appInfo.media.iconPath)) {
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

          await updateGameAppinfoMediaIfChanged(appId, appInfo.name, updatedMedia, appInfo.remote, appInfo.mediaSources, "loadGameAppInfoWithMediaFallback-postRepair").catch(() => { });
          invalidateCanonicalMediaCache(appId);
          notifyMediaUpdated(appId).catch(() => { });

          const resolvedForCache = await resolveMediaPaths(appId, updatedMedia);
          setCachedResolvedMedia(appId, resolvedForCache);
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
      setCachedResolvedMedia(appId, resolved);
    }
  }
  return appInfo ?? null;
}

// Clear the session cache (e.g. after artwork refresh)
export function clearResolvedMediaSessionCache(): void {
  clearCachedGameMediaPaths();
  resolvedSrcCache.clear();
}

// Invalidate cache for a specific appId (e.g. after a media download updates appinfo)
export function invalidateResolvedMediaCache(appId: string): void {
  clearCachedGameMediaPaths(appId);
  // resolvedSrcCache keys are raw filesystem paths (not appIds), so we must
  // clear the entire cache. convertFileSrc() is cheap so this is safe.
  resolvedSrcCache.clear();
  if (ENABLE_VERBOSE_GAME_CACHE_LOGS) console.log(`[MEDIA][SRC_CACHE_CLEAR] reason=media-invalidated appid=${appId}`);
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
  if (entry.data) {
    const metadataJson = typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data);
    updateGameMetadataJson(appId, metadataJson);
  }
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

  // Update canonical appinfo — merge with existing to preserve other roles
  try {
    const existing = await getCachedGameAppInfo(appId);
    const mergedMedia = {
      landscapePath: paths.landscapePath ?? existing?.media?.landscapePath ?? null,
      coverPath: paths.coverPath ?? existing?.media?.coverPath ?? null,
      backgroundPath: paths.backgroundPath ?? existing?.media?.backgroundPath ?? null,
      logoPath: paths.logoPath ?? existing?.media?.logoPath ?? null,
      iconPath: paths.iconPath ?? existing?.media?.iconPath ?? null,
    };
    await updateGameAppinfoMediaIfChanged(
      appId,
      name ?? existing?.name ?? null,
      mergedMedia,
      existing?.remote ?? null,
      existing?.mediaSources ?? null,
      "cacheAppInfoMedia",
    );
    // Update media_manifest.json to reflect current files on disk
    generateMediaManifest(appId, mergedMedia).catch(() => {});
  } catch {
    // non-critical
  }

  // Invalidate session cache to force re-read on next access
  invalidateResolvedMediaCache(appId);

  // Notify snapshot service so startup-snapshot.json picks up new paths
  invalidateCanonicalMediaCache(appId);
  notifyMediaUpdated(appId).catch(() => { });

  // Re-seed resolved media session cache with current appinfo paths so that
  // subsequent reads during the snapshot write window see fresh data rather
  // than re-populating from an intermediate disk state.
  try {
    const freshAppInfo = await getCachedGameAppInfo(appId);
    if (freshAppInfo?.media) {
      const resolved = await resolveMediaPaths(appId, freshAppInfo.media);
      if (resolved) {
        setCachedResolvedMedia(appId, resolved);
        if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
          const roleCount = Object.values(resolved).filter(Boolean).length;
          console.log(`[MEDIA][SESSION_CACHE_RESEED] appid=${appId} roles=${roleCount}`);
        }
      }
    }
  } catch {
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) {
      console.log(`[MEDIA][SESSION_CACHE_RESEED_SKIP] appid=${appId} reason=resolve-failed`);
    }
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
// detectAndQueueMissingMedia — scan actual disk files and queue low-priority
// downloads for roles whose files are missing from disk but have a source URL
// available (from resolveGameMedia remote fallback or mediaSources).
// Returns the list of roles that were queued for download.
// ---------------------------------------------------------------------------

export type MediaRepairSource =
  | "local-media-repair"
  | "manual-refresh-artwork"
  | "game-details-visible-repair"
  | "store-display"
  | "dashboard-display"
  | "browse-display"
  | "metadata-display"
  | "boot-hydration"
  // Legacy aliases kept for backward compat
  | "visible-details"
  | "refresh-artwork"
  | "global"
  | "boot";

// ── Source alias helpers ──
const DISPLAY_ONLY_SOURCES = new Set([
  "store-display", "dashboard-display", "browse-display", "metadata-display",
]);

const MANUAL_ARTWORK_SOURCES = new Set(["manual-refresh-artwork", "refresh-artwork"]);

const VISIBLE_REPAIR_SOURCES = new Set(["game-details-visible-repair", "visible-details"]);

const GLOBAL_REPAIR_SOURCES = new Set(["global", "boot", "boot-hydration", "local-media-repair"]);

export function isDisplayOnlySource(source: MediaRepairSource): boolean {
  return DISPLAY_ONLY_SOURCES.has(source);
}

export function isManualArtworkSource(source: MediaRepairSource): boolean {
  return MANUAL_ARTWORK_SOURCES.has(source);
}

export function isVisibleRepairSource(source: MediaRepairSource): boolean {
  return VISIBLE_REPAIR_SOURCES.has(source);
}

export function isGlobalRepairSource(source: MediaRepairSource): boolean {
  return GLOBAL_REPAIR_SOURCES.has(source);
}

export function isStoreRouteActive(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hash.startsWith("#/store") || window.location.pathname.includes("store");
}

// ---------------------------------------------------------------------------
// Type definitions for MediaIndex source tracking
// ---------------------------------------------------------------------------

export type MediaIndexSource =
  | "local-media-repair"
  | "manual-refresh-artwork"
  | "game-details-visible-repair"
  | "store-display"
  | "dashboard-display"
  | "browse-display"
  | "metadata-display"
  | "boot-hydration"
  | "unknown";

export type MediaIndexUpdate = {
  appId: string;
  changed: boolean;
  changedFields: number;
  source: MediaIndexSource;
};

export function createMediaIndexUpdate(
  appId: string,
  changedFields: number,
  source: MediaIndexSource,
): MediaIndexUpdate {
  return {
    appId,
    changed: changedFields > 0,
    changedFields,
    source,
  };
}

// ── Pending uninstall state (in-memory only, reactive via useSyncExternalStore) ──
const _pendingUninstallAppIds = new Map<string, { timer: ReturnType<typeof setTimeout>; timestamp: number }>();
const UNINSTALL_PENDING_TTL_MS = 5 * 60 * 1000;
const UNINSTALL_PENDING_SCAN_TTL_MS = 45_000; // 45 seconds — cleared by scan when still installed
let _pendingUninstallVersion = 0;
const _pendingUninstallListeners = new Set<() => void>();

function _notifyPendingUninstallChanged(): void {
  _pendingUninstallVersion++;
  _pendingUninstallListeners.forEach(cb => cb());
}

export function subscribePendingUninstall(callback: () => void): () => void {
  _pendingUninstallListeners.add(callback);
  return () => { _pendingUninstallListeners.delete(callback); };
}

export function getPendingUninstallVersion(): number {
  return _pendingUninstallVersion;
}

export function markPendingUninstall(appId: string): void {
  const existing = _pendingUninstallAppIds.get(appId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    _pendingUninstallAppIds.delete(appId);
    _notifyPendingUninstallChanged();
    console.log(`[UNINSTALL_PENDING] appid=${appId} phase=clear reason=timeout`);
  }, UNINSTALL_PENDING_TTL_MS);
  _pendingUninstallAppIds.set(appId, { timer, timestamp: Date.now() });
  _notifyPendingUninstallChanged();
  console.log(`[UNINSTALL_PENDING] appid=${appId} phase=start`);
}

export function clearPendingUninstall(appId: string): void {
  const existing = _pendingUninstallAppIds.get(appId);
  if (existing) {
    clearTimeout(existing.timer);
    _pendingUninstallAppIds.delete(appId);
    _notifyPendingUninstallChanged();
  }
}

export function isPendingUninstall(appId: string): boolean {
  return _pendingUninstallAppIds.has(appId);
}

export function getPendingUninstallTimestamp(appId: string): number | null {
  return _pendingUninstallAppIds.get(appId)?.timestamp ?? null;
}

export function getUninstallPendingScanTtl(): number {
  return UNINSTALL_PENDING_SCAN_TTL_MS;
}

export async function detectAndQueueMissingMedia(appId: string, source: MediaRepairSource = "visible-details"): Promise<string[]> {
  // No-source-url cooldown — skip repair if recently found no source URLs.
  // Must be at the very top to prevent repeated disk scans and AUTO_REPAIR_SCAN logs.
  if (isNoSourceCooldown(appId)) {
    if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][AUTO_REPAIR_COOLDOWN] appid=${appId} reason=no-source-url`);
    return [];
  }

  // Phase 10: Defer media repair during active interaction (scroll/click/nav)
  if (isInteractionBusy()) {
    if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][AUTO_REPAIR_DEFER] appid=${appId} reason=interaction-busy`);
    return [];
  }

  // Defer media repair during active navigation to avoid competing
  // with route transitions for disk I/O.
  if (isRecentlyNavigated(2000)) {
    console.log(`[MEDIA][AUTO_REPAIR_DEFER] appid=${appId} reason=navigation-active`);
    return [];
  }

  // Block display-only sources immediately — no disk check, no metadata fetch, no enqueue
  if (isDisplayOnlySource(source)) {
    console.log(`[MEDIA][DISPLAY_SOURCE_SKIP] appid=${appId} source=${source}`);
    return [];
  }

  // Skip if Store route is active — prevents media index updates during Store navigation
  if (isStoreRouteActive()) {
    return [];
  }

  // Skip system/tool apps (Steamworks Redistributables, Proton, etc.)
  if (isSystemToolApp(appId)) {
    if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][AUTO_REPAIR_SKIP] appid=${appId} reason=system-tool`);
    return [];
  }

  // Emergency stabilization: only visible-details and manual refresh-artwork
  // should auto-repair. Global/boot repair is disabled.
  if (!isVisibleRepairSource(source) && !isManualArtworkSource(source)) {
    logGlobalRepairSkipOnce();
    return [];
  }

  const missing: string[] = [];
  const roles = ["cover", "landscape", "background", "logo", "icon"] as const;

  const { resolveGameMediaPaths } = await import("./tauri");
  const diskPaths = await resolveGameMediaPaths(appId).catch(() => null);

  if (!diskPaths) return missing;

  // Determine which roles are missing from disk
  for (const role of roles) {
    const pathKey = `${role}Path` as keyof typeof diskPaths;
    if (!diskPaths[pathKey]) {
      missing.push(role);
    }
  }

  if (missing.length === 0) return missing;

  if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][AUTO_REPAIR_SCAN] appid=${appId} missing=${missing.join(",")}`);

  // ── Source resolution ─────────────────────────────────────────────────────
  // 1. Load game metadata (Steam Store API) for remote URLs (background, logo)
  // 2. Try SGDB artwork if settings configured
  // 3. Build game-like object and pass to resolveGameMedia with appinfo

  const appIdNum = Number(appId);
  const hasValidId = appIdNum && !isNaN(appIdNum);

  // Resolve game metadata from Steam Store (cached in-memory + disk)
  let gameMeta: Record<string, any> | undefined;
  if (hasValidId) {
    try {
      const { resolveGameMetadata } = await import("./gameMetadataResolver");
      const metaMap = await resolveGameMetadata([appIdNum]);
      const meta = metaMap[appIdNum];
      if (meta?.resolved) {
        gameMeta = meta as unknown as Record<string, any>;
      }
    } catch { }
  }

  // Try SGDB artwork if settings available
  let sgdbArtwork: Record<string, string | undefined> | undefined;
  try {
    const { loadSettings } = await import("../context/SettingsContext");
    const settings = await loadSettings() as Record<string, any>;
    const sgdbEnabled = settings.steamGridDbArtworkEnabled && !!settings.steamGridDbApiKey;
    if (sgdbEnabled && hasValidId) {
      const { resolveArtworkForAppIds } = await import("./storeArtworkResolver");
      const result = await resolveArtworkForAppIds([appIdNum], settings.steamGridDbApiKey);
      const entry = result[appId];
      if (entry) {
        sgdbArtwork = {
          landscape: entry.sgdbGridUrl || entry.sgdbGridThumbUrl || entry.sgdbHeroUrl,
          cover: entry.sgdbCoverUrl,
          background: entry.sgdbHeroUrl,
          logo: entry.sgdbLogoUrl,
          icon: entry.sgdbIconUrl,
        };
      }
    }
  } catch { }

  const appInfo = await getCachedGameAppInfo(appId);

  // Use resolveGameDetailsArtwork (→ resolveMediaByPriority) instead of the
  // old resolveGameMedia which had incorrect role mapping (e.g. using capsule
  // images for landscape).  This ensures the same corrected candidate selection
  // as manual Refresh Artwork.
  const bundle = resolveGameDetailsArtwork(
    appId,
    appInfo?.media ?? null,
    gameMeta as SteamAppMetadata | null | undefined,
    gameMeta?.capsule_image as string | null | undefined,
    null,
  );

  const { enqueueMediaDownload } = await import("./mediaDownloadQueue");
  const queuedRoles: string[] = [];

  for (const role of missing) {
    // Priority chain: SGDB → bundle (Steam CDN → metadata → screenshots) → mediaSources
    // SGDB provides curated, role-specific artwork (hero, grid, cover, logo, icon).
    let sourceUrl: string | null = null;
    let sourceReason = "";

    // Priority 1: SGDB artwork (curated, role-specific)
    if (sgdbArtwork?.[role]) {
      sourceUrl = sgdbArtwork[role] ?? null;
      sourceReason = "sgdb";
    }

    // Priority 2: resolveGameDetailsArtwork bundle (Steam CDN + metadata + screenshots)
    if (!sourceUrl) {
      const asset = (bundle as any)[role] as { url?: string; source?: string } | undefined;
      if (asset?.url && /^https?:\/\//i.test(asset.url)) {
        sourceUrl = asset.url;
        sourceReason = asset.source ?? "resolveGameDetailsArtwork";
      }
    }

    // Priority 2b: game metadata directly for roles the bundle may not cover
    if (!sourceUrl && gameMeta) {
      if (role === "logo" && (gameMeta.library_logo_image || gameMeta.logo_image)) {
        sourceUrl = (gameMeta.library_logo_image || gameMeta.logo_image) as string;
        sourceReason = "game-metadata";
      }
    }

    // Priority 3: mediaSources (user-configured)
    if (!sourceUrl && appInfo?.mediaSources) {
      const msUrl = (appInfo.mediaSources as Record<string, string | null>)[role];
      if (msUrl) {
        sourceUrl = msUrl;
        sourceReason = "mediaSources";
      }
    }

    if (sourceUrl) {
      queuedRoles.push(role);
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][AUTO_REPAIR_QUEUE] appid=${appId} role=${role} source=${sourceReason} priority=low`);
      enqueueMediaDownload({
        id: `auto-repair-${appId}-${role}`,
        appId,
        provider: "steam",
        mediaType: role as any,
        url: sourceUrl,
        target: "canonical",
        priority: "low",
      }).catch(() => { });
    } else {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][AUTO_REPAIR_FAILED] appid=${appId} role=${role} reason=no-source-url`);
    }
  }

  // ── Update media health metadata ──
  const isComplete = missing.length === 0;
  const health: MediaHealth = {
    complete: isComplete,
    checkedAt: Date.now(),
    missing: queuedRoles.length > 0 ? queuedRoles : missing.filter((r) => !queuedRoles.includes(r)),
  };
  if (queuedRoles.length > 0) {
    health.lastRepairAttemptAt = Date.now();
    if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][AUTO_REPAIR_DONE] appid=${appId} queued=${queuedRoles.join(",")}`);
  } else if (missing.length > 0 && queuedRoles.length === 0) {
    health.lastRepairAttemptAt = Date.now();
    health.lastRepairError = "no-source-url";
  }
  setMediaHealth(appId, health);
  if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][HEALTH_UPDATE] appid=${appId} complete=${isComplete} missing=${missing.length} error=${health.lastRepairError ?? "null"}`);

  return queuedRoles;
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

export function safeLocalPathToUrl(path: string): string | null {
  // Only callers with file-existence-validated paths should reach this.
  // This helper ensures the path is safe to convert (not tmp, not relative).
  if (isHttpUrl(path)) return path;
  if (isTmpPath(path)) {
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) console.log(`[MEDIA][LOCAL_URL_SKIP] reason=tmp-file path=${path}`);
    return null;
  }
  if (path.startsWith("media/") || path.startsWith("img/")) {
    if (ENABLE_VERBOSE_GAME_CACHE_LOGS) console.log(`[MEDIA][LOCAL_URL_SKIP] reason=relative-path path=${path}`);
    return null;
  }
  return localPathToUrl(path);
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

/**
 * Resolve a provider-relative media path (e.g. "games/manual/<id>/media/cover.jpg")
 * to an asset:// URL suitable for <img src>.
 *
 * The input is a path relative to the app data root — it is NOT a path relative
 * to the game directory (that's what resolveRelativeMediaPath handles).
 *
 * Returns null when the path is empty, already an HTTP URL, or cannot be resolved.
 */

// ---------------------------------------------------------------------------
// Extension-aware provider media file resolution
// ---------------------------------------------------------------------------

const DEBUG_EPIC_SURFACES = false;

/** Module-level cache for directory listing results. Maps provider+game → files. */
const _mediaDirCache = new Map<string, { files: ProviderMediaFileEntry[]; ts: number }>();
const MEDIA_DIR_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Module-level cache for resolved absolute paths. Maps relative path → absolute or null. */
const _roleFileResolveCache = new Map<string, { abs: string | null; ts: number }>();
const ROLE_FILE_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * List all files in a provider+game media directory via a single batched IPC call.
 * Caches results for 5 minutes.
 */
async function listMediaDirFiles(
  providerId: string,
  providerGameId: string,
): Promise<ProviderMediaFileEntry[]> {
  const key = `${providerId}:${providerGameId}`;
  const cached = _mediaDirCache.get(key);
  if (cached && Date.now() - cached.ts < MEDIA_DIR_CACHE_TTL_MS) {
    return cached.files;
  }
  try {
    const files = await listProviderMediaFiles(providerId, providerGameId);
    _mediaDirCache.set(key, { files, ts: Date.now() });
    return files;
  } catch {
    return [];
  }
}

/**
 * Invalidate the media directory cache for a specific game.
 */
export function invalidateMediaDirCache(providerId?: string, providerGameId?: string): void {
  if (!providerId || !providerGameId) {
    _mediaDirCache.clear();
    return;
  }
  _mediaDirCache.delete(`${providerId}:${providerGameId}`);
}

/**
 * Select the best file for a given role from a list of directory entries.
 *
 * Deterministic priority:
 * 1. Stored override path (if provided and valid — file exists on disk)
 * 2. Last successful saved path from override store
 * 3. Newest valid candidate (by modification time, largest size wins ties)
 * 4. Stable extension fallback (png > jpg > jpeg > webp)
 *
 * Filters out: zero-byte files, .tmp files, non-image extensions.
 */
function selectBestRoleFile(
  role: string,
  files: ProviderMediaFileEntry[],
  storedPath?: string | null,
): ProviderMediaFileEntry | null {
  const roleFiles = files.filter(
    (f) =>
      f.role === role &&
      f.sizeBytes > 0 &&
      !f.filename.endsWith(".tmp") &&
      ROLE_EXTENSION_CANDIDATES.includes(f.extension),
  );
  if (roleFiles.length === 0) return null;

  // Priority 1: stored override path — exact match
  if (storedPath) {
    const storedFilename = storedPath.replace(/\\/g, "/").split("/").pop();
    const storedMatch = roleFiles.find((f) => f.filename === storedFilename);
    if (storedMatch) return storedMatch;
    // Also try with extension stripped (in case stored path has wrong ext)
    const storedBase = storedFilename?.replace(/\.[^.]+$/, "");
    if (storedBase) {
      const baseMatch = roleFiles.find((f) => f.filename.startsWith(storedBase + "."));
      if (baseMatch) return baseMatch;
    }
  }

  // Priority 2+3: newest by modification time, largest wins ties
  const sorted = [...roleFiles].sort((a, b) => {
    const aTime = a.modifiedAt ?? 0;
    const bTime = b.modifiedAt ?? 0;
    if (aTime !== bTime) return bTime - aTime; // newest first
    return b.sizeBytes - a.sizeBytes; // largest first for same timestamp
  });

  // Priority 4: extension fallback order (png > jpg > jpeg > webp)
  for (const ext of ROLE_EXTENSION_CANDIDATES) {
    const match = sorted.find((f) => f.extension === ext);
    if (match) return match;
  }

  return sorted[0] ?? null;
}

/**
 * Resolve a provider media role file with extension-aware filesystem scanning.
 *
 * Given a relative path like "games/epic/.../media/landscape.png":
 * 1. If the exact file exists on disk → return its absolute path
 * 2. If not, scan the media directory for alternate extensions
 * 3. Select the best match deterministically
 * 4. Return the absolute path of the resolved file, or null
 *
 * When the stored path is valid (file exists), it always wins.
 * Scans only happen when the stored path is missing, stale, empty, or undecodable.
 */
export async function resolveProviderMediaRoleFile(
  relativePath: string | null | undefined,
): Promise<string | null> {
  if (!relativePath) return null;
  if (isHttpUrl(relativePath)) return relativePath;
  if (relativePath.startsWith("asset://") || relativePath.startsWith("data:") || relativePath.startsWith("file://")) return relativePath;

  // Already absolute
  if (/^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith("/")) {
    return localPathToUrl(relativePath) ?? relativePath;
  }

  // Parse the path to get provider + game info
  const parsed = parseProviderMediaComponents(relativePath);
  if (!parsed) {
    // Can't parse — fall through to raw path construction
    return null;
  }

  // Check resolve cache
  const cached = _roleFileResolveCache.get(relativePath);
  if (cached && Date.now() - cached.ts < ROLE_FILE_CACHE_TTL_MS) {
    return cached.abs;
  }

  const base = await getAppDataBase();
  if (!base) return null;
  const sep = base.includes("\\") ? "\\" : "/";
  const toAbsolute = (rel: string) =>
    `${base}${base.endsWith(sep) ? "" : sep}${rel.replace(/\//g, sep)}`;

  // Priority 1: check if the exact stored path exists on disk
  const exactAbs = toAbsolute(relativePath);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const exists = await invoke<boolean>("file_exists", { path: exactAbs });
    if (exists) {
      _roleFileResolveCache.set(relativePath, { abs: exactAbs, ts: Date.now() });
      if (DEBUG_EPIC_SURFACES) {
        console.debug("[MEDIA][ROLE_FILE] exact path exists", { relativePath, abs: exactAbs });
      }
      return exactAbs;
    }
  } catch {
    // Fall through to directory scan
  }

  // Priority 2: scan directory for alternate extensions
  const files = await listMediaDirFiles(parsed.providerId, parsed.providerGameId);
  if (files.length === 0) {
    _roleFileResolveCache.set(relativePath, { abs: null, ts: Date.now() });
    return null;
  }

  const role = parsed.role;
  if (!role) {
    _roleFileResolveCache.set(relativePath, { abs: null, ts: Date.now() });
    return null;
  }

  const best = selectBestRoleFile(role, files, relativePath);
  if (!best) {
    _roleFileResolveCache.set(relativePath, { abs: null, ts: Date.now() });
    return null;
  }

  const resolvedAbs = toAbsolute(best.relativePath);
  _roleFileResolveCache.set(relativePath, { abs: resolvedAbs, ts: Date.now() });
  if (DEBUG_EPIC_SURFACES) {
    console.debug("[MEDIA][ROLE_FILE] resolved via scan", {
      input: relativePath,
      resolved: best.relativePath,
      role: best.role,
      ext: best.extension,
      size: best.sizeBytes,
    });
  }
  return resolvedAbs;
}

/**
 * Resolve a provider media role file when NO stored path exists.
 * Scans the media directory for any file matching the role.
 *
 * Used for auto-discovery when an override doesn't exist yet.
 * Returns the relative path from app data root, or null.
 */
export async function discoverProviderMediaRoleFile(
  providerId: string,
  providerGameId: string,
  role: MediaRole,
): Promise<string | null> {
  const files = await listMediaDirFiles(providerId, providerGameId);
  if (files.length === 0) return null;

  const best = selectBestRoleFile(role, files, null);
  if (!best) return null;

  if (DEBUG_EPIC_SURFACES) {
    console.debug("[MEDIA][DISCOVER]", {
      provider: providerId,
      game: providerGameId,
      role,
      found: best.relativePath,
      ext: best.extension,
      size: best.sizeBytes,
    });
  }
  return best.relativePath;
}

/**
 * Discover all 5 media roles for a provider+game in one batch.
 * Returns a record mapping each role to its relative path (or null).
 * Used by auto-discovery to populate overrides from existing disk files.
 */
export async function discoverAllProviderMediaRoles(
  providerId: string,
  providerGameId: string,
): Promise<Partial<Record<MediaRole, string>>> {
  const files = await listMediaDirFiles(providerId, providerGameId);
  if (files.length === 0) return {};

  const roles: MediaRole[] = ["cover", "landscape", "background", "logo", "icon"];
  const result: Partial<Record<MediaRole, string>> = {};

  for (const role of roles) {
    const best = selectBestRoleFile(role, files, null);
    if (best) {
      result[role] = best.relativePath;
    }
  }
  return result;
}

export async function resolveProviderMediaPreviewUrl(
  relativePath: string | null | undefined,
): Promise<string | null> {
  if (!relativePath) return null;
  if (isHttpUrl(relativePath)) return relativePath;
  if (relativePath.startsWith("asset://") || relativePath.startsWith("data:") || relativePath.startsWith("file://")) return relativePath;
  // Already absolute?
  if (/^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith("/")) {
    return localPathToUrl(relativePath);
  }
  // Extension-aware resolution: check exact path, scan alternate extensions
  const resolved = await resolveProviderMediaRoleFile(relativePath);
  if (resolved && resolved !== relativePath) {
    // File found at a different path (different extension)
    return localPathToUrl(resolved);
  }
  // Exact path didn't resolve to a different file — try raw construction
  const base = await getAppDataBase();
  if (!base) return null;
  const sep = base.includes("\\") ? "\\" : "/";
  const abs = `${base}${base.endsWith(sep) ? "" : sep}${relativePath.replace(/\//g, sep)}`;
  return localPathToUrl(abs);
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

/** In-flight dedup: prevents duplicate manifest writes for the same appId. */
const _mediaManifestWriteInFlight = new Map<string, Promise<void>>();

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
  if (import.meta.env.DEV && ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
    console.log(`[MEDIA][MANIFEST_PROVIDER] appid=${appId} gameProvider=steam artworkSource=${provider} manifestProvider=${provider}`);
  }
  const entryForRole = (role: string): { path: string; exists: boolean; size: number | null; modifiedAt: number | null } => {
    const relPath = media[`${role}Path` as keyof typeof media] as string | null;
    const existsKey = `${role}Exists` as keyof GameMediaPathsResult;
    const pathKey = `${role}Path` as keyof GameMediaPathsResult;
    if (resolved) {
      const exists = !!(resolved[existsKey] as boolean);
      const resolvedPath = resolved[pathKey] as string | null;
      const bestPath = resolvedPath ?? relPath;
      const normalized = bestPath ? normalizeMediaPathForIndex(bestPath) : null;
      const manifestPath = normalized ?? `media/${role}.jpg`;
      if (import.meta.env.DEV && ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
        const inputRelPath = relPath ?? "(null)";
        console.log(`[MEDIA][MANIFEST_VALIDATE] appid=${appId} role=${role} relPath=${inputRelPath} resolvedPath=${resolvedPath ?? "(null)"} manifestPath=${manifestPath} exists=${exists}`);
      }
      return { path: manifestPath, exists, size: null, modifiedAt: null };
    }
    if (!relPath) {
      return { path: `media/${role}.jpg`, exists: false, size: null, modifiedAt: null };
    }
    const normalized = normalizeMediaPathForIndex(relPath);
    return { path: normalized ?? `media/${role}.jpg`, exists: false, size: null, modifiedAt: null };
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

  // Part 2: In-flight dedup — if a write for this appId is already running, await it
  const existingInFlight = _mediaManifestWriteInFlight.get(appId);
    if (existingInFlight) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][MANIFEST_SKIP] appid=${appId} reason=in-flight`);
      await existingInFlight;
    return;
  }

  // Part 3: Content comparison — read existing manifest and skip if unchanged
  let existing: MediaManifest | null = null;
  try {
    existing = await readMediaManifestTauri(appId);
  } catch {
    existing = null;
  }
  if (existing) {
    const sameProvider = existing.provider === manifest.provider;
    const sameCover = existing.files.cover.path === manifest.files.cover.path && existing.files.cover.exists === manifest.files.cover.exists;
    const sameLandscape = existing.files.landscape.path === manifest.files.landscape.path && existing.files.landscape.exists === manifest.files.landscape.exists;
    const sameBackground = existing.files.background.path === manifest.files.background.path && existing.files.background.exists === manifest.files.background.exists;
    const sameLogo = existing.files.logo.path === manifest.files.logo.path && existing.files.logo.exists === manifest.files.logo.exists;
    const sameIcon = existing.files.icon.path === manifest.files.icon.path && existing.files.icon.exists === manifest.files.icon.exists;
    if (sameProvider && sameCover && sameLandscape && sameBackground && sameLogo && sameIcon) {
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][MANIFEST_SKIP] appid=${appId} reason=no-content-change`);
      return;
    }
  }

  // Track in-flight
  const writePromise = (async () => {
    try {
      await writeMediaManifestTauri(appId, manifest);
      if (import.meta.env.DEV && ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
        const roleLog = (r: string, f: { path: string; exists: boolean }) => `role=${r} path=${f.path} exists=${f.exists}`;
        console.log(`[MEDIA][MANIFEST_WRITE] appid=${appId} ${roleLog("cover", manifest.files.cover)} ${roleLog("landscape", manifest.files.landscape)} ${roleLog("background", manifest.files.background)} ${roleLog("logo", manifest.files.logo)} ${roleLog("icon", manifest.files.icon)}`);
      } else {
        console.log(`[MEDIA][MANIFEST] written appid=${appId} coverPath=${manifest.files.cover.path} landscapePath=${manifest.files.landscape.path} backgroundPath=${manifest.files.background.path} logoPath=${manifest.files.logo.path} iconPath=${manifest.files.icon.path}`);
      }
    } finally {
      _mediaManifestWriteInFlight.delete(appId);
    }
  })();
  _mediaManifestWriteInFlight.set(appId, writePromise);
  await writePromise;
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
    }, "steam");
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
  const { readCanonicalAppinfos, resolveGameMediaPathsBatch } = await import("./tauri");
  // Phase 2+5: Batch-read all appinfos and disk paths in 2 Tauri calls instead of 2*N per-app invokes.
  const [batchDiskPaths, batchAppInfos] = await Promise.all([
    resolveGameMediaPathsBatch(appIds),
    readCanonicalAppinfos(appIds),
  ]);
  console.log(`[PERF][BOOT_BATCH] appIds=${appIds.length} appinfoBatch=true manifestsBatch=true mediaPathsBatch=true`);
  let updatedAppInfos = 0;
  let withBackground = 0;
  let withLandscape = 0;
  let withIcon = 0;
  let withLogo = 0;
  let consecutiveSkipped = 0;
  for (const appId of appIds) {
    try {
      // Quick pre-check: skip if this appId's MediaIndex already has all roles filled
      // (seeded from manifests during Stage 6). No disk scan on skip.
      const existingEntry = getMediaEntry(appId);
      const entryComplete = existingEntry && existingEntry.hasLandscape && existingEntry.hasCover
        && existingEntry.hasBackground && existingEntry.hasLogo && existingEntry.hasIcon;
      if (entryComplete) {
        consecutiveSkipped++;
        if (consecutiveSkipped >= 5) {
          // All remaining games in this batch are likely already synced — stop early
          console.log(`[MEDIA_HYDRATE][BATCH_SKIP] reason=all-apps-already-synced appIds=${appIds.length} processed=${updatedAppInfos}`);
          break;
        }
        continue;
      }
      consecutiveSkipped = 0;

      const diskPaths = batchDiskPaths[appId];
      if (!diskPaths) continue;
      const hasDiskFiles = !!(diskPaths.landscapePath || diskPaths.coverPath || diskPaths.backgroundPath || diskPaths.logoPath || diskPaths.iconPath);
      if (!hasDiskFiles) continue;
      const appInfo = batchAppInfos[appId];
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

      // Compare with existing normalized media; skip no-op writes
      const normalizedMerged = {
        backgroundPath: merged.backgroundPath,
        iconPath: merged.iconPath,
        logoPath: merged.logoPath,
        landscapePath: merged.landscapePath,
        coverPath: merged.coverPath,
      };
      const existingNormalized = {
        backgroundPath: existing?.backgroundPath ?? null,
        iconPath: existing?.iconPath ?? null,
        logoPath: existing?.logoPath ?? null,
        landscapePath: existing?.landscapePath ?? null,
        coverPath: existing?.coverPath ?? null,
      };
      const hasChange = Object.keys(normalizedMerged).some(
        (k) => (normalizedMerged as any)[k] !== (existingNormalized as any)[k],
      );
      if (!hasChange) {
        if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA_HYDRATE][SKIP] appid=${appId} reason=already-synced`);
        continue;
      }

      const changedFields = Object.keys(normalizedMerged).filter(
        (k) => (normalizedMerged as any)[k] !== (existingNormalized as any)[k],
      ).length;
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA_HYDRATE][WRITE] appid=${appId} changedFields=${changedFields}`);

      // Preserve existing name, remote, and mediaSources
      await updateGameAppinfoMediaIfChanged(
        appId,
        appInfo.name ?? null,
        merged as any,
        appInfo.remote ?? null,
        appInfo.mediaSources ?? null,
        "hydrateMediaOnStartup",
      ).catch(() => { });
      if (merged.backgroundPath) withBackground++;
      if (merged.landscapePath) withLandscape++;
      if (merged.iconPath) withIcon++;
      if (merged.logoPath) withLogo++;
      updatedAppInfos++;
      if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
        console.log(`[MEDIA][HYDRATE] appid=${appId} found background=${!!diskPaths.backgroundPath} cover=${!!diskPaths.coverPath} icon=${!!diskPaths.iconPath} landscape=${!!diskPaths.landscapePath} logo=${!!diskPaths.logoPath}`);
        console.log(`[MEDIA][HYDRATE] appid=${appId} updatedFields=${Object.values(merged).filter(Boolean).length}`);
      }
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
  if (updatedAppInfos > 0) {
    console.log(`[BOOT][MEDIA_HYDRATE] games=${appIds.length}`);
    console.log(`[BOOT][MEDIA_HYDRATE] updatedAppInfos=${updatedAppInfos}`);
    console.log(`[BOOT][MEDIA_HYDRATE] withBackground=${withBackground}`);
    console.log(`[BOOT][MEDIA_HYDRATE] withLandscape=${withLandscape}`);
    console.log(`[BOOT][MEDIA_HYDRATE] withIcon=${withIcon}`);
    console.log(`[BOOT][MEDIA_HYDRATE] withLogo=${withLogo}`);
  }
  return { updatedAppInfos, withBackground, withLandscape, withIcon, withLogo };
}

/* ── Media priority resolver (moved from features/media/resolveGameMediaByPriority) ──
 *
 * Resolve the best available media for each role using a priority chain.
 * All data should be pre-fetched by the caller — this is synchronous, no API calls.
 */

type MediaSourcesCacheEntry = { url: string; source: GameMediaSource; localPath?: string };
type MediaSourcesCache = Partial<Record<string, MediaSourcesCacheEntry>>;

export type MediaResolutionOptions = {
  useSteamGridDb?: boolean;
  useSteamAppDetails?: boolean;
  useIgdb?: boolean;
  useRawg?: boolean;
  preferDirectVideo?: boolean;
};

export type MediaResolutionInputs = {
  appId: string;
  provider?: string;
  localPaths?: {
    coverPath?: string | null;
    landscapePath?: string | null;
    backgroundPath?: string | null;
    logoPath?: string | null;
    iconPath?: string | null;
  };
  metadata?: SteamAppMetadata | null;
  sgdbArtwork?: SgdbArtworkData | null;
  rawgData?: RawgArtworkData | null;
  igdbData?: IgdbArtworkData | null;
  imageUrl?: string | null;
  cachedSources?: MediaSourcesCache | null;
  options?: MediaResolutionOptions;
};

type AssetCandidate = {
  url: string;
  source: GameMediaSource;
  kind: GameMediaKind;
  localPath?: string;
  width?: number;
  height?: number;
};

function asset(
  kind: GameMediaKind,
  source: GameMediaSource,
  url: string | null | undefined,
  localPath?: string | null,
): AssetCandidate | undefined {
  if (!url) return undefined;
  return { kind, source, url, localPath: localPath ?? undefined };
}

function pickFirst(chain: (AssetCandidate | undefined | null | false | string)[]): ResolvedGameMediaAsset | undefined {
  for (const c of chain) {
    if (c && typeof c === "object" && "url" in c && c.url) {
      return { appId: "", kind: c.kind, source: c.source, url: c.url, localPath: c.localPath, cachedAt: Date.now() };
    }
  }
  return undefined;
}

function pickUrl(...urls: (string | null | undefined)[]): string | undefined {
  for (const u of urls) { if (u) return u; }
  return undefined;
}

function isStorePageBackground(url: string): boolean {
  return /store_page_background/i.test(url) || /storepagebackground/i.test(url);
}

function pickBackgroundUrl(...urls: (string | null | undefined)[]): string | undefined {
  for (const u of urls) { if (u && !isStorePageBackground(u)) return u; }
  return pickUrl(...urls);
}

function fromMetadata(m: SteamAppMetadata, kind: GameMediaKind): AssetCandidate | undefined {
  switch (kind) {
    case "cover":
      return asset("cover", "steam-appdetails", pickUrl(m.capsule_image_v5, m.capsule_image, m.header_image));
    case "landscape":
      return asset("landscape", "steam-appdetails", pickUrl(m.header_image, m.library_hero_image, m.wide_cover_image));
    case "background":
      return asset("background", "steam-appdetails", pickBackgroundUrl(
        m.library_hero_image, m.hero_image, m.header_image,
        m.wide_cover_image, m.capsule_image, m.capsule_image_v5, m.background_image,
      ));
    case "logo":
      return asset("logo", "steam-appdetails", pickUrl(m.logo_image, m.library_logo_image));
    default:
      return undefined;
  }
}

function fromSgdb(a: SgdbArtworkData, kind: GameMediaKind): AssetCandidate | undefined {
  switch (kind) {
    case "cover": return a.sgdbCoverUrl ? asset("cover", "steamgriddb", a.sgdbCoverUrl) : undefined;
    case "landscape": return a.sgdbGridUrl ? asset("landscape", "steamgriddb", a.sgdbGridUrl) : undefined;
    case "background": return a.sgdbHeroUrl ? asset("background", "steamgriddb", a.sgdbHeroUrl) : undefined;
    case "logo": return a.sgdbLogoUrl ? asset("logo", "steamgriddb", a.sgdbLogoUrl) : undefined;
    case "icon": return a.sgdbIconUrl ? asset("icon", "steamgriddb", a.sgdbIconUrl) : undefined;
    default: return undefined;
  }
}

function fromScreenshots(screenshots: string[] | undefined, kind: GameMediaKind): AssetCandidate | undefined {
  if (!screenshots || screenshots.length === 0) return undefined;
  if (kind === "landscape" || kind === "background") return asset(kind, "steam-appdetails", screenshots[0]);
  return undefined;
}

function fromRawg(a: RawgArtworkData | undefined | null, kind: GameMediaKind): AssetCandidate | undefined {
  if (!a?.rawgBackgroundUrl) return undefined;
  if (kind === "background") return asset("background", "rawg", a.rawgBackgroundUrl);
  return undefined;
}

function fromIgdb(a: IgdbArtworkData | undefined | null, kind: GameMediaKind): AssetCandidate | undefined {
  if (!a) return undefined;
  switch (kind) {
    case "cover": return a.igdbCoverUrl ? asset("cover", "igdb", a.igdbCoverUrl) : undefined;
    case "background": return a.igdbArtworkUrl ? asset("background", "igdb", a.igdbArtworkUrl) : undefined;
    default: return undefined;
  }
}

function fromCachedSource(cached: MediaSourcesCache | undefined | null, kind: GameMediaKind): AssetCandidate | undefined {
  if (!cached) return undefined;
  const entry = cached[kind];
  if (!entry) return undefined;
  return { kind, source: entry.source, url: entry.url, localPath: entry.localPath };
}

const DEBUG_MEDIA_ROLE_MAP = false;

export function buildSteamCdnUrl(appId: string, kind: "header" | "hero" | "logo" | "capsule" | "cover"): string | null {
  const id = parseInt(appId, 10);
  if (!id || isNaN(id) || id <= 0) return null;
  const base = `https://steamcdn-a.akamaihd.net/steam/apps/${id}`;
  switch (kind) {
    case "header": return `${base}/header.jpg`;
    case "hero": return `${base}/library_hero.jpg`;
    case "logo": return `${base}/logo.png`;
    case "capsule": return `${base}/capsule_616x353.jpg`;
    case "cover": return `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`;
    default: return null;
  }
}

function logSteamRoleMap(appId: string, meta: SteamAppMetadata | null | undefined): void {
  if (!DEBUG_MEDIA_ROLE_MAP || !meta) return;
  console.log(`[MEDIA_ROLE_MAP] appid=${appId} header=${meta.header_image ?? "(null)"} capsule=${meta.capsule_image ?? "(null)"} capsule_v5=${meta.capsule_image_v5 ?? "(null)"} hero=${meta.hero_image ?? "(null)"} library_hero=${meta.library_hero_image ?? "(null)"} logo=${meta.logo_image ?? "(null)"} library_logo=${meta.library_logo_image ?? "(null)"}`);
}

function logMediaSelect(appId: string, role: string, source: string, url: string): void {
  if (!DEBUG_MEDIA_ROLE_MAP) return;
  const label = url.includes("library_hero") ? "steam-cdn-hero"
    : url.includes("capsule_616x353") ? "steam-cdn-capsule"
    : url.includes("header.jpg") && !url.includes("capsule") ? "steam-cdn-header"
    : url.includes("logo.png") ? "steam-cdn-logo"
    : source;
  console.log(`[MEDIA_SELECT] appid=${appId} role=${role} source=${label} url=${url}`);
}

function fromSteamCdn(appId: string, meta: SteamAppMetadata | null | undefined, kind: GameMediaKind): AssetCandidate | undefined {
  // Skip the generic CDN URL only when a game-specific asset field exists
  // that provides the SAME type of image.  header_image is a capsule-like
  // image, NOT a wide header — do not skip CDN header.jpg for it.
  if (meta) {
    switch (kind) {
      case "background": if (meta.library_hero_image || meta.hero_image) return undefined; break;
      case "logo":       if (meta.logo_image || meta.library_logo_image) return undefined; break;
      case "cover":      break; // library_600x900.jpg is distinct from horizontal capsule; always try
      case "landscape":  if (meta.library_header_image) return undefined; break;
    }
  }
  // Return the generic Steam CDN URL even when meta is null (e.g. Lua-only
  // game with no resolved Steam metadata).  The CDN will 404 for invalid
  // appIds, but that is handled gracefully by the download queue.
  switch (kind) {
    case "background": return asset("background", "steam-appdetails", buildSteamCdnUrl(appId, "hero"));
    case "logo":       return asset("logo", "steam-appdetails", buildSteamCdnUrl(appId, "logo"));
    case "cover":      return asset("cover", "steam-appdetails", buildSteamCdnUrl(appId, "cover"));
    case "landscape":  return asset("landscape", "steam-appdetails", buildSteamCdnUrl(appId, "header"));
    case "icon":       return undefined;
    default:           return undefined;
  }
}

function resolveCover(
  appId: string,
  localPaths: MediaResolutionInputs["localPaths"],
  cached: MediaSourcesCache | undefined | null,
  sgdb: SgdbArtworkData | undefined | null,
  _rawg: RawgArtworkData | undefined | null,
  igdb: IgdbArtworkData | undefined | null,
  meta: SteamAppMetadata | undefined | null,
  imageUrl: string | undefined | null,
  opts?: MediaResolutionOptions,
): ResolvedGameMediaAsset | undefined {
  // library_600x900.jpg is Steam's native vertical poster — preferred over
  // SGDB/IGDB when available.
  const result = pickFirst([
    localPaths?.coverPath && asset("cover", "local", localPaths.coverPath),
    cached && fromCachedSource(cached, "cover"),
    fromSteamCdn(appId, meta, "cover"),
    sgdb && opts?.useSteamGridDb !== false && fromSgdb(sgdb, "cover"),
    igdb && opts?.useIgdb !== false && fromIgdb(igdb, "cover"),
    imageUrl && asset("cover", "steam-appdetails", imageUrl),
  ]);
  if (result) logMediaSelect(appId, "cover", result.source, result.url!);
  return result;
}

function resolveLandscape(
  appId: string,
  localPaths: MediaResolutionInputs["localPaths"],
  cached: MediaSourcesCache | undefined | null,
  sgdb: SgdbArtworkData | undefined | null,
  _rawg: RawgArtworkData | undefined | null,
  igdb: IgdbArtworkData | undefined | null,
  meta: SteamAppMetadata | undefined | null,
  opts?: MediaResolutionOptions,
): ResolvedGameMediaAsset | undefined {
  const result = pickFirst([
    localPaths?.landscapePath && asset("landscape", "local", localPaths.landscapePath),
    cached && fromCachedSource(cached, "landscape"),
    fromSteamCdn(appId, meta, "landscape"),
    meta && opts?.useSteamAppDetails !== false && fromMetadata(meta, "landscape"),
    meta && opts?.useSteamAppDetails !== false && fromScreenshots(meta.screenshots, "landscape"),
    sgdb && opts?.useSteamGridDb !== false && fromSgdb(sgdb, "landscape"),
    igdb && opts?.useIgdb !== false && fromIgdb(igdb, "landscape"),
  ]);
  if (result) logMediaSelect(appId, "landscape", result.source, result.url!);
  return result;
}

function resolveBackground(
  appId: string,
  localPaths: MediaResolutionInputs["localPaths"],
  cached: MediaSourcesCache | undefined | null,
  sgdb: SgdbArtworkData | undefined | null,
  rawg: RawgArtworkData | undefined | null,
  igdb: IgdbArtworkData | undefined | null,
  meta: SteamAppMetadata | undefined | null,
  landscapeFallback: ResolvedGameMediaAsset | undefined,
  opts?: MediaResolutionOptions,
): ResolvedGameMediaAsset | undefined {
  const result = pickFirst([
    localPaths?.backgroundPath && asset("background", "local", localPaths.backgroundPath),
    cached && fromCachedSource(cached, "background"),
    fromSteamCdn(appId, meta, "background"),
    meta && opts?.useSteamAppDetails !== false && fromMetadata(meta, "background"),
    meta && opts?.useSteamAppDetails !== false && fromScreenshots(meta.screenshots, "background"),
    sgdb && opts?.useSteamGridDb !== false && fromSgdb(sgdb, "background"),
    rawg && opts?.useRawg !== false && fromRawg(rawg, "background"),
    igdb && opts?.useIgdb !== false && fromIgdb(igdb, "background"),
    landscapeFallback && asset("background", landscapeFallback.source, landscapeFallback.url!),
  ]);
  if (result) logMediaSelect(appId, "background", result.source, result.url!);
  return result;
}

function resolveLogo(
  appId: string,
  localPaths: MediaResolutionInputs["localPaths"],
  cached: MediaSourcesCache | undefined | null,
  sgdb: SgdbArtworkData | undefined | null,
  meta: SteamAppMetadata | undefined | null,
  opts?: MediaResolutionOptions,
): ResolvedGameMediaAsset | undefined {
  const result = pickFirst([
    localPaths?.logoPath && asset("logo", "local", localPaths.logoPath),
    cached && fromCachedSource(cached, "logo"),
    fromSteamCdn(appId, meta, "logo"),
    meta && opts?.useSteamAppDetails !== false && fromMetadata(meta, "logo"),
    sgdb && opts?.useSteamGridDb !== false && fromSgdb(sgdb, "logo"),
  ]);
  if (result) logMediaSelect(appId, "logo", result.source, result.url!);
  return result;
}

function resolveIcon(
  appId: string,
  localPaths: MediaResolutionInputs["localPaths"],
  cached: MediaSourcesCache | undefined | null,
  sgdb: SgdbArtworkData | undefined | null,
  meta: SteamAppMetadata | undefined | null,
  opts?: MediaResolutionOptions,
): ResolvedGameMediaAsset | undefined {
  const result = pickFirst([
    localPaths?.iconPath && asset("icon", "local", localPaths.iconPath),
    cached && fromCachedSource(cached, "icon"),
    fromSteamCdn(appId, meta, "icon"),
    sgdb && opts?.useSteamGridDb !== false && fromSgdb(sgdb, "icon"),
  ]);
  if (result) logMediaSelect(appId, "icon", result.source, result.url!);
  return result;
}

function resolveTrailers(
  meta: SteamAppMetadata | undefined | null,
  opts?: MediaResolutionOptions,
): ResolvedGameTrailer[] {
  return resolveGameTrailers(meta?.movies, opts?.preferDirectVideo !== false);
}

export function resolveMediaByPriority(inputs: MediaResolutionInputs): ResolvedGameMediaBundle {
  const { appId, localPaths, metadata: meta, sgdbArtwork: sgdb, rawgData: rawg, igdbData: igdb, imageUrl, cachedSources: cached, options: opts } = inputs;

  logSteamRoleMap(appId, meta);

  const cover = resolveCover(appId, localPaths, cached, sgdb, rawg, igdb, meta, imageUrl, opts);
  const landscape = resolveLandscape(appId, localPaths, cached, sgdb, rawg, igdb, meta, opts);
  const background = resolveBackground(appId, localPaths, cached, sgdb, rawg, igdb, meta, landscape, opts);
  const logo = resolveLogo(appId, localPaths, cached, sgdb, meta, opts);
  const icon = resolveIcon(appId, localPaths, cached, sgdb, meta, opts);
  const trailers = resolveTrailers(meta, opts);

  const bundle: ResolvedGameMediaBundle = { appId };
  if (cover) bundle.cover = { ...cover, appId };
  if (landscape) bundle.landscape = { ...landscape, appId };
  if (background) bundle.background = { ...background, appId };
  if (logo) bundle.logo = { ...logo, appId };
  if (icon) bundle.icon = { ...icon, appId };
  if (trailers.length > 0) bundle.trailers = trailers;
  return bundle;
}

/* ── Sync-first, async-refresh artwork resolver (moved from features/media/resolveGameDetailsArtwork) ── */

const _NETWORK_IN_FLIGHT = new Set<string>();
const _DEBUG_LIBRARY_MEDIA_FALLBACK = false;
const _DEBUG_MEDIA_APPID = "4717430";
const _DEBUG_MEDIA_APPID_ENABLED = false;

function _isDebugAppId(appId: string): boolean {
  return _DEBUG_MEDIA_APPID_ENABLED && appId === _DEBUG_MEDIA_APPID;
}

function _logArtwork(appId: string, msg: string) {
  if (_DEBUG_LIBRARY_MEDIA_FALLBACK) console.log(`[LIBRARY_MEDIA_FALLBACK] appid=${appId} ${msg}`);
}

function _logSkip(appId: string, provider: string, reason: string) {
  if (_DEBUG_LIBRARY_MEDIA_FALLBACK) console.log(`[LIBRARY_MEDIA_FALLBACK][SKIP_PROVIDER] appid=${appId} provider=${provider} reason=${reason}`);
}

function _debugLog(appId: string, tag: string, msg: string) {
  if (_isDebugAppId(appId)) console.log(`[LIB_MEDIA_DEBUG][${tag}] appid=${appId} ${msg}`);
}

export type GameDetailsMediaOptions = {
  sgdbApiKey?: string;
  sgdbEnabled?: boolean;
  rawgApiKey?: string;
  igdbClientId?: string;
  igdbClientSecret?: string;
  useSteamGridDb?: boolean;
  useRawg?: boolean;
  useIgdb?: boolean;
};

/* ── Sync: local + cache + metadata only ── */

export function resolveGameDetailsArtwork(
  appId: string,
  localPaths: MediaResolutionInputs["localPaths"] | undefined | null,
  metadata: SteamAppMetadata | undefined | null,
  imageUrl: string | undefined | null,
  cachedSources?: Record<string, any> | null,
): ResolvedGameMediaBundle {
  _debugLog(appId, "START", `localPaths= ${JSON.stringify(localPaths)}`);
  _debugLog(appId, "LOCAL", `background=${localPaths?.backgroundPath ?? "(null)"} logo=${localPaths?.logoPath ?? "(null)"}`);

  const hasCached = cachedSources !== undefined && cachedSources !== null;
  const cachedBg = cachedSources?.background?.url ?? "(null)";
  const cachedLogo = cachedSources?.logo?.url ?? "(null)";
  _debugLog(appId, "SIDECAR_READ", `exists=${hasCached} background=${cachedBg} logo=${cachedLogo}`);

  const metaKeys = metadata ? Object.keys(metadata).join(",") : "(null)";
  _debugLog(appId, "STEAM_METADATA", `hasMetadata=${!!metadata} keys=${metaKeys}`);
  _debugLog(appId, "STEAM_METADATA_VALUES", `background_image=${metadata?.background_image ?? "(null)"} header_image=${metadata?.header_image ?? "(null)"} logo_image=${metadata?.logo_image ?? "(null)"} library_logo_image=${metadata?.library_logo_image ?? "(null)"} library_hero_image=${metadata?.library_hero_image ?? "(null)"}`);

  const inputs: MediaResolutionInputs = {
    appId,
    localPaths: localPaths ?? undefined,
    metadata: metadata ?? undefined,
    imageUrl: imageUrl ?? undefined,
    cachedSources: cachedSources ?? undefined,
    options: { useSteamGridDb: false, useRawg: false, useIgdb: false, useSteamAppDetails: true },
  };

  const bundle = resolveMediaByPriority(inputs);

  const roles: GameMediaKind[] = ["cover", "landscape", "background", "logo", "icon"];
  for (const role of roles) {
    const asset = (bundle as any)[role] as { source?: GameMediaSource; url?: string } | undefined;
    _logArtwork(appId, `role=${role} source=${asset?.source ?? "none"}`);
  }

  _debugLog(appId, "FINAL", `background=${(bundle as any)?.background?.url ?? "(null)"} logo=${(bundle as any)?.logo?.url ?? "(null)"} sourceBackground=${(bundle as any)?.background?.source ?? "(null)"} sourceLogo=${(bundle as any)?.logo?.source ?? "(null)"}`);

  return bundle;
}

/* ── Async: network providers (SGDB → RAWG → IGDB) ── */

export async function refreshGameDetailsArtwork(
  appId: string,
  localPaths: MediaResolutionInputs["localPaths"] | undefined | null,
  metadata: SteamAppMetadata | undefined | null,
  imageUrl: string | undefined | null,
  cachedSources: Record<string, any> | null,
  options: GameDetailsMediaOptions,
): Promise<{ bundle: ResolvedGameMediaBundle; changed: boolean }> {
  const key = `network:${appId}`;
  if (_NETWORK_IN_FLIGHT.has(key)) {
    const bundle = resolveGameDetailsArtwork(appId, localPaths, metadata, imageUrl, cachedSources);
    return { bundle, changed: false };
  }
  _NETWORK_IN_FLIGHT.add(key);

  try {
    const appIdNum = Number(appId);
    if (isNaN(appIdNum)) {
      const bundle = resolveGameDetailsArtwork(appId, localPaths, metadata, imageUrl, cachedSources);
      return { bundle, changed: false };
    }

    // Verify local paths against actual disk — filter out stale appinfo paths
    let verifiedLocalPaths = localPaths;
    if (localPaths) {
      try {
        const diskPaths = await resolveGameMediaPaths(appId);
        if (diskPaths) {
          let hasChange = false;
          const verified = { ...localPaths };
          const roles = ["coverPath", "landscapePath", "backgroundPath", "logoPath", "iconPath"] as const;
          for (const key of roles) {
            if (localPaths[key] && !diskPaths[key]) {
              const role = key.replace("Path", "");
              verified[key] = null;
              hasChange = true;
              if (DEBUG_MEDIA_ROLE_MAP) console.log(`[MEDIA_STALE] appid=${appId} role=${role} path=${localPaths[key]} reason=file-missing`);
            }
          }
          if (hasChange) {
            const nonEmpty = Object.values(verified).some(v => !!v);
            verifiedLocalPaths = nonEmpty ? verified : null;
            _debugLog(appId, "STALE", `filtered relative paths (disk check)`);
          }
        }
      } catch {
        _debugLog(appId, "STALE", "disk-check-failed - trusting appinfo paths");
      }
    }

    const sgdbSettingEnabled = options?.sgdbEnabled === true;
    const sgdbHasKey = !!options?.sgdbApiKey;
    const shouldCallSgdb = options?.useSteamGridDb !== false && sgdbSettingEnabled && sgdbHasKey;
    let sgdbData = undefined as { sgdbCoverUrl?: string; sgdbGridUrl?: string; sgdbHeroUrl?: string; sgdbLogoUrl?: string; sgdbIconUrl?: string } | null | undefined;
    _debugLog(appId, "SGDB", `enabled=${sgdbSettingEnabled} hasApiKey=${sgdbHasKey} called=${!!shouldCallSgdb}${!shouldCallSgdb ? ` reason=${!sgdbSettingEnabled ? "disabled" : !sgdbHasKey ? "missing-api-key" : ""}` : ""}`);
    if (shouldCallSgdb) {
      try {
        const { resolveArtworkForAppIds } = await import("./storeArtworkResolver");
        const results = await resolveArtworkForAppIds([appIdNum], options.sgdbApiKey!);
        sgdbData = results[appId] ?? null;
        _debugLog(appId, "SGDB", `resultBackground=${sgdbData?.sgdbHeroUrl ?? "(null)"} resultLogo=${sgdbData?.sgdbLogoUrl ?? "(null)"}`);
        if (sgdbData) _logArtwork(appId, `role=* source=steamgriddb`);
      } catch (e) { _debugLog(appId, "SGDB", `error=${e}`); }
    } else {
      _logSkip(appId, "steamgriddb", !options?.sgdbEnabled ? "disabled" : !options?.sgdbApiKey ? "missing-api-key" : "");
    }

    const rawgHasKey = !!options?.rawgApiKey;
    const shouldCallRawg = options?.useRawg !== false && rawgHasKey;
    _debugLog(appId, "RAWG", `hasApiKey=${rawgHasKey} called=${!!shouldCallRawg}${!shouldCallRawg ? ` reason=${!rawgHasKey ? "missing-api-key" : ""}` : ""}`);
    let rawgData = undefined;
    if (shouldCallRawg) {
      try {
        const { fetchRawgArtworkDeduped } = await import("./storeArtworkResolver");
        rawgData = await fetchRawgArtworkDeduped({ apiKey: options.rawgApiKey!, appId });
        _debugLog(appId, "RAWG", `resultBackground=${(rawgData as any)?.rawgBackgroundUrl ?? "(null)"}`);
      } catch (e) { _debugLog(appId, "RAWG", `error=${e}`); }
    } else {
      _logSkip(appId, "rawg", !options?.rawgApiKey ? "missing-api-key" : "disabled");
    }

    const igdbHasCredentials = !!options?.igdbClientId && !!options?.igdbClientSecret;
    const shouldCallIgdb = options?.useIgdb !== false && igdbHasCredentials;
    _debugLog(appId, "IGDB", `hasCredentials=${igdbHasCredentials} called=${!!shouldCallIgdb}${!shouldCallIgdb ? ` reason=${!igdbHasCredentials ? "missing-credentials" : ""}` : ""}`);
    let igdbData = undefined;
    if (shouldCallIgdb) {
      try {
        const { fetchIgdbArtworkDeduped } = await import("./storeArtworkResolver");
        igdbData = await fetchIgdbArtworkDeduped({ clientId: options.igdbClientId!, clientSecret: options.igdbClientSecret!, appId });
        _debugLog(appId, "IGDB", `resultBackground=${(igdbData as any)?.igdbArtworkUrl ?? "(null)"} resultCover=${(igdbData as any)?.igdbCoverUrl ?? "(null)"}`);
      } catch (e) { _debugLog(appId, "IGDB", `error=${e}`); }
    } else {
      _logSkip(appId, "igdb", !options?.igdbClientId || !options?.igdbClientSecret ? "missing-credentials" : "disabled");
    }

    const inputs: MediaResolutionInputs = {
      appId,
      localPaths: verifiedLocalPaths ?? undefined,
      metadata: metadata ?? undefined,
      imageUrl: imageUrl ?? undefined,
      cachedSources: cachedSources ?? undefined,
      sgdbArtwork: sgdbData ?? undefined,
      rawgData,
      igdbData,
      options: { useSteamGridDb: true, useRawg: true, useIgdb: true, useSteamAppDetails: true },
    };

    const bundle = resolveMediaByPriority(inputs);
    const prev = resolveGameDetailsArtwork(appId, verifiedLocalPaths, metadata, imageUrl, cachedSources);

    let changed = false;
    const roles: GameMediaKind[] = ["cover", "landscape", "background", "logo", "icon"];
    for (const role of roles) {
      const prevUrl = (prev as any)[role]?.url;
      const newUrl = (bundle as any)[role]?.url;
      if (prevUrl !== newUrl) { changed = true; break; }
    }

    for (const role of roles) {
      const asset = (bundle as any)[role] as { source?: GameMediaSource; url?: string } | undefined;
      _logArtwork(appId, `role=${role} source=${asset?.source ?? "none"}`);
    }

    _debugLog(appId, "FINAL", `background=${(bundle as any)?.background?.url ?? "(null)"} logo=${(bundle as any)?.logo?.url ?? "(null)"} sourceBackground=${(bundle as any)?.background?.source ?? "(null)"} sourceLogo=${(bundle as any)?.logo?.source ?? "(null)"}`);

    return { bundle, changed };
  } finally {
    _NETWORK_IN_FLIGHT.delete(key);
  }
}

// ---------------------------------------------------------------------------
// materializeResolvedGameMedia — bridge resolved bundle → disk check → enqueue
// ---------------------------------------------------------------------------

const DEBUG_MATERIALIZE = false;

const MATERIALIZE_ROLES: GameMediaKind[] = ["cover", "landscape", "background", "logo", "icon"];

const ROLE_TO_FILENAME: Record<GameMediaKind, string> = {
  cover: "media/cover.jpg",
  landscape: "media/landscape.jpg",
  background: "media/background.jpg",
  logo: "media/logo.png",
  icon: "media/icon.png",
  screenshot: "media/screenshot.jpg",
  trailer: "",
};

const _inFlightMaterialize = new Set<string>();

function mLog(appId: string, msg: string) {
  if (DEBUG_MATERIALIZE) console.log(`[MEDIA_MATERIALIZE] appid=${appId} ${msg}`);
}

export type MaterializeResult = {
  diskHits: GameMediaKind[];
  enqueued: GameMediaKind[];
  skipped: GameMediaKind[];
  bundle: ResolvedGameMediaBundle;
};

export async function materializeResolvedGameMedia(
  appId: string,
  bundle: ResolvedGameMediaBundle,
  provider: string = "steam",
  options?: {
    onDiskCheck?: GameMediaPaths | null;
    skipDownload?: boolean;
  },
): Promise<MaterializeResult> {
  const diskHits: GameMediaKind[] = [];
  const enqueued: GameMediaKind[] = [];
  const skipped: GameMediaKind[] = [];
  const updated: ResolvedGameMediaBundle = { ...bundle };

  if (!appId) {
    mLog(appId, "skip no-appId");
    return { diskHits, enqueued, skipped, bundle };
  }
  if (bundle.appId && bundle.appId !== appId) {
    mLog(appId, `skip cross-app-bundle bundleAppId=${bundle.appId}`);
    console.log(`[MEDIA_MATERIALIZE][GUARD] appId=${appId} bundleAppId=${bundle.appId} reason=cross-app-bundle`);
    return { diskHits, enqueued, skipped, bundle };
  }

  let diskState: GameMediaPaths | null = options?.onDiskCheck ?? null;
  if (!diskState) {
    try {
      diskState = await resolveGameMediaPaths(appId);
    } catch {
      mLog(appId, "disk-check-failed");
      diskState = null;
    }
  }

  mLog(appId, `start roles=${MATERIALIZE_ROLES.filter((r) => (bundle as any)[r]?.url).join(",")} disk=${diskState ? "ok" : "unavailable"}`);

  for (const kind of MATERIALIZE_ROLES) {
    const asset: ResolvedGameMediaAsset | undefined = (updated as any)[kind];
    if (!asset?.url) continue;

    const filename = ROLE_TO_FILENAME[kind];
    if (!filename) continue;

    const existsOnDisk = diskState?.[`${kind}Path` as keyof GameMediaPaths];
    if (existsOnDisk) {
      asset.localPath = filename;
      diskHits.push(kind);
      mLog(appId, `disk-hit role=${kind} localPath=${filename}`);
      continue;
    }

    if (asset.source === "local" && asset.url && !/^https?:\/\//i.test(asset.url)) {
      mLog(appId, `stale-relative-skip role=${kind} url=${asset.url} reason=file-missing-and-not-http`);
      console.log(`[MEDIA_STALE][DETECTED] appid=${appId} role=${kind} path=${asset.url} reason=file-missing-local-path`);
      continue;
    }

    const inflightKey = `${appId}:${kind}`;
    if (_inFlightMaterialize.has(inflightKey)) {
      skipped.push(kind);
      mLog(appId, `skip-inflight role=${kind}`);
      continue;
    }

    if (options?.skipDownload) {
      mLog(appId, `skip-download role=${kind} (skipDownload=true)`);
      continue;
    }

    _inFlightMaterialize.add(inflightKey);

    try {
      mLog(appId, `enqueue role=${kind} url=${asset.url.slice(0, 80)}`);
      const { enqueueMediaDownload } = await import("./mediaDownloadQueue");
      await enqueueMediaDownload({
        id: `materialize-${appId}-${kind}-${Date.now()}`,
        appId,
        provider: provider as "steam" | "steamgriddb" | "manual",
        mediaType: kind as "landscape" | "cover" | "background" | "logo" | "icon",
        url: asset.url,
        target: "canonical",
        priority: "normal",
        forceRefresh: false,
      });
      enqueued.push(kind);
      mLog(appId, `enqueued role=${kind}`);
    } catch (err) {
      mLog(appId, `enqueue-failed role=${kind} error=${err}`);
    } finally {
      _inFlightMaterialize.delete(inflightKey);
    }
  }

  mLog(appId, `done diskHits=${diskHits.length} enqueued=${enqueued.length} skipped=${skipped.length}`);

  return { diskHits, enqueued, skipped, bundle: updated };
}

export function clearMaterializeInFlight(appId?: string): void {
  if (appId) {
    for (const key of _inFlightMaterialize) {
      if (key.startsWith(`${appId}:`)) _inFlightMaterialize.delete(key);
    }
  } else {
    _inFlightMaterialize.clear();
  }
}
