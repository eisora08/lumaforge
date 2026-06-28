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