import { invoke } from "@tauri-apps/api/core";

import type { SteamPaths } from "../types/steam";
import type { InstallResult } from "../types/install";
import type { ProviderAvailabilityResult } from "../types/providerAvailability";
import type { InstalledLuaScript } from "../types/installedLua";
import type { LuaActionResult } from "../types/luaAction";
import type { GameNameResult } from "../types/gameName";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { SteamReviewSummary } from "../types/gameReview";
import type { SteamFeaturedCategory } from "../types/steamFeatured";
import type { SteamStoreSearchItem } from "../types/steamStoreSearch";
import type { SteamGridDbArtwork } from "../types/steamGridDb";
import type { SteamInstalledGame } from "../types/steamInstalled";
import type { SteamUserGameStats } from "../types/steamUserStats";
import type { LocalDiscoveredGame } from "../types/localGame";
import type { LocalExecutableGame } from "../types/localExecutableGame";
import type { SyncIndex, SyncIndexItem, SyncCheckResult } from "../types/syncIndex";
import type { SteamLoginUser } from "../types/steamLoginUser";

export async function detectSteamPaths(): Promise<SteamPaths | null> {
  return await invoke<SteamPaths | null>("detect_steam_paths");
}

export async function downloadAndInstallPackage(params: {
  jobId: string;
  downloadUrl: string;
  luaTarget: string;
  depotcacheTarget: string;
  createBackups: boolean;
  headers?: Record<string, string>;
  tempFolder?: string;
}): Promise<InstallResult> {
  return await invoke<InstallResult>("download_and_install_package", {
    jobId: params.jobId,
    downloadUrl: params.downloadUrl,
    luaTarget: params.luaTarget,
    depotcacheTarget: params.depotcacheTarget,
    createBackups: params.createBackups,
    headers: params.headers,
    tempFolder: params.tempFolder,
  });
}

export async function checkProviderAvailability(params: {
  url: string;
  successCode: number;
  unavailableCode: number;
  headers?: Record<string, string>;
}): Promise<ProviderAvailabilityResult> {
  return await invoke<ProviderAvailabilityResult>(
    "check_provider_availability",
    {
      url: params.url,
      successCode: params.successCode,
      unavailableCode: params.unavailableCode,
      headers: params.headers,
    }
  );
}


export async function scanInstalledLuaScripts(
  luaPath: string
): Promise<InstalledLuaScript[]> {
  return await invoke<InstalledLuaScript[]>("scan_installed_lua_scripts", {
    luaPath,
  });
}


export async function setLuaScriptEnabled(params: {
  luaPath: string;
  fileName: string;
  enabled: boolean;
}): Promise<LuaActionResult> {
  return await invoke<LuaActionResult>("set_lua_script_enabled", {
    luaPath: params.luaPath,
    fileName: params.fileName,
    enabled: params.enabled,
  });
}

export async function deleteLuaScript(params: {
  luaPath: string;
  fileName: string;
}): Promise<LuaActionResult> {
  return await invoke<LuaActionResult>("delete_lua_script", {
    luaPath: params.luaPath,
    fileName: params.fileName,
  });
}


export async function resolveSteamAppNames(
  appIds: number[]
): Promise<GameNameResult[]> {
  return await invoke<GameNameResult[]>("resolve_steam_app_names", {
    appIds,
  });
}



export async function resolveSteamAppMetadata(
  appIds: number[]
): Promise<SteamAppMetadata[]> {
  return await invoke<SteamAppMetadata[]>("resolve_steam_app_metadata", {
    appIds,
  });
}



export async function resolveSteamReviewSummaries(
  appIds: number[]
): Promise<SteamReviewSummary[]> {
  return await invoke<SteamReviewSummary[]>("resolve_steam_review_summaries", {
    appIds,
  });
}

export async function resolveSteamFeaturedCategories(params?: {
  countryCode?: string;
  language?: string;
}): Promise<SteamFeaturedCategory[]> {
  return await invoke<SteamFeaturedCategory[]>(
    "resolve_steam_featured_categories",
    {
      countryCode: params?.countryCode,
      language: params?.language,
    }
  );
}

export async function resolveSteamStoreSearch(params: {
  term: string;
  countryCode?: string;
  language?: string;
  limit?: number;
}): Promise<SteamStoreSearchItem[]> {
  return await invoke<SteamStoreSearchItem[]>("resolve_steam_store_search", {
    term: params.term,
    countryCode: params.countryCode,
    language: params.language,
    limit: params.limit,
  });
}

export async function computeFileHash(filePath: string): Promise<string> {
  return await invoke<string>("compute_file_hash", { filePath });
}

export async function readSyncIndex(): Promise<SyncIndex> {
  return await invoke<SyncIndex>("read_sync_index");
}

export async function writeSyncIndex(index: SyncIndex): Promise<void> {
  return await invoke<void>("write_sync_index", { index });
}

export async function checkPackageUpdate(
  appId: string,
  sourceKey: string
): Promise<SyncCheckResult> {
  return await invoke<SyncCheckResult>("check_package_update", { appId, sourceKey });
}

export async function markSyncIndexItem(item: SyncIndexItem): Promise<void> {
  return await invoke<void>("mark_sync_index_item", { item });
}

export async function scanSteamLoginUsers(steamRoot: string): Promise<SteamLoginUser[]> {
  return await invoke<SteamLoginUser[]>("scan_steam_login_users", { steamRoot });
}

export async function scanSteamInstalledGames(params?: {
  steamPath?: string;
  luaPath?: string;
  depotcachePath?: string;
  gameScanFolders?: string[];
}): Promise<SteamInstalledGame[]> {
  return await invoke<SteamInstalledGame[]>("scan_steam_installed_games", {
    steamPath: params?.steamPath ?? null,
    luaPath: params?.luaPath ?? null,
    depotcachePath: params?.depotcachePath ?? null,
    gameScanFolders: params?.gameScanFolders ?? null,
  });
}

export async function scanSteamUserGameStats(params?: {
  steamPath?: string;
  appIds?: number[];
}): Promise<SteamUserGameStats[]> {
  return await invoke<SteamUserGameStats[]>("scan_steam_user_game_stats", {
    steamPath: params?.steamPath ?? null,
    appIds: params?.appIds ?? null,
  });
}

export async function scanLocalGames(params: {
  folders: string[];
  maxDepth?: number;
}): Promise<LocalDiscoveredGame[]> {
  return await invoke<LocalDiscoveredGame[]>("scan_local_games", {
    folders: params.folders,
    maxDepth: params.maxDepth ?? null,
  });
}

export async function scanLocalGameFolders(
  folders: string[]
): Promise<LocalExecutableGame[]> {
  return await invoke<LocalExecutableGame[]>("scan_local_game_folders", {
    folders,
  });
}

export async function launchSteamApp(appId: number): Promise<void> {
  return await invoke("launch_steam_app", { appId });
}

export async function installSteamApp(appId: number): Promise<void> {
  return await invoke("install_steam_app", { appId });
}

export type RawSteamNewsItem = {
  gid: string;
  title: string;
  url: string;
  is_external_url: boolean;
  author: string;
  contents: string;
  feedlabel: string;
  date: number;
  feedname: string;
  feed_type: number;
  appid: number;
};

export async function fetchSteamNews(
  appId: number,
  count?: number,
  maxlength?: number
): Promise<RawSteamNewsItem[]> {
  return await invoke<RawSteamNewsItem[]>("fetch_steam_news", {
    appId,
    count: count ?? null,
    maxlength: maxlength ?? null,
  });
}

export async function fetchSteamPlayerAchievements(params: {
  appId: number;
  steamId: string;
  apiKey: string;
  language?: string;
}): Promise<unknown> {
  return await invoke("fetch_steam_player_achievements", {
    appId: params.appId,
    steamId: params.steamId,
    apiKey: params.apiKey,
    language: params.language ?? null,
  });
}

export async function fetchSteamGlobalAchievementPercentages(
  appId: number
): Promise<unknown> {
  return await invoke("fetch_steam_global_achievement_percentages", {
    appId,
  });
}

export async function fetchSteamAchievementSchema(params: {
  appId: number;
  apiKey: string;
  language?: string;
}): Promise<unknown> {
  return await invoke("fetch_steam_achievement_schema", {
    appId: params.appId,
    apiKey: params.apiKey,
    language: params.language ?? null,
  });
}

export type SteamAppcacheAchievement = {
  api_name: string;
  unlocked: boolean;
  unlock_time?: number;
};

export type SteamAppcacheSchemaEntry = {
  api_name: string;
  display_name?: string;
  description?: string;
  icon?: string;
  icon_gray?: string;
  hidden?: boolean;
  stat_id?: number;
  bit?: number;
};

export type SteamAppcacheParsedProgress = {
  api_name: string;
  unlocked: boolean;
  stat_id: number;
  value: number;
};

export type SteamAppcacheScanResult = {
  stats_file_found: boolean;
  schema_file_found: boolean;
  stats_file_size?: number;
  schema_file_size?: number;
  stats_file_modified?: number;
  schema_file_modified?: number;
  parsed_achievements: SteamAppcacheAchievement[];
  parsed_schema: SteamAppcacheSchemaEntry[];
  parsed_progress: SteamAppcacheParsedProgress[];
  parser_confidence: string;
  progress_available: boolean;
  error_reason?: string;
};

export async function scanSteamAppcacheAchievements(params: {
  steamPath?: string;
  steamAccountId?: string;
  appId: number;
}): Promise<SteamAppcacheScanResult> {
  return await invoke<SteamAppcacheScanResult>("scan_steam_appcache_achievements", {
    steamPath: params.steamPath ?? null,
    steamAccountId: params.steamAccountId ?? null,
    appId: params.appId,
  });
}

export type AppAchievementCacheEntry = {
  id: string;
  api_name: string;
  name: string;
  description?: string;
  icon_url?: string;
  icon_gray_url?: string;
  unlocked: boolean;
  unlock_time?: number;
  rarity_percent?: number;
};

export type AppAchievementPercentagesEntry = {
  name: string;
  percent: number;
};

export type AppAchievementSummaryData = {
  app_id: string;
  total: number;
  unlocked: number;
  percent: number;
  progress_available: boolean;
  source: string;
  updated_at: number;
  cache_version?: number;
};

export type AppAchievementCache = {
  achievements: AppAchievementCacheEntry[];
  achievement_percentages: AppAchievementPercentagesEntry[];
  summary: AppAchievementSummaryData;
};

export async function readAchievementCache(appId: number): Promise<AppAchievementCache | null> {
  return await invoke<AppAchievementCache | null>("read_achievement_cache", { appId });
}

export async function writeAchievementCache(appId: number, data: AppAchievementCache): Promise<void> {
  return await invoke<void>("write_achievement_cache", { appId, data });
}

export type AchievementsAppSchemaResult = {
  achievements: AppAchievementCacheEntry[];
  achievement_percentages: AppAchievementPercentagesEntry[];
};

export async function readAchievementsAppSchemaFolder(path: string, appId: number): Promise<AchievementsAppSchemaResult> {
  return await invoke<AchievementsAppSchemaResult>("read_achievements_app_schema_folder", { path, appId });
}

export async function resolveSteamGridDbArtwork(
  appIds: number[],
  apiKey: string
): Promise<SteamGridDbArtwork[]> {
  return await invoke<SteamGridDbArtwork[]>(
    "resolve_steamgriddb_artwork",
    {
      appIds,
      apiKey,
    }
  );
}

// --- Process management ---

export type SpawnResult = {
  pid?: number;
  launched: boolean;
};

export type ProcessInfo = {
  pid: number;
  parent_pid?: number;
  name: string;
  exe?: string;
};

export async function launchExecutable(path: string): Promise<SpawnResult> {
  return await invoke<SpawnResult>("launch_executable", { path });
}

export async function terminateProcess(pid: number): Promise<void> {
  return await invoke<void>("terminate_process", { pid });
}

export async function terminateProcessTree(pid: number): Promise<void> {
  return await invoke<void>("terminate_process_tree", { pid });
}

export async function isProcessRunning(pid: number): Promise<boolean> {
  return await invoke<boolean>("is_process_running", { pid });
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  return await invoke<ProcessInfo[]>("list_processes");
}

// --- Store cache ---
// All Store data lives under app_data/store/ to keep it separate from Library cache.

export type StoreAppInfoEntry = {
  app_id: string;
  name: string | null;
  header_image: string | null;
  capsule_image: string | null;
  hero_path: string | null;
  header_path: string | null;
  capsule_path: string | null;
  logo_path: string | null;
  updated_at: number | null;
};

export type StoreAppInfoMap = Record<string, StoreAppInfoEntry>;

export type StoreGameDetailsEntry = {
  app_id: number;
  data: unknown;
  updated_at: number;
  version: number;
};

export type StoreReviewEntry = {
  app_id: number;
  data: unknown;
  updated_at: number;
  version: number;
};

export type StoreMediaCacheEntry = {
  capsule_path: string | null;
  header_path: string | null;
  hero_path: string | null;
  background_path: string | null;
  logo_path: string | null;
  updated_at: number | null;
};

export async function readStoreAppinfo(): Promise<StoreAppInfoMap> {
  return await invoke<StoreAppInfoMap>("read_store_appinfo");
}

export async function writeStoreAppinfo(appinfo: StoreAppInfoMap): Promise<void> {
  return await invoke<void>("write_store_appinfo", { appinfo });
}

export async function updateStoreAppinfoEntry(
  appId: string,
  entry: StoreAppInfoEntry
): Promise<void> {
  return await invoke<void>("update_store_appinfo_entry", { appId, entry });
}

export async function readStoreGameDetails(
  appId: number
): Promise<StoreGameDetailsEntry | null> {
  return await invoke<StoreGameDetailsEntry | null>("read_store_game_details", { appId });
}

export async function writeStoreGameDetails(
  appId: number,
  entry: StoreGameDetailsEntry
): Promise<void> {
  return await invoke<void>("write_store_game_details", { appId, entry });
}

export async function readStoreReviewSummary(
  appId: number
): Promise<StoreReviewEntry | null> {
  return await invoke<StoreReviewEntry | null>("read_store_review_summary", { appId });
}

export async function writeStoreReviewSummary(
  appId: number,
  entry: StoreReviewEntry
): Promise<void> {
  return await invoke<void>("write_store_review_summary", { appId, entry });
}

export async function getStoreMediaCache(
  appId: number
): Promise<StoreMediaCacheEntry | null> {
  return await invoke<StoreMediaCacheEntry | null>("get_store_media_cache", { appId });
}

export async function cacheStoreRemoteMedia(
  appId: number,
  urls: {
    capsuleUrl: string | null;
    headerUrl: string | null;
    heroUrl: string | null;
    backgroundUrl: string | null;
    logoUrl: string | null;
  }
): Promise<StoreMediaCacheEntry> {
  return await invoke<StoreMediaCacheEntry>("cache_store_remote_media", {
    appId,
    capsuleUrl: urls.capsuleUrl,
    headerUrl: urls.headerUrl,
    heroUrl: urls.heroUrl,
    backgroundUrl: urls.backgroundUrl,
    logoUrl: urls.logoUrl,
  });
}

export async function clearStoreCache(): Promise<void> {
  return await invoke("clear_store_cache");
}

// --- Library cache ---

export type LibraryAppInfoEntry = {
  app_id: string;
  name: string | null;
  header_image: string | null;
  cover_path: string | null;
  grid_path: string | null;
  hero_path: string | null;
  logo_path: string | null;
  icon_path: string | null;
  updated_at: number | null;
};

export type LibraryAppInfoMap = Record<string, LibraryAppInfoEntry>;

export type LibraryGameDetailsEntry = {
  app_id: string;
  source: string;
  updated_at: number;
  data: unknown;
};

export type GameMediaCacheEntry = {
  game_key: string;
  app_id: string | null;
  title: string | null;
  cover_path: string | null;
  grid_path: string | null;
  hero_path: string | null;
  logo_path: string | null;
  icon_path: string | null;
  quick_cover_path: string | null;
  updated_at: number | null;
};

export type GameMediaUrls = {
  cover_url: string | null;
  grid_url: string | null;
  hero_url: string | null;
  logo_url: string | null;
  icon_url: string | null;
  quick_cover_url: string | null;
};

export type ImportResult = {
  imported_covers: number;
  imported_details: number;
  imported_app_info: boolean;
};

export async function readLibraryAppinfo(): Promise<LibraryAppInfoMap> {
  return await invoke<LibraryAppInfoMap>("read_library_appinfo");
}

export async function writeLibraryAppinfo(
  appinfo: LibraryAppInfoMap
): Promise<void> {
  return await invoke<void>("write_library_appinfo", { appinfo });
}

export async function updateLibraryAppinfoEntry(
  appId: string,
  entry: LibraryAppInfoEntry
): Promise<void> {
  return await invoke<void>("update_library_appinfo_entry", {
    appId,
    entry,
  });
}

export async function readLibraryGameDetails(
  appId: string
): Promise<LibraryGameDetailsEntry | null> {
  return await invoke<LibraryGameDetailsEntry | null>(
    "read_library_game_details",
    { appId }
  );
}

export async function writeLibraryGameDetails(
  appId: string,
  entry: LibraryGameDetailsEntry
): Promise<void> {
  return await invoke<void>("write_library_game_details", {
    appId,
    entry,
  });
}

export async function libraryGetGameMediaCache(
  gameKey: string
): Promise<GameMediaCacheEntry | null> {
  return await invoke<GameMediaCacheEntry | null>(
    "library_get_game_media_cache",
    { gameKey }
  );
}

export async function librarySaveGameMediaCache(
  gameKey: string,
  entry: GameMediaCacheEntry
): Promise<GameMediaCacheEntry> {
  return await invoke<GameMediaCacheEntry>("library_save_game_media_cache", {
    gameKey,
    entry,
  });
}

export async function libraryClearGameMediaCache(
  gameKey: string
): Promise<void> {
  return await invoke<void>("library_clear_game_media_cache", { gameKey });
}

export async function libraryClearAllGameMediaCache(): Promise<void> {
  return await invoke<void>("library_clear_all_game_media_cache");
}

// --- Unprefixed convenience aliases for library cache wrappers ---

export async function getGameMediaCache(
  gameKey: string
): Promise<GameMediaCacheEntry | null> {
  return await libraryGetGameMediaCache(gameKey);
}

export async function saveGameMediaCache(
  gameKey: string,
  entry: GameMediaCacheEntry
): Promise<GameMediaCacheEntry> {
  return await librarySaveGameMediaCache(gameKey, entry);
}

export async function clearGameMediaCache(
  gameKey: string
): Promise<void> {
  return await libraryClearGameMediaCache(gameKey);
}

export async function clearAllGameMediaCache(): Promise<void> {
  return await libraryClearAllGameMediaCache();
}

export async function readImageAsDataUrl(path: string): Promise<string | null> {
  try {
    return await invoke<string>("read_image_as_data_url", { path });
  } catch {
    return null;
  }
}

export async function cacheLibraryGameMedia(
  gameKey: string,
  appId: string | null,
  title: string | null,
  urls: {
    coverUrl?: string | null;
    gridUrl?: string | null;
    heroUrl?: string | null;
    logoUrl?: string | null;
    iconUrl?: string | null;
  }
): Promise<GameMediaCacheEntry> {
  return await invoke<GameMediaCacheEntry>("cache_library_game_media", {
    gameKey,
    appId,
    title,
    coverUrl: urls.coverUrl ?? null,
    gridUrl: urls.gridUrl ?? null,
    heroUrl: urls.heroUrl ?? null,
    logoUrl: urls.logoUrl ?? null,
    iconUrl: urls.iconUrl ?? null,
  });
}

// --- Canonical Game Cache (app_data/games/steam/{appid}/) ---

export type GameAppInfo = {
  appId: string;
  provider: string;
  name: string | null;
  updatedAt: number | null;
  media: GameMediaPaths | null;
  remote: GameRemoteRefs | null;
};

export type GameRemoteRefs = {
  header_image: string | null;
  capsule_image: string | null;
  background_image: string | null;
};

export type GameMediaPaths = {
  coverPath: string | null;
  backgroundPath: string | null;
  logoPath: string | null;
  iconPath: string | null;
  landscapePath: string | null;
};

export type GameMediaPathsResult = {
  coverPath: string | null;
  coverExists: boolean;
  landscapePath: string | null;
  landscapeExists: boolean;
  backgroundPath: string | null;
  backgroundExists: boolean;
  logoPath: string | null;
  logoExists: boolean;
  iconPath: string | null;
  iconExists: boolean;
};

export type GameStoreDetails = {
  app_id: string;
  source: string;
  updated_at: number;
  data: unknown;
};

export type GameArtwork = {
  app_id: string;
  updated_at: number;
  sources: { store: string; library: string };
  steam_grid_db: SteamGridDbRef | null;
  paths: GameMediaPaths;
};

export type SteamGridDbRef = {
  grid_url: string | null;
  hero_url: string | null;
  logo_url: string | null;
  icon_url: string | null;
  cover_url: string | null;
};

export type MigrationSummary = {
  app_info_copied: number;
  details_copied: number;
  media_folders_moved: number;
  errors: string[];
};

export type ValidatedMediaPaths = {
  coverPath: string | null;
  coverExists: boolean;
  landscapePath: string | null;
  landscapeExists: boolean;
  backgroundPath: string | null;
  backgroundExists: boolean;
  logoPath: string | null;
  logoExists: boolean;
  iconPath: string | null;
  iconExists: boolean;
};

// Validate snapshot media paths — batch check which local files exist
export async function validateSnapshotMediaPaths(
  media: SnapshotGameMediaForValidation,
): Promise<ValidatedMediaPaths> {
  try {
    return await invoke<ValidatedMediaPaths>("validate_snapshot_media_paths", { media });
  } catch {
    return {
      coverPath: media.coverPath,
      coverExists: !!media.coverPath,
      landscapePath: media.landscapePath,
      landscapeExists: !!media.landscapePath,
      backgroundPath: media.backgroundPath,
      backgroundExists: !!media.backgroundPath,
      logoPath: media.logoPath,
      logoExists: !!media.logoPath,
      iconPath: media.iconPath,
      iconExists: !!media.iconPath,
    };
  }
}

export type SnapshotGameMediaForValidation = {
  landscapePath: string | null;
  coverPath: string | null;
  backgroundPath: string | null;
  logoPath: string | null;
  iconPath: string | null;
};

// Batch read canonical appinfos (lightweight, no network)
export async function readCanonicalAppinfos(
  appIds: string[],
): Promise<Record<string, GameAppInfo>> {
  try {
    return await invoke<Record<string, GameAppInfo>>("read_canonical_appinfos", { appIds });
  } catch {
    return {};
  }
}

// GameAppInfo CRUD
export async function getGameAppInfo(appId: string): Promise<GameAppInfo | null> {
  try {
    return await invoke<GameAppInfo | null>("get_game_app_info", { appId });
  } catch {
    return null;
  }
}

export async function saveGameAppInfo(appId: string, entry: GameAppInfo): Promise<void> {
  return await invoke("save_game_app_info", { appId, entry });
}

// StoreDetails CRUD
export async function getStoreDetails(appId: string): Promise<GameStoreDetails | null> {
  try {
    return await invoke<GameStoreDetails | null>("get_store_details", { appId });
  } catch {
    return null;
  }
}

export async function saveStoreDetails(appId: string, entry: GameStoreDetails): Promise<void> {
  return await invoke("save_store_details", { appId, entry });
}

// GameArtwork CRUD
export async function getGameArtwork(appId: string): Promise<GameArtwork | null> {
  try {
    return await invoke<GameArtwork | null>("get_game_artwork", { appId });
  } catch {
    return null;
  }
}

export async function saveGameArtwork(appId: string, entry: GameArtwork): Promise<void> {
  return await invoke("save_game_artwork", { appId, entry });
}

// Image caching — one function per role
export type LandscapeUrls = {
  sgdb_grid_url: string | null;
  sgdb_hero_url: string | null;
  store_header_url: string | null;
  store_background_url: string | null;
};

export type CoverUrls = {
  sgdb_cover_url: string | null;
  store_capsule_url: string | null;
  store_capsule_v5_url: string | null;
  store_header_url: string | null;
};

export type BackgroundUrls = {
  sgdb_hero_url: string | null;
  store_background_raw_url: string | null;
  store_background_url: string | null;
  store_header_url: string | null;
};

export type LogoUrls = {
  sgdb_logo_url: string | null;
};

export type IconUrls = {
  sgdb_icon_url: string | null;
};

export async function cacheLandscapeImage(appId: string, urls: LandscapeUrls, forceRefresh?: boolean): Promise<string | null> {
  return await invoke<string | null>("cache_landscape_image", { appId, urls, forceRefresh: forceRefresh ?? false });
}

export async function cacheCoverImage(appId: string, urls: CoverUrls, forceRefresh?: boolean): Promise<string | null> {
  return await invoke<string | null>("cache_cover_image", { appId, urls, forceRefresh: forceRefresh ?? false });
}

export async function cacheBackgroundImage(appId: string, urls: BackgroundUrls, forceRefresh?: boolean): Promise<string | null> {
  return await invoke<string | null>("cache_background_image", { appId, urls, forceRefresh: forceRefresh ?? false });
}

export async function cacheLogoImage(appId: string, urls: LogoUrls, forceRefresh?: boolean): Promise<string | null> {
  return await invoke<string | null>("cache_logo_image", { appId, urls, forceRefresh: forceRefresh ?? false });
}

export async function cacheIconImage(appId: string, urls: IconUrls, forceRefresh?: boolean): Promise<string | null> {
  return await invoke<string | null>("cache_icon_image", { appId, urls, forceRefresh: forceRefresh ?? false });
}

// resolve_game_media_paths — check if landscape.jpg/cover.jpg exist on disk
export async function resolveGameMediaPaths(appId: string): Promise<GameMediaPaths | null> {
  try {
    return await invoke<GameMediaPaths>("resolve_game_media_paths", { appId });
  } catch {
    return null;
  }
}

// get_game_media_paths — returns paths + existence booleans for all 5 media roles
export async function getGameMediaPaths(appId: string): Promise<GameMediaPathsResult | null> {
  try {
    return await invoke<GameMediaPathsResult>("get_game_media_paths", { appId });
  } catch {
    return null;
  }
}

// repair_appinfo_media_paths — validate and strip stale paths from appinfo.json
export async function repairAppinfoMediaPaths(appId: string): Promise<boolean> {
  try {
    return await invoke<boolean>("repair_appinfo_media_paths", { appId });
  } catch {
    return false;
  }
}

// repair_media_roles — inspect cached images and fix misclassified files
// (e.g. vertical image saved as landscape.jpg)
export async function repairMediaRoles(appId: string): Promise<boolean> {
  try {
    return await invoke<boolean>("repair_media_roles", { appId });
  } catch {
    return false;
  }
}

// Appinfo/artwork update helpers
export type GameRemoteRefsInput = {
  header_image: string | null;
  capsule_image: string | null;
  background_image: string | null;
};

export async function updateGameAppinfoMedia(appId: string, name: string | null, media: GameMediaPaths, remote?: GameRemoteRefsInput | null): Promise<void> {
  return await invoke("update_game_appinfo_media", { appId, name, media, remote: remote ?? null });
}

export async function updateGameArtwork(appId: string, sgdb: SteamGridDbRef | null, paths: GameMediaPaths): Promise<void> {
  return await invoke("update_game_artwork", { appId, sgdb, paths });
}

// Migration
export async function migrateToCanonicalCache(): Promise<MigrationSummary> {
  return await invoke<MigrationSummary>("migrate_to_canonical_cache");
}

// ---------------------------------------------------------------------------
// Media cache stats and compaction
// ---------------------------------------------------------------------------

export type MediaCacheStats = {
  total_bytes: number;
  game_count: number;
  largest_games: {
    app_id: string;
    title: string;
    bytes: number;
  }[];
  by_type: {
    landscape_bytes: number;
    cover_bytes: number;
    old_media_bytes: number;
  };
};

export type MediaCacheProfile = "minimal" | "playnite-balanced" | "full";

export async function getMediaCacheStats(): Promise<MediaCacheStats> {
  return await invoke<MediaCacheStats>("get_media_cache_stats");
}

export async function compactMediaCache(profile?: MediaCacheProfile): Promise<MediaCacheStats> {
  return await invoke<MediaCacheStats>("compact_media_cache", { profile });
}

export async function readGameMediaDataUrl(path: string): Promise<string> {
  return await invoke<string>("read_game_media_data_url", { path });
}

// ---------------------------------------------------------------------------
// SQLite cache (Phase 1+ — read-only for now)
// ---------------------------------------------------------------------------

export type SqliteMediaCacheEntry = {
  gameId: string;
  provider: string;
  basePath: string;
  hasCover: boolean;
  hasBackground: boolean;
  hasLogo: boolean;
  hasLandscape: boolean;
  updatedAt: number;
};

export type SqliteMetadataCacheEntry = {
  gameId: string;
  title: string | null;
  provider: string;
  installed: boolean;
  lastPlayed: number;
  playtime: number;
  updatedAt: number;
};

export async function getMediaCacheSqlite(gameId: string): Promise<SqliteMediaCacheEntry | null> {
  try {
    return await invoke<SqliteMediaCacheEntry | null>("get_media_cache", { gameId });
  } catch {
    return null;
  }
}

export async function getMetadataCacheSqlite(gameId: string): Promise<SqliteMetadataCacheEntry | null> {
  try {
    return await invoke<SqliteMetadataCacheEntry | null>("get_metadata_cache", { gameId });
  } catch {
    return null;
  }
}

export async function checkSqliteHealth(): Promise<boolean> {
  try {
    const result = await invoke<boolean>("check_sqlite_health");
    return result;
  } catch {
    return false;
  }
}

// Write commands (write-through caching, Phase 2)
export async function insertMediaCacheSqlite(entry: SqliteMediaCacheEntry): Promise<void> {
  try {
    await invoke("insert_media_cache", { entry });
  } catch {
    // silent — best-effort only
  }
}

export async function insertMetadataCacheSqlite(entry: SqliteMetadataCacheEntry): Promise<void> {
  try {
    await invoke("insert_metadata_cache", { entry });
  } catch {
    // silent — best-effort only
  }
}