import { invoke } from "@tauri-apps/api/core";

import type { SteamPaths } from "../types/steam";
import type { InstallResult } from "../types/install";
import type { ProviderAvailabilityResult } from "../types/providerAvailability";
import type { InstalledLuaScript } from "../types/installedLua";
import type { LuaActionResult } from "../types/luaAction";
import type { GameNameResult } from "../types/gameName";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { SteamReviewSummary } from "../types/gameReview";
import type { SteamStoreSearchItem } from "../types/steamStoreSearch";
import type { SteamGridDbArtwork } from "../types/steamGridDb";
import type { SteamInstalledGame } from "../types/steamInstalled";
import type { SteamUserGameStats } from "../types/steamUserStats";
import type { LocalDiscoveredGame } from "../types/localGame";
import type { LocalExecutableGame } from "../types/localExecutableGame";
import type { SyncIndex, SyncIndexItem, SyncCheckResult } from "../types/syncIndex";
import type { SteamLoginUser } from "../types/steamLoginUser";
import type { OwnedSteamGame } from "../types/ownedSteamGame";

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
  appIds: number[],
  language?: string,
  country?: string,
): Promise<SteamAppMetadata[]> {
  return await invoke<SteamAppMetadata[]>("resolve_steam_app_metadata", {
    appIds,
    language: language ?? null,
    country: country ?? null,
  });
}

export async function fetchSteamStoreDrmNotice(
  appId: number,
): Promise<string | null> {
  return await invoke<string | null>("fetch_steam_store_drm_notice", {
    appId,
  });
}

export async function resolveSteamReviewSummaries(
  appIds: number[]
): Promise<SteamReviewSummary[]> {
  return await invoke<SteamReviewSummary[]>("resolve_steam_review_summaries", {
    appIds,
  });
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

export async function fetchSteamOwnedGames(apiKey: string, steamId: string): Promise<OwnedSteamGame[]> {
  return await invoke<OwnedSteamGame[]>("fetch_steam_owned_games", { apiKey, steamId });
}

export async function readSteamOwnedCache(): Promise<OwnedSteamGame[]> {
  return await invoke<OwnedSteamGame[]>("read_steam_owned_cache");
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

export async function uninstallSteamApp(appId: number): Promise<void> {
  return await invoke("uninstall_steam_app", { appId });
}

export async function openSteamStoreApp(appId: number): Promise<void> {
  return await invoke("open_steam_store_app", { appId });
}

export type DownloadProgress = {
  bytesDownloaded: number;
  bytesToDownload: number;
  percent: number;
};

export type SteamGameInstallStatus = {
  isInstalled: boolean;
  isCompleted: boolean;
  stateFlags: number | null;
  installPath: string | null;
  installDir: string | null;
  libraryPath: string | null;
  name: string | null;
  sizeOnDisk: number | null;
  lastUpdated: number | null;
  downloadProgress: DownloadProgress | null;
};

export async function checkSteamGameInstalled(
  appId: number,
  steamRoot?: string | null,
): Promise<SteamGameInstallStatus> {
  return await invoke<SteamGameInstallStatus>("check_steam_game_installed", {
    appId,
    steamRoot: steamRoot ?? null,
  });
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
  /** Serialized as "icon" in JSON; fall back to icon_url for backward compat. */
  icon?: string;
  icon_url?: string;
  /** Serialized as "icon_gray" in JSON; fall back to icon_gray_url for backward compat. */
  icon_gray?: string;
  icon_gray_url?: string;
  unlocked: boolean;
  unlock_time?: number;
  rarity_percent?: number;
  stat_id?: number;
  bit?: number;
};

/** Helper: resolve the effective icon path from an achievement cache entry.
 *  Prefers the new "icon"/"icon_gray" field, falls back to old "icon_url"/"icon_gray_url". */
export function entryIcon(entry: AppAchievementCacheEntry): string | undefined {
  return entry.icon ?? entry.icon_url;
}
export function entryIconGray(entry: AppAchievementCacheEntry): string | undefined {
  return entry.icon_gray ?? entry.icon_gray_url;
}

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

export async function writeAchievementCache(appId: number, data: AppAchievementCache, migrateIcons = true): Promise<void> {
  return await invoke<void>("write_achievement_cache", { appId, data, migrateIcons });
}

export type AchievementsAppSchemaResult = {
  achievements: AppAchievementCacheEntry[];
  achievement_percentages: AppAchievementPercentagesEntry[];
  base_dir?: string | null;
};

export async function readAchievementsAppSchemaFolder(path: string, appId: number): Promise<AchievementsAppSchemaResult> {
  return await invoke<AchievementsAppSchemaResult>("read_achievements_app_schema_folder", { path, appId });
}

export type StatPair = {
  stat_id: number;
  value: number;
};

export type UserGameStatsRawResult = {
  file_found: boolean;
  file_size?: number;
  stat_pairs: StatPair[];
  achievement_entries: SteamAppcacheAchievement[];
  error_reason?: string;
};

export async function parseUserGameStatsRaw(params: {
  steamPath?: string;
  steamAccountId: string;
  appId: number;
}): Promise<UserGameStatsRawResult> {
  return await invoke<UserGameStatsRawResult>("parse_user_game_stats_raw", {
    steamPath: params.steamPath ?? null,
    steamAccountId: params.steamAccountId,
    appId: params.appId,
  });
}

export async function downloadAchievementImage(params: {
  appId: number;
  url: string;
  fileName: string;
}): Promise<string | null> {
  return await invoke<string | null>("download_achievement_image", {
    appId: params.appId,
    url: params.url,
    fileName: params.fileName,
  });
}

export type AchievementImageStatus = {
  api_name: string;
  icon_exists: boolean;
  icon_gray_exists: boolean;
};

export async function resolveAchievementImagePaths(appId: number): Promise<AchievementImageStatus[]> {
  return await invoke<AchievementImageStatus[]>("resolve_achievement_image_paths", { appId });
}

export type OrphanCleanupResult = {
  expected_max: number;
  actual_files: number;
  orphaned_files: string[];
  orphaned_count: number;
};

export async function cleanupAchievementOrphanImages(params: {
  appId: number;
  dryRun: boolean;
}): Promise<OrphanCleanupResult> {
  return await invoke<OrphanCleanupResult>("cleanup_achievement_orphan_images", {
    appId: params.appId,
    dryRun: params.dryRun,
  });
}

export async function ensureAchievementImages(params: {
  appId: number;
  mode: string;
  schemaUrls: string[];
  schemaGrayUrls: string[];
}): Promise<[number, number]> {
  return await invoke<[number, number]>("ensure_achievement_images", {
    appId: params.appId,
    mode: params.mode,
    schemaUrls: params.schemaUrls,
    schemaGrayUrls: params.schemaGrayUrls,
  });
}

// ---------------------------------------------------------------------------
// Achievement folder migration
// ---------------------------------------------------------------------------

export type AchievementFolderMigrationResult = {
  found: number;
  migrated: number;
  errors: string[];
};

export async function migrateAchievementsToProviderFolders(): Promise<AchievementFolderMigrationResult> {
  return await invoke<AchievementFolderMigrationResult>("migrate_achievements_to_provider_folders");
}

// ---------------------------------------------------------------------------
// Portable paths validation
// ---------------------------------------------------------------------------

export type PortablePathsValidation = {
  absolutePaths: number;
  assetUrlsPersisted: number;
  remoteIconFields: number;
  providerlessAchievementFolders: number;
  missingFiles: number;
  details: string[];
};

export async function validatePortablePaths(): Promise<PortablePathsValidation> {
  return await invoke<PortablePathsValidation>("validate_portable_paths");
}

// ---------------------------------------------------------------------------
// Generated achievement schema validation (Part 7)
// ---------------------------------------------------------------------------

export type AchievementsSchemaValidation = {
  appId: number;
  total: number;
  remoteIconFields: number;
  localIconFields: number;
  missingLocalFiles: number;
  details: string[];
};

export async function validateGeneratedAchievementSchema(appId: number): Promise<AchievementsSchemaValidation> {
  return await invoke<AchievementsSchemaValidation>("validate_generated_achievement_schema", { appId });
}

// ---------------------------------------------------------------------------
// Cache health validation (frontend-combined checks)
// ---------------------------------------------------------------------------

export type CacheHealthResult = {
  orphan_achievement_images: number;
  duplicate_queued_jobs: number;
  missing_achievement_images: number;
  missing_media_files: number;
  details: string[];
};

export async function validateCacheHealth(achievementAppIds: string[]): Promise<CacheHealthResult> {
  const details: string[] = [];
  let orphanAchievementImages = 0;
  let missingAchievementImages = 0;

  // Check orphan/missing achievement images
  const { validateAchievementImageFolder } = await import("./achievementImageQueue");
  for (const appId of achievementAppIds) {
    try {
      const result = await validateAchievementImageFolder(appId);
      if (result && result.orphaned > 0) {
        orphanAchievementImages += result.orphaned;
        details.push(`[HEALTH] appid=${appId} orphanAchievementImages=${result.orphaned}`);
      }
      if (result && result.actualFiles < result.expectedMax) {
        const diff = result.expectedMax - result.actualFiles;
        missingAchievementImages += diff;
        details.push(`[HEALTH] appid=${appId} expectedFiles=${result.expectedMax} actualFiles=${result.actualFiles}`);
      }
    } catch { /* skip */ }
  }

  const fullValidation = await validatePortablePaths();
  if (fullValidation.missingFiles > 0) {
    details.push(`[HEALTH] missingLocalFiles=${fullValidation.missingFiles}`);
  }

  return {
    orphan_achievement_images: orphanAchievementImages,
    duplicate_queued_jobs: 0,
    missing_achievement_images: missingAchievementImages,
    missing_media_files: fullValidation.missingFiles,
    details,
  };
}

export type DebugFileInfo = {
  found: boolean;
  path: string;
  size?: number;
  modified?: number;
  hex_preview: string;
  hex_preview_len: number;
};

export type DebugKvNode = {
  field_number: number;
  wire_type: number;
  wire_type_name: string;
  value_preview: string;
  offset: number;
  length: number;
};

export type DebugMatchResult = {
  api_name: string;
  display_name?: string;
  stat_id?: number;
  bit?: number;
  stat_value?: number;
  unlocked_by_bit?: boolean;
  unlocked_by_v1?: boolean;
  unlock_time?: number;
  source: string;
};

export type DebugAchievementReport = {
  stats_file: DebugFileInfo;
  schema_file: DebugFileInfo;
  stats_kv_tree: DebugKvNode[];
  schema_kv_tree: DebugKvNode[];
  stat_pairs: StatPair[];
  achievement_entries: SteamAppcacheAchievement[];
  schema_entries: SteamAppcacheSchemaEntry[];
  app_schema?: AchievementsAppSchemaResult | null;
  library_cache?: LibraryCacheProgress | null;
  match_results: DebugMatchResult[];
  v1_match_results: DebugMatchResult[];
  error_reason?: string;
};

export type LibraryCacheAchievementEntry = {
  str_id?: string;
  str_name?: string;
  str_description?: string;
  b_achieved?: boolean;
  rt_unlocked?: number;
  str_image?: string;
  b_hidden?: boolean;
  fl_achieved?: number;
};

export type LibraryCacheProgress = {
  file_found: boolean;
  file_path: string;
  file_size?: number;
  n_total?: number;
  n_achieved?: number;
  progress_available: boolean;
  entries: LibraryCacheAchievementEntry[];
  error_reason?: string;
};

export type LibraryCacheFileMetadata = {
  file_found: boolean;
  file_path: string;
  file_size?: number;
  modified_at?: number;
  error_reason?: string;
};

export async function parseLibraryCacheAchievements(params: {
  steamPath?: string;
  steamAccountId: string;
  appId: number;
}): Promise<LibraryCacheProgress> {
  return await invoke<LibraryCacheProgress>("parse_librarycache_achievements", {
    steamPath: params.steamPath ?? null,
    steamAccountId: params.steamAccountId,
    appId: params.appId,
  });
}

export async function checkAchievementLibraryCacheMetadata(params: {
  steamPath?: string;
  steamAccountId: string;
  appId: number;
}): Promise<LibraryCacheFileMetadata> {
  return await invoke<LibraryCacheFileMetadata>("check_achievement_librarycache_metadata", {
    steamPath: params.steamPath ?? null,
    steamAccountId: params.steamAccountId,
    appId: params.appId,
  });
}

export async function listLibraryCacheAppIds(params: {
  steamPath?: string;
  steamAccountId: string;
}): Promise<number[]> {
  return await invoke<number[]>("list_librarycache_appids", {
    steamPath: params.steamPath ?? null,
    steamAccountId: params.steamAccountId,
  });
}

export async function debugAchievementProgress(params: {
  steamPath?: string;
  steamAccountId: string;
  appId: number;
  achievementSchemaPath?: string;
}): Promise<DebugAchievementReport> {
  return await invoke<DebugAchievementReport>("debug_achievement_progress", {
    steamPath: params.steamPath ?? null,
    steamAccountId: params.steamAccountId,
    appId: params.appId,
    achievementSchemaPath: params.achievementSchemaPath ?? null,
  });
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

export async function terminateProcessByName(name: string): Promise<void> {
  return await invoke<void>("terminate_process_by_name", { name });
}

export async function isProcessRunning(pid: number): Promise<boolean> {
  return await invoke<boolean>("is_process_running", { pid });
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  return await invoke<ProcessInfo[]>("list_processes");
}

export type DiscoveredExecutable = {
  exe_path: string;
  file_name: string;
  size_bytes: number;
};

export async function focusGameWindow(pid: number): Promise<void> {
  await invoke<void>("focus_game_window", { pid });
}

export async function discoverExecutables(dir: string): Promise<DiscoveredExecutable[]> {
  try {
    return await invoke<DiscoveredExecutable[]>("discover_executables", { dir });
  } catch {
    return [];
  }
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

export async function readStoreDiscoveryIndex(): Promise<unknown | null> {
  return await invoke<unknown | null>("read_store_discovery_index");
}

export async function writeStoreDiscoveryIndex(data: unknown): Promise<void> {
  return await invoke<void>("write_store_discovery_index", { data });
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
  mediaSources: GameMediaSources | null;
  remote: GameRemoteRefs | null;
};

export type GameMediaSources = {
  landscape: string | null;
  cover: string | null;
  background: string | null;
  logo: string | null;
  icon: string | null;
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
  appId: string,
  media: SnapshotGameMediaForValidation,
): Promise<ValidatedMediaPaths> {
  try {
    return await invoke<ValidatedMediaPaths>("validate_snapshot_media_paths", { appId, media });
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

// Batch type: map of appId -> SnapshotGameMediaForValidation
export type SnapshotGameMediaRecord = Record<string, SnapshotGameMediaForValidation>;

// validateSnapshotMediaPathsBatch — batch validate media paths for multiple games.
// Replaces per-app validateSnapshotMediaPaths loops in snapshot hydration/building.
export async function validateSnapshotMediaPathsBatch(
  items: SnapshotGameMediaRecord,
): Promise<Record<string, ValidatedMediaPaths>> {
  try {
    return await invoke<Record<string, ValidatedMediaPaths>>("validate_snapshot_media_paths_batch", { items });
  } catch {
    const fallback: Record<string, ValidatedMediaPaths> = {};
    for (const [appId, media] of Object.entries(items)) {
      fallback[appId] = {
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
    return fallback;
  }
}

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

// resolveGameMediaPathsBatch — batch resolve media paths for multiple appIds.
// Replaces per-app resolveGameMediaPaths loops in hydrateMediaOnStartup
// and buildStartupSnapshotFromCurrentState.
export async function resolveGameMediaPathsBatch(
  appIds: string[],
): Promise<Record<string, GameMediaPaths>> {
  try {
    return await invoke<Record<string, GameMediaPaths>>("resolve_game_media_paths_batch", { appIds });
  } catch {
    return {};
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



export async function updateGameAppinfoMedia(appId: string, name: string | null, media: GameMediaPaths, remote?: GameRemoteRefsInput | null, mediaSources?: GameMediaSources | null): Promise<void> {
  return await invoke("update_game_appinfo_media", { appId, name, media, remote: remote ?? null, mediaSources: mediaSources ?? null });
}

export async function updateGameArtwork(appId: string, sgdb: SteamGridDbRef | null, paths: GameMediaPaths): Promise<void> {
  return await invoke("update_game_artwork", { appId, sgdb, paths });
}

// Migration
export async function migrateToCanonicalCache(): Promise<MigrationSummary> {
  return await invoke<MigrationSummary>("migrate_to_canonical_cache");
}

// ---------------------------------------------------------------------------
// Portable path resolvers (Part 4)
// ---------------------------------------------------------------------------

/** Resolve absolute path to a provider game directory. */
export async function resolveProviderGamePath(provider: string, appId: string): Promise<string> {
  return await invoke<string>("resolve_provider_game_path", { provider, appId });
}

/** Resolve absolute path for a game media file from relative path. */
export async function resolveGameMediaPath(provider: string, appId: string, relativePath: string): Promise<string> {
  return await invoke<string>("resolve_game_media_path", { provider, appId, relativePath });
}

/** Resolve absolute path to an achievement cache directory. */
export async function resolveAchievementPath(provider: string, appId: number): Promise<string> {
  return await invoke<string>("resolve_achievement_path", { provider, appId });
}

/** Resolve absolute path for an achievement image from relative path. */
export async function resolveAchievementImagePath(provider: string, appId: number, relativePath: string): Promise<string> {
  return await invoke<string>("resolve_achievement_image_path", { provider, appId, relativePath });
}

/** Convert an absolute path to a Tauri-compatible file:// URL. */
export async function resolveToTauriAssetUrl(absPath: string): Promise<string> {
  return await invoke<string>("resolve_to_tauri_asset_url", { absPath });
}

/** Scan all appinfo.json files and convert absolute paths to relative. */
export async function migrateGameMediaToRelative(): Promise<number> {
  return await invoke<number>("migrate_game_media_to_relative");
}

// ---------------------------------------------------------------------------
// Media Manifest — per-game fast media index
// ---------------------------------------------------------------------------

export type MediaManifestEntry = {
  path: string;
  exists: boolean;
  size?: number | null;
  modifiedAt?: number | null;
};

export type MediaManifestFiles = {
  cover: MediaManifestEntry;
  landscape: MediaManifestEntry;
  background: MediaManifestEntry;
  logo: MediaManifestEntry;
  icon: MediaManifestEntry;
};

export type FileFingerprints = {
  lua?: string | null;
  appinfo?: string | null;
  dashboard?: string | null;
};

export type MediaManifest = {
  provider: string;
  appid: string;
  version: number;
  updatedAt: number;
  files: MediaManifestFiles;
  fingerprints?: FileFingerprints | null;
};

export async function readMediaManifest(appId: string): Promise<MediaManifest | null> {
  return await invoke<MediaManifest | null>("read_media_manifest", { appId });
}

export async function writeMediaManifest(appId: string, manifest: MediaManifest): Promise<void> {
  return await invoke<void>("write_media_manifest", { appId, manifest });
}

export async function getMediaManifestsBatch(appIds: string[]): Promise<Record<string, MediaManifest>> {
  return await invoke<Record<string, MediaManifest>>("get_media_manifests_batch", { appIds });
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
  exePath?: string;
  exeName?: string;
  installDir?: string;
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

// ── Dev console exposure ──

if (typeof window !== "undefined") {
  const _w = window as unknown as Record<string, unknown>;
  _w.__validatePortablePaths = validatePortablePaths;
  _w.__validateGeneratedAchievementSchema = validateGeneratedAchievementSchema;
  _w.__cleanupAchievementOrphanImages = cleanupAchievementOrphanImages;
  _w.__validateCacheHealth = validateCacheHealth;
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

// ---------------------------------------------------------------------------
// Games table — full Steam dataset (Phase 3)
// ---------------------------------------------------------------------------

export type GameEntry = {
  appId: string;
  title: string;
  installed: boolean;
  playtime: number;
  lastPlayed: number;
  metadataJson: string;
  updatedAt: number;
};

export async function upsertGame(entry: GameEntry): Promise<void> {
  try {
    await invoke("upsert_game", { entry });
  } catch {
    // silent — best-effort only
  }
}

export async function batchUpsertGames(entries: GameEntry[]): Promise<void> {
  try {
    await invoke("batch_upsert_games", { entries });
  } catch {
    // silent — best-effort only
  }
}

export async function readAllGames(): Promise<GameEntry[]> {
  try {
    return await invoke<GameEntry[]>("read_all_games");
  } catch {
    return [];
  }
}

export async function getGameCount(): Promise<number> {
  try {
    return await invoke<number>("get_game_count");
  } catch {
    return 0;
  }
}

export async function scanAndBuildFullDataset(
  settings: { steamPath?: string; luaPath?: string; depotcachePath?: string; gameScanFolders?: string[] },
): Promise<number> {
  try {
    return await invoke<number>("scan_and_build_full_dataset", {
      steamPath: settings.steamPath || null,
      luaPath: settings.luaPath || null,
      depotcachePath: settings.depotcachePath || null,
      gameScanFolders: settings.gameScanFolders?.length ? settings.gameScanFolders : null,
    });
  } catch {
    return 0;
  }
}

// --- Installed Games Registry (file-based) ---

export async function readInstalledGamesRegistry(): Promise<string> {
  return await invoke<string>("read_installed_games_registry");
}

export async function writeInstalledGamesRegistry(data: string): Promise<void> {
  await invoke("write_installed_games_registry", { data });
}

// --- Hubcap API ---

export interface HubcapHealthResponse {
  status: string;
  elapsed_ms: number;
}

export interface HubcapUserStatsResponse {
  ok: boolean;
  status: string;
  username: string | null;
  today_usage: number | null;
  daily_limit: number | null;
  total_key_usage: number | null;
  generation_used: number | null;
  generation_limit: number | null;
  depot_keys_count: number | null;
  reset_at: number | string | null;
  reset_in_seconds: number | null;
  remaining: number | null;
  plan: string | null;
  last_used_at: string | null;
  api_key_usage_count: number | null;
  api_key_expires_at: string | null;
  can_make_requests: boolean | null;
  user_id: string | null;
  role_daily_limit: number | null;
  custom_api_limit: number | null;
  using_custom_api_limit: boolean | null;
  auto_update_enabled: boolean | null;
}

export interface HubcapDepotKeysResponse {
  status: string;
  count: number;
}

export async function hubcapHealth(baseUrl: string): Promise<HubcapHealthResponse> {
  return await invoke<HubcapHealthResponse>("hubcap_health", { baseUrl });
}

export async function hubcapUserStats(baseUrl: string, apiKey: string): Promise<HubcapUserStatsResponse> {
  return await invoke<HubcapUserStatsResponse>("hubcap_user_stats", { baseUrl, apiKey });
}

export interface HubcapAppStatusResponse {
  ok: boolean;
  status: string;
  app_id: string | null;
  game_name: string | null;
  manifest_file_exists: boolean | null;
  auto_update_enabled: boolean | null;
  update_in_progress: boolean | null;
  file_size: number | null;
  file_modified: string | null;
  file_age_days: number | null;
  needs_update: boolean | null;
  update_reason: string | null;
  timestamp: string | null;
}

export async function hubcapDepotKeys(baseUrl: string, apiKey: string): Promise<HubcapDepotKeysResponse> {
  return await invoke<HubcapDepotKeysResponse>("hubcap_depot_keys", { baseUrl, apiKey });
}

export async function hubcapAppStatus(baseUrl: string, apiKey: string, appId: string): Promise<HubcapAppStatusResponse> {
  return await invoke<HubcapAppStatusResponse>("hubcap_app_status", { baseUrl, apiKey, appId });
}

// --- File Metadata ---

export interface FileMetadata {
  exists: boolean;
  size: number | null;
  modified_unix_s: number | null;
  created_unix_s: number | null;
}

export async function getFileMetadata(path: string): Promise<FileMetadata> {
  return await invoke<FileMetadata>("get_file_metadata", { path });
}

// --- Provider Status Cache (sidecar JSON) ---

export interface ProviderStatusLocal {
  packagePath: string | null;
  luaPath: string | null;
  fileSizeAtInstall: number | null;
  fileModifiedAtInstall: string | null;
  fileCreatedAtInstall: string | null;
  metadataSource: string | null;
  providerTimestampAtInstall: string | null;
  checksumAtInstall: string | null;
  versionAtInstall: string | null;
  manifestIdsAtInstall: string[];
  depotIdsAtInstall: string[];
}

export interface ProviderStatusRemote {
  status: string;
  gameName: string | null;
  manifestFileExists: boolean | null;
  autoUpdateEnabled: boolean | null;
  updateInProgress: boolean | null;
  fileSize: number | null;
  fileModified: string | null;
  fileAgeDays: number | null;
  needsUpdate: boolean | null;
  updateReason: string | null;
  timestamp: string | null;
}

export interface ProviderStatusResult {
  status: string;
  reason: string;
}

export interface ProviderStatusFile {
  appId: string;
  providerId: string;
  providerName: string;
  checkedAt: number;
  installedAt: number | null;
  local: ProviderStatusLocal | null;
  remote: ProviderStatusRemote | null;
  result: ProviderStatusResult | null;
}

export async function readProviderStatus(appId: string, providerId: string): Promise<ProviderStatusFile | null> {
  return await invoke<ProviderStatusFile | null>("read_provider_status", { appId, providerId });
}

export async function writeProviderStatus(appId: string, providerId: string, payload: string): Promise<void> {
  await invoke("write_provider_status", { appId, providerId, payload });
}

// --- Provider Status Snapshot ---

export interface ProviderStatusSnapshotEntryLocal {
  fileSizeAtInstall?: number | null;
  fileModifiedAtInstall?: string | null;
  versionAtInstall?: string | null;
}

export interface ProviderStatusSnapshotEntryRemote {
  status?: string | null;
  fileSize?: number | null;
  fileModified?: string | null;
  needsUpdate?: boolean | null;
  updateReason?: string | null;
}

export interface ProviderStatusSnapshotEntry {
  appId: string;
  providerId: string;
  providerName?: string;
  status: string;
  reason?: string;
  checkedAt?: number;
  installedAt?: number;
  local?: ProviderStatusSnapshotEntryLocal;
  remote?: ProviderStatusSnapshotEntryRemote;
}

export interface ProviderStatusSnapshot {
  schemaVersion: number;
  updatedAt: number;
  entries: Record<string, ProviderStatusSnapshotEntry>;
}

export async function readProviderStatusSnapshot(): Promise<ProviderStatusSnapshot | null> {
  return await invoke<ProviderStatusSnapshot | null>("read_provider_status_snapshot");
}

export async function writeProviderStatusSnapshot(payload: string): Promise<void> {
  await invoke("write_provider_status_snapshot", { payload });
}

// --- Scan State ---

export interface ScanStateSummary {
  updates: number;
  upToDate: number;
  unknown: number;
  authRequired: number;
  providerUnavailable: number;
}

export interface ScanState {
  lastScanAt: number;
  intervalHours: number;
  lastResultHash: string | null;
  lastSummary: ScanStateSummary | null;
}

export async function readScanState(): Promise<ScanState | null> {
  return await invoke<ScanState | null>("read_scan_state");
}

export async function writeScanState(payload: string): Promise<void> {
  await invoke("write_scan_state", { payload });
}