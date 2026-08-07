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
import type { SteamGridDbArtwork, SteamGridDbGameSearchResult } from "../types/steamGridDb";
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


const LUA_SCAN_TTL_MS = 30_000;
let _luaScanCache: { luaPath: string; result: InstalledLuaScript[]; ts: number } | null = null;
let _luaScanInFlight: { luaPath: string; promise: Promise<InstalledLuaScript[]> } | null = null;

function invalidateLuaScanCache(): void {
  // Null both the cached result and the in-flight scan so an orphaned boot scan
  // that completes later cannot re-populate stale (pre-mutation) state.
  _luaScanCache = null;
  _luaScanInFlight = null;
}

export async function scanInstalledLuaScripts(
  luaPath: string,
  options?: { force?: boolean }
): Promise<InstalledLuaScript[]> {
  const force = options?.force === true;
  if (
    !force &&
    _luaScanCache &&
    _luaScanCache.luaPath === luaPath &&
    Date.now() - _luaScanCache.ts < LUA_SCAN_TTL_MS
  ) {
    return _luaScanCache.result;
  }
  if (!force && _luaScanInFlight && _luaScanInFlight.luaPath === luaPath) {
    return _luaScanInFlight.promise;
  }
  let wrapped: Promise<InstalledLuaScript[]>;
  const raw = invoke<InstalledLuaScript[]>("scan_installed_lua_scripts", { luaPath });
  wrapped = raw
    .then((result) => {
      if (_luaScanInFlight && _luaScanInFlight.promise === wrapped) {
        _luaScanCache = { luaPath, result, ts: Date.now() };
      }
      return result;
    })
    .finally(() => {
      if (_luaScanInFlight && _luaScanInFlight.promise === wrapped) {
        _luaScanInFlight = null;
      }
    });
  _luaScanInFlight = { luaPath, promise: wrapped };
  return await wrapped;
}


export async function setLuaScriptEnabled(params: {
  luaPath: string;
  fileName: string;
  enabled: boolean;
}): Promise<LuaActionResult> {
  invalidateLuaScanCache();
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
  invalidateLuaScanCache();
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

// Global scan guard — prevents concurrent Steam scans (each takes ~3s, blocks thread pool)
let _steamScanPromise: Promise<SteamInstalledGame[]> | null = null;

export async function scanSteamInstalledGames(params?: {
  steamPath?: string;
  luaPath?: string;
  depotcachePath?: string;
  gameScanFolders?: string[];
}): Promise<SteamInstalledGame[]> {
  // If a scan is already in progress, wait for it instead of starting another
  if (_steamScanPromise) {
    console.log("[STEAM_SCAN][GUARD] reusing in-progress scan");
    return _steamScanPromise;
  }
  _steamScanPromise = invoke<SteamInstalledGame[]>("scan_steam_installed_games", {
    steamPath: params?.steamPath ?? null,
    luaPath: params?.luaPath ?? null,
    depotcachePath: params?.depotcachePath ?? null,
    gameScanFolders: params?.gameScanFolders ?? null,
  }).finally(() => { _steamScanPromise = null; });
  return _steamScanPromise;
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

export async function openSteamLibrary(appId: number): Promise<void> {
  return await invoke("open_steam_library", { appId });
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

// ── Achievement Progress Index ──

export interface AchievementProgressEntry {
  appId: number;
  unlocked: number;
  total: number;
  percentage: number;
  allUnlocked: boolean;
  cacheTime: number;
}

export async function readAchievementProgressIndex(params: {
  steamPath?: string;
  steamAccountId: string;
}): Promise<AchievementProgressEntry[]> {
  return await invoke<AchievementProgressEntry[]>("read_achievement_progress_index", {
    steamPath: params.steamPath ?? null,
    steamAccountId: params.steamAccountId,
  });
}

// ── Verified Steam Achievement Sources ──

export interface RejectedSourceFileTs {
  fileName: string;
  sourceKind: string;
  reason: string;
}

export interface VerifiedSourceFileTs {
  sourceKind: string;
  logicalPath: string;
  absolutePath: string;
  size: number;
  modifiedAt: number;
  checksum: string;
  requiresSteamClosed: boolean;
}

export interface VerifiedSourceGameEntryTs {
  appId: string;
  files: VerifiedSourceFileTs[];
  totalSize: number;
}

export interface VerifiedSourcesManifestTs {
  schemaVersion: number;
  accountScope: string;
  steamRoot: string;
  totalGames: number;
  totalFiles: number;
  totalSize: number;
  games: VerifiedSourceGameEntryTs[];
  rejected: RejectedSourceFileTs[];
  statsCount: number;
  schemaCount: number;
  librarycacheCount: number;
}

export interface ExportedSourceFileTs {
  logicalPath: string;
  sourceKind: string;
  base64Content: string;
  checksum: string;
  size: number;
}

export interface ExportedSourceResultTs {
  appId: string;
  files: ExportedSourceFileTs[];
  totalSize: number;
}

export interface SteamProcessCheckResultTs {
  running: boolean;
  message: string;
}

export interface RestoreSourceResultTs {
  restored: number;
  failed: number;
  errors: string[];
  checksumsValid: boolean;
}

export async function auditSteamAchievementSources(
  steamPath?: string,
  steamAccountId?: string,
): Promise<VerifiedSourcesManifestTs> {
  return await invoke<VerifiedSourcesManifestTs>(
    "audit_steam_achievement_sources",
    {
      steamPath: steamPath || null,
      steamAccountId: steamAccountId || "",
    },
  );
}

export async function exportSteamAchievementSourcesRaw(
  steamPath?: string,
  steamAccountId?: string,
  appIds?: string[],
): Promise<ExportedSourceResultTs[]> {
  return await invoke<ExportedSourceResultTs[]>(
    "export_steam_achievement_sources",
    {
      steamPath: steamPath || null,
      steamAccountId: steamAccountId || "",
      appIds: appIds || [],
    },
  );
}

export async function readSteamAchievementSourceForGame(
  steamPath?: string,
  steamAccountId?: string,
  appId?: string,
): Promise<ExportedSourceResultTs | null> {
  return (
    (await invoke<ExportedSourceResultTs | null>(
      "read_steam_achievement_source_for_game",
      {
        steamPath: steamPath || null,
        steamAccountId: steamAccountId || "",
        appId: appId || "",
      },
    )) ?? null
  );
}

export async function checkSteamRunning(): Promise<SteamProcessCheckResultTs> {
  return await invoke<SteamProcessCheckResultTs>("check_steam_running");
}

export async function restoreSteamAchievementSources(
  steamPath?: string,
  steamAccountId?: string,
  exports?: ExportedSourceResultTs[],
): Promise<RestoreSourceResultTs> {
  return await invoke<RestoreSourceResultTs>(
    "restore_steam_achievement_sources",
    {
      steamPath: steamPath || null,
      steamAccountId: steamAccountId || "",
      exports: exports || [],
    },
  );
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

export async function searchSteamGridDbGames(
  name: string,
  apiKey: string
): Promise<SteamGridDbGameSearchResult[]> {
  return await invoke<SteamGridDbGameSearchResult[]>(
    "search_steamgriddb_games",
    { name, apiKey }
  );
}

export async function resolveSteamGridDbArtworkByGameId(
  sgdbGameId: number,
  apiKey: string
): Promise<SteamGridDbArtwork> {
  return await invoke<SteamGridDbArtwork>(
    "resolve_steamgriddb_artwork_by_game_id",
    { sgdbGameId, apiKey }
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

export async function launchExecutable(
  path: string,
  args?: string[],
  workingDir?: string,
): Promise<SpawnResult> {
  return await invoke<SpawnResult>("launch_executable", {
    path,
    args: args ?? null,
    workingDir: workingDir ?? null,
  });
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

export async function readStoreSgdbArtworkCache(): Promise<unknown | null> {
  return await invoke<unknown | null>("read_store_sgdb_artwork_cache");
}

export async function writeStoreSgdbArtworkCache(data: unknown): Promise<void> {
  return await invoke<void>("write_store_sgdb_artwork_cache", { data });
}

export async function readStoreCatalogSectionsCache(): Promise<unknown | null> {
  return await invoke<unknown | null>("read_store_catalog_sections_cache");
}

export async function writeStoreCatalogSectionsCache(data: unknown): Promise<void> {
  return await invoke<void>("write_store_catalog_sections_cache", { data });
}

// --- Store catalog (versioned local index) ---

/**
 * Result from `get_catalog_meta` — indicates whether a catalog has been
 * imported into SQLite and its version/checksum for freshness checks.
 */
export type CatalogMetaResult = {
  schemaVersion: number;
  catalogVersion: number;
  importedAt: string;
  recordCount: number;
  gameCount: number;
  checksum: string;
  hasCatalog: boolean;
};

/**
 * Single catalog game record returned by all query commands.
 * Maps 1:1 to the Rust `CatalogGameResult` struct (camelCase serialization).
 */
export type CatalogGameResult = {
  appId: number;
  name: string;
  type: string;
  genres: string[];
  categories: string[];
  releaseTimestamp: number;
  comingSoon: boolean;
  isFree: boolean;
  reviewPercent: number;
  reviewCount: number;
  headerImage: string;
  capsuleImage: string;
  developers: string[];
  publishers: string[];
};

/** Read catalog metadata (schema version, game count, checksum). */
export async function getCatalogMeta(): Promise<CatalogMetaResult> {
  return await invoke<CatalogMetaResult>("get_catalog_meta");
}

/** Import a catalog artifact JSON blob into SQLite. Returns number of records inserted. */
export async function importSteamCatalog(
  artifactJson: string,
  checksum: string,
): Promise<number> {
  return await invoke<number>("import_steam_catalog", { artifactJson, checksum });
}

/** Query catalog games by genre, ordered by review score descending. */
export async function queryCatalogByGenre(
  genre: string,
  limit: number,
  offset: number,
): Promise<CatalogGameResult[]> {
  return await invoke<CatalogGameResult[]>("query_catalog_by_genre", { genre, limit, offset });
}

/** Search catalog games by name (case-insensitive LIKE match). */
export async function queryCatalogSearch(
  query: string,
  limit: number,
): Promise<CatalogGameResult[]> {
  return await invoke<CatalogGameResult[]>("query_catalog_search", { query, limit });
}

/** Get a single catalog game by Steam app ID. Returns null if not found. */
export async function queryCatalogGame(
  appId: number,
): Promise<CatalogGameResult | null> {
  return await invoke<CatalogGameResult | null>("query_catalog_game", { appId });
}

/** Query featured games (high review percent + minimum review count + has image). */
export async function queryCatalogFeatured(
  limit: number,
): Promise<CatalogGameResult[]> {
  return await invoke<CatalogGameResult[]>("query_catalog_featured", { limit });
}

/** Query new & noteworthy games (released within 180 days, not coming soon). */
export async function queryCatalogNewNoteworthy(
  limit: number,
): Promise<CatalogGameResult[]> {
  return await invoke<CatalogGameResult[]>("query_catalog_new_noteworthy", { limit });
}

/** Query hidden gems (high review%, moderate review count, niche but beloved). */
export async function queryCatalogHiddenGems(
  limit: number,
): Promise<CatalogGameResult[]> {
  return await invoke<CatalogGameResult[]>("query_catalog_hidden_gems", { limit });
}

/** Query top rated games (highest review% with significant review count). */
export async function queryCatalogTopRated(
  limit: number,
): Promise<CatalogGameResult[]> {
  return await invoke<CatalogGameResult[]>("query_catalog_top_rated", { limit });
}

/** Query cult classics (old + high review% + sustained community). */
export async function queryCatalogCultClassics(
  limit: number,
): Promise<CatalogGameResult[]> {
  return await invoke<CatalogGameResult[]>("query_catalog_cult_classics", { limit });
}

// --- Repack catalog ---

export type RepackQueryResult = {
  id: string;
  title: string;
  appId: number;
  repacker: string;
  installerType: string;
  fileSize: number;
  installSize: number | null;
  languages: string[];
  downloadUris: string[];
  sourceUrl: string;
  checksum: string | null;
  updatedAt: string;
  tags: string[];
};

export type RepackCatalogMeta = {
  hasCatalog: boolean;
  schemaVersion: number;
  recordCount: number;
  gamesWithAppId: number;
  checksum: string;
  importedAt: string;
};

export type RepackGroupStat = {
  repacker: string;
  count: number;
};

/** Get repack catalog metadata (counts, version, checksum). */
export async function getRepackCatalogMeta(): Promise<RepackCatalogMeta> {
  return await invoke<RepackCatalogMeta>("get_repack_catalog_meta");
}

/** Import a repack catalog artifact JSON blob into SQLite. Returns number of records inserted. */
export async function importRepackCatalog(
  artifactJson: string,
  checksum: string,
): Promise<number> {
  return await invoke<number>("import_repack_catalog", { artifactJson, checksum });
}

/** Query repack catalog by fuzzy title match (case-insensitive). */
export async function queryRepackCatalogFuzzy(
  query: string,
  limit: number,
): Promise<RepackQueryResult[]> {
  return await invoke<RepackQueryResult[]>("query_repack_catalog_fuzzy", { query, limit });
}

/** Query repack catalog by fuzzy title match constrained to a single repacker. */
export async function queryRepackCatalogByRepackerFuzzy(
  repacker: string,
  query: string,
  limit: number,
): Promise<RepackQueryResult[]> {
  return await invoke<RepackQueryResult[]>("query_repack_catalog_by_repacker_fuzzy", {
    repacker,
    query,
    limit,
  });
}

/** Query repack catalog by Steam app ID — returns all repacks for that app. */
export async function queryRepackCatalogByAppId(
  appId: number,
): Promise<RepackQueryResult[]> {
  return await invoke<RepackQueryResult[]>("query_repack_catalog_by_app_id", { appId });
}

/** Query all repack catalog entries. */
export async function queryRepackCatalogAll(): Promise<RepackQueryResult[]> {
  return await invoke<RepackQueryResult[]>("query_repack_catalog_all");
}

/** Query repack catalog by repacker name, with pagination. */
export async function queryRepackCatalogByRepacker(
  repacker: string,
  limit: number,
  offset: number,
): Promise<RepackQueryResult[]> {
  return await invoke<RepackQueryResult[]>("query_repack_catalog_by_repacker", {
    repacker, limit, offset,
  });
}

/** Query a page of the whole repack catalog (browse-all). */
export async function queryRepackCatalogPage(
  limit: number,
  offset: number,
): Promise<RepackQueryResult[]> {
  return await invoke<RepackQueryResult[]>("query_repack_catalog_page", { limit, offset });
}

/** List distinct repackers with entry counts (for filter chips). */
export async function queryRepackRepackers(): Promise<RepackGroupStat[]> {
  return await invoke<RepackGroupStat[]>("query_repack_repackers");
}

// --- Debrid Installer ---

/** Result from download_debrid_package — download + extract or save installer. */
export type DebridDownloadResult = {
  success: boolean;
  status: "ready" | "needs-setup" | "installing" | "paused" | "downloaded";
  installDir: string;
  executablePath: string | null;
  installerPath: string | null;
  installerPid: number | null;
  message: string;
};

/** Result from setup_debrid_game — run the already-extracted installer. */
export type DebridSetupResult = {
  success: boolean;
  status: "ready" | "installing";
  installDir: string;
  executablePath: string | null;
  installerPath: string | null;
  installerPid: number | null;
  message: string;
};

/** Result from check_installer_status — poll an installer process. */
export type InstallerCheckResult = {
  status: "running" | "ready" | "needs-path";
  executablePath: string | null;
  error: string | null;
};

/** Result from verify_debrid_installation — check if game .exe exists. */
export type DebridVerifyResult = {
  installed: boolean;
  installDir: string;
  executablePath: string | null;
};

/**
 * Download a Debrid repack: download + extract (ZIP/RAR) or save installer (EXE/SFX).
 * `autoExtract=false` stops after the download (status `"downloaded"`, archive left on disk);
 * `deleteArchive=true` removes the `.rar`/`.zip` after a successful extraction.
 */
export async function downloadDebridPackage(params: {
  jobId: string;
  downloadUri: string;
  downloadName?: string;
  destDir: string;
  autoExtract: boolean;
  deleteArchive: boolean;
  /**
   * Stable origin URL (the page/magnet the user started from, i.e. the job's
   * `downloadUrl`), used to key the `.part` resume checkpoint. The resolved
   * CDN link in `downloadUri` can rotate between calls (gofile); keying the
   * checkpoint on it would restart the download on every resume.
   */
  sourceKey?: string;
}): Promise<DebridDownloadResult> {
  return await invoke<DebridDownloadResult>("download_debrid_package", params);
}

/**
 * Download a Debrid repack whose source is a `magnet:` URI via the built-in
 * torrent client (librqbit). Returns the same `DebridDownloadResult` shape as
 * `download_debrid_package`, so the install pipeline is unchanged.
 * `autoExtract=false` stops after the download (status `"downloaded"`);
 * `deleteArchive` removes the `.rar`/`.zip` after a successful extraction.
 */
export async function startTorrentDownload(params: {
  jobId: string;
  magnet: string;
  destDir: string;
  autoExtract: boolean;
  deleteArchive: boolean;
}): Promise<DebridDownloadResult> {
  return await invoke<DebridDownloadResult>("start_torrent_download", params);
}

/**
 * Run a previously-downloaded repack installer (setup.exe) in the foreground.
 * This is the second phase for `needs-setup` results — no download, no extraction.
 */
export async function setupDebridGame(params: {
  installerPath: string;
  installDir: string;
}): Promise<DebridSetupResult> {
  return await invoke<DebridSetupResult>("setup_debrid_game", params);
}

/** Abort an in-flight debrid download by job ID. */
export async function cancelDebridDownload(jobId: string): Promise<void> {
  await invoke("cancel_debrid_download", { jobId });
}

/**
 * Pause an in-flight debrid download by job ID. HTTP downloads checkpoint a
 * `.part` file; torrent downloads keep fastresume + persistence. Both can be
 * resumed later by re-invoking `downloadDebridPackage` / `startTorrentDownload`.
 */
export async function pauseDebridDownload(jobId: string): Promise<void> {
  await invoke("pause_debrid_download", { jobId });
}

/** Check whether a Debrid install directory has a game executable. */
export async function verifyDebridInstallation(params: {
  installDir: string;
}): Promise<DebridVerifyResult> {
  return await invoke<DebridVerifyResult>("verify_debrid_installation", params);
}

export type DebridLaunchResult = {
  success: boolean;
  method: string;
  error?: string | null;
  pid?: number | null;
};

export async function launchDebridGame(params: {
  executablePath: string;
  launchArguments?: string | null;
  workingDirectory?: string | null;
}): Promise<DebridLaunchResult> {
  return await invoke<DebridLaunchResult>("launch_debrid_game", params);
}

/** Poll an installer process status by PID. */
export async function checkInstallerStatus(params: {
  pid: number;
  installDir: string;
}): Promise<InstallerCheckResult> {
  return await invoke<InstallerCheckResult>("check_installer_status", params);
}

/** Re-run the installer (detached) after a previous run failed or was cancelled. */
export async function runInstallerAgain(params: {
  installerPath: string;
  installDir: string;
}): Promise<DebridDownloadResult> {
  return await invoke<DebridDownloadResult>("run_installer_again", params);
}

/** Result from scanning Windows Uninstall registry for a game. */
export type RegistryMatch = {
  installLocation: string;
  displayIcon: string | null;
  displayName: string | null;
  confidence: number;
};

/** Scan Windows Uninstall registry for a game matching the given title. */
export async function detectInstallPathFromRegistry(gameTitle: string): Promise<RegistryMatch | null> {
  return await invoke<RegistryMatch | null>("detect_install_path_from_registry", { gameTitle });
}

// --- Debrid Games Registry ---

export type DebridGameEntryJson = {
  id: string;
  appId?: number | null;
  title: string;
  status: string; // "not-downloaded" | "downloading" | "needs-install" | "waiting-installer" | "ready"
  installDir?: string | null;
  executablePath?: string | null;
  workingDirectory?: string | null;
  installerPath?: string | null;
  launchArguments?: string[] | null;
  repacker?: string | null;
  fileSize?: number | null;
  installSize?: number | null;
  installedAt: number;
  updatedAt: number;
};

/** Read all installed Debrid game entries from `games/debrid/debrid-games.json`. */
export async function readDebridGames(): Promise<DebridGameEntryJson[]> {
  return await invoke<DebridGameEntryJson[]>("read_debrid_games");
}

/** Atomically write the full Debrid games array to `games/debrid/debrid-games.json`. */
export async function writeDebridGames(entries: DebridGameEntryJson[]): Promise<void> {
  return await invoke<void>("write_debrid_games", { entries });
}

/** Create a timestamped backup of `debrid-games.json`. Returns backup filename. */
export async function backupDebridGames(): Promise<string> {
  return await invoke<string>("backup_debrid_games");
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
  userData: Record<string, unknown> | null;
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

export async function batchUpdateGameNames(apps: [string, string | null][]): Promise<number> {
  return await invoke<number>("batch_update_game_names", { apps });
}

export async function saveGameMediaFile(appId: string, role: string, contentBase64: string, ext: string): Promise<string> {
  return await invoke<string>("save_game_media_file", { appId, role, contentBase64, ext });
}

export async function deleteGameMediaFile(appId: string, role: string): Promise<void> {
  return await invoke("delete_game_media_file", { appId, role });
}

// ── Provider-aware media commands (Step 7) ──

export async function saveProviderMediaFromPath(
  provider: string,
  providerGameId: string,
  role: string,
  sourcePath: string,
): Promise<string> {
  return await invoke<string>("save_provider_media_from_path", {
    provider,
    providerGameId,
    role,
    sourcePath,
  });
}

export async function downloadProviderMediaFromUrl(
  provider: string,
  providerGameId: string,
  role: string,
  url: string,
): Promise<string> {
  return await invoke<string>("download_provider_media_from_url", {
    provider,
    providerGameId,
    role,
    url,
  });
}

export async function deleteProviderMediaFile(
  provider: string,
  providerGameId: string,
  role: string,
): Promise<void> {
  return await invoke("delete_provider_media_file", {
    provider,
    providerGameId,
    role,
  });
}

export async function saveProviderMediaFromBase64(
  provider: string,
  providerGameId: string,
  role: string,
  contentBase64: string,
  ext: string,
): Promise<string> {
  return await invoke<string>("save_provider_media_from_base64", {
    provider,
    providerGameId,
    role,
    contentBase64,
    ext,
  });
}

export async function openFolder(path: string): Promise<void> {
  return await invoke("open_folder", { path });
}

export async function openGameMetadataFolder(appId: string): Promise<void> {
  return await invoke("open_game_metadata_folder", { appId });
}

export async function openGameMediaFolder(appId: string): Promise<void> {
  return await invoke("open_game_media_folder", { appId });
}

export async function openProviderMediaFolder(providerId: string, providerGameId: string): Promise<void> {
  return await invoke("open_provider_media_folder", { provider: providerId, providerGameId });
}

// ── Provider media directory listing ──

export type ProviderMediaFileEntry = {
  filename: string;
  role: string;
  extension: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: number | null;
};

export async function listProviderMediaFiles(
  provider: string,
  providerGameId: string,
): Promise<ProviderMediaFileEntry[]> {
  const raw = await invoke<Array<{
    filename: string;
    role: string;
    extension: string;
    relative_path: string;
    size_bytes: number;
    modified_at: number | null;
  }>>("list_provider_media_files", { provider, providerGameId });
  return raw.map((e) => ({
    filename: e.filename,
    role: e.role,
    extension: e.extension,
    relativePath: e.relative_path,
    sizeBytes: e.size_bytes,
    modifiedAt: e.modified_at,
  }));
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

// ── Backup Archive ──

export type BackupFileInfo = {
  relative_path: string;
  section: string;
  size: number;
  checksum: string;
};

export type BackupManifestJson = {
  schema_version: number;
  backup_id: string;
  created_at: string;
  app_version: string;
  device_id: string;
  sections: Record<string, boolean>;
  files: BackupFileInfo[];
  total_size: number;
  total_files: number;
};

export async function writeBackupArchive(
  backupJson: string,
  filename: string,
): Promise<string> {
  return await invoke<string>("write_backup_archive", { backupJson, filename });
}

export async function readBackupArchive(filename: string): Promise<string> {
  return await invoke<string>("read_backup_archive", { filename });
}

export async function listBackupArchives(): Promise<string[]> {
  return await invoke<string[]>("list_backup_archives");
}

export async function deleteBackupArchive(filename: string): Promise<void> {
  return await invoke("delete_backup_archive", { filename });
}

export async function validateBackupFile(filename: string): Promise<BackupManifestJson> {
  return await invoke<BackupManifestJson>("validate_backup_file", { filename });
}

// ── External file collection (backup for Lua / achievement disk files) ──

export type ExternalFileEntry = {
  relativePath: string;
  absolutePath: string;
  size: number;
  modifiedAt: number;
  checksum: string;
  fileName: string;
};

export type ExternalFileCollection = {
  rootLabel: string;
  rootPath: string;
  totalFiles: number;
  totalSize: number;
  files: ExternalFileEntry[];
};

export type ExternalFileRestoreEntry = {
  relativePath: string;
  content: string;
  expectedChecksum: string;
};

export type ExternalRestoreResult = {
  restored: number;
  failed: number;
  errors: string[];
};

export type ExternalVerifyResult = {
  allValid: boolean;
  checked: number;
  errors: string[];
};

export async function scanExternalFileCollection(
  rootPath: string,
  rootLabel: string,
  allowedExtensions: string[],
  maxFileSize?: number,
  maxFiles?: number,
): Promise<ExternalFileCollection> {
  return await invoke<ExternalFileCollection>("scan_external_file_collection", {
    rootPath,
    rootLabel,
    allowedExtensions,
    maxFileSize,
    maxFiles,
  });
}

export async function readFileCollectionContent(
  rootPath: string,
  relativePaths: string[],
): Promise<Record<string, string>> {
  return await invoke<Record<string, string>>("read_file_collection_content", {
    rootPath,
    relativePaths,
  });
}

export async function restoreExternalFiles(
  targetRoot: string,
  files: ExternalFileRestoreEntry[],
  dryRun?: boolean,
): Promise<ExternalRestoreResult> {
  return await invoke<ExternalRestoreResult>("restore_external_files", {
    targetRoot,
    files,
    dryRun,
  });
}

export async function createExternalSafetyBackup(
  operationId: string,
  sourceRoot: string,
  relativePaths: string[],
): Promise<string> {
  return await invoke<string>("create_external_safety_backup", {
    operationId,
    sourceRoot,
    relativePaths,
  });
}

export async function restoreFromSafetyBackup(
  operationId: string,
  targetRoot: string,
  relativePaths: string[],
): Promise<ExternalRestoreResult> {
  return await invoke<ExternalRestoreResult>("restore_from_safety_backup", {
    operationId,
    targetRoot,
    relativePaths,
  });
}

export async function verifyFileChecksums(
  rootPath: string,
  files: [string, string][],
): Promise<ExternalVerifyResult> {
  return await invoke<ExternalVerifyResult>("verify_file_checksums", {
    rootPath,
    files,
  });
}

export async function resolveAchievementsRootDir(
  provider: string,
): Promise<string> {
  return await invoke<string>("resolve_achievements_root_dir", {
    provider,
  });
}

// ── Extension Lifecycle ──

export interface LuaFunctionResult {
  success: boolean;
  value: string | null;
  error: string | null;
}

export interface LuaExtensionTable {
  name: string;
  version: string;
  min_launcher_version: string | null;
  has_detect: boolean;
  has_install: boolean;
  has_enable: boolean;
  has_disable: boolean;
  has_uninstall: boolean;
  error: string | null;
}

export interface ExtensionDirEntry {
  dir_name: string;
  manifest_json: string | null;
  has_extension_lua: boolean;
}

export interface ScanExtensionsResult {
  entries: ExtensionDirEntry[];
}

/**
 * Load a Lua extension into the backend engine.
 * Must be called before any lifecycle functions.
 */
export async function loadExtension(
  extensionId: string,
  scriptPath: string,
): Promise<LuaExtensionTable> {
  return await invoke<LuaExtensionTable>("load_extension", {
    extensionId,
    scriptPath,
  });
}

/**
 * Call the detect lifecycle function on a loaded Lua extension.
 */
export async function callExtensionDetect(
  extensionId: string,
  installDir: string,
): Promise<LuaFunctionResult> {
  return await invoke<LuaFunctionResult>("call_extension_detect", {
    extensionId,
    installDir,
  });
}

/**
 * Call the install lifecycle function on a loaded Lua extension.
 */
export async function callExtensionInstall(
  extensionId: string,
  installDir: string,
): Promise<LuaFunctionResult> {
  return await invoke<LuaFunctionResult>("call_extension_install", {
    extensionId,
    installDir,
  });
}

/**
 * Call the enable lifecycle function on a loaded Lua extension.
 */
export async function callExtensionEnable(
  extensionId: string,
  installDir: string,
): Promise<LuaFunctionResult> {
  return await invoke<LuaFunctionResult>("call_extension_enable", {
    extensionId,
    installDir,
  });
}

/**
 * Call the disable lifecycle function on a loaded Lua extension.
 */
export async function callExtensionDisable(
  extensionId: string,
  installDir: string,
): Promise<LuaFunctionResult> {
  return await invoke<LuaFunctionResult>("call_extension_disable", {
    extensionId,
    installDir,
  });
}

/**
 * Call the uninstall lifecycle function on a loaded Lua extension.
 */
export async function callExtensionUninstall(
  extensionId: string,
  installDir: string,
): Promise<LuaFunctionResult> {
  return await invoke<LuaFunctionResult>("call_extension_uninstall", {
    extensionId,
    installDir,
  });
}

/**
 * Scan a directory for extension subdirectories.
 * Returns entries for subdirectories that contain manifest.json and/or extension.lua.
 */
export async function scanExtensionsDirectory(
  basePath: string,
): Promise<ScanExtensionsResult> {
  return await invoke<ScanExtensionsResult>("scan_extensions_directory", {
    basePath,
  });
}

// =============================================================================
// Extension Config (cascading lifecycle support)
// =============================================================================

export interface ExtensionConfig {
  enabled: boolean;
}

/**
 * Write an extension-config.json into the extension's AppData directory.
 * This marks the extension as enabled or disabled in the local registry.
 */
export async function writeExtensionConfig(
  dirPath: string,
  enabled: boolean,
): Promise<void> {
  return await invoke("write_extension_config", { dirPath, enabled });
}

/**
 * Read the extension-config.json from the extension's AppData directory.
 * Returns null when the file doesn't exist (pre-migration or first boot).
 */
export async function readExtensionConfig(
  dirPath: string,
): Promise<ExtensionConfig | null> {
  return await invoke<ExtensionConfig | null>("read_extension_config", {
    dirPath,
  });
}

/**
 * Delete the extension's entire AppData directory (extension.lua,
 * manifest.json, config, and any other state files).
 */
export async function deleteExtensionDirectory(
  dirPath: string,
): Promise<void> {
  return await invoke("delete_extension_directory", { dirPath });
}

export async function resolveAppDataDir(): Promise<string> {
  return await invoke<string>("resolve_app_data_dir");
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

export async function updateGameMetadataJson(appId: string, metadataJson: string): Promise<void> {
  try {
    await invoke("update_game_metadata_json", { appId, metadataJson });
  } catch {
    // silent — best-effort sync
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

// ---------------------------------------------------------------------------
// Achievement SQLite tables — volatile per-game progress
// ---------------------------------------------------------------------------

export type AchievementSummaryRow = {
  appId: string;
  unlocked: number;
  total: number;
  percent?: number;
  progressAvailable?: boolean;
  source?: string;
  inProgress?: number;
  completionTime?: number | null;
  lastUnlockAt?: number | null;
  updatedAt: number;
};

export async function upsertAchievementSummary(row: AchievementSummaryRow): Promise<void> {
  try {
    await invoke("upsert_achievement_summary", { row });
  } catch {
    // silent — best-effort
  }
}

export async function getAchievementSummaryFromDb(appId: string): Promise<AchievementSummaryRow | null> {
  try {
    return await invoke<AchievementSummaryRow | null>("get_achievement_summary", { appId });
  } catch {
    return null;
  }
}

export async function batchGetAchievementSummaries(appIds: string[]): Promise<AchievementSummaryRow[]> {
  try {
    return await invoke<AchievementSummaryRow[]>("batch_get_achievement_summaries", { appIds });
  } catch {
    return [];
  }
}

export type AchievementEntryRow = {
  appId: string;
  apiName: string;
  name?: string | null;
  description?: string | null;
  iconUrl?: string | null;
  iconGray?: string | null;
  hidden: boolean;
  unlocked: boolean;
  unlockTime?: number | null;
  unlockedAt?: number | null;
  globalPct?: number | null;
  updatedAt: number;
};

export async function upsertAchievementEntry(row: AchievementEntryRow): Promise<void> {
  try {
    await invoke("upsert_achievement_entry", { row });
  } catch {
    // silent — best-effort
  }
}

export async function batchUpsertAchievementEntries(entries: AchievementEntryRow[]): Promise<void> {
  try {
    await invoke("batch_upsert_achievement_entries", { entries });
  } catch {
    // silent — best-effort
  }
}

export async function getAchievementEntriesFromDb(appId: string): Promise<AchievementEntryRow[]> {
  try {
    return await invoke<AchievementEntryRow[]>("get_achievement_entries", { appId });
  } catch {
    return [];
  }
}

export type AchievementPercentageRow = {
  appId: string;
  entries: string;
  updatedAt: number;
};

export async function upsertAchievementPercentages(row: AchievementPercentageRow): Promise<void> {
  try {
    await invoke("upsert_achievement_percentages", { row });
  } catch {
    // silent — best-effort
  }
}

export async function getAchievementPercentagesFromDb(appId: string): Promise<AchievementPercentageRow | null> {
  try {
    return await invoke<AchievementPercentageRow | null>("get_achievement_percentages", { appId });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Achievement read with SQLite-first fallback
// ---------------------------------------------------------------------------

/**
 * Reads achievement cache: tries SQLite tables first, falls back to JSON file.
 * Returns the same `AppAchievementCache` shape consumers expect.
 */
export async function readAchievementCacheWithFallback(appId: number): Promise<AppAchievementCache | null> {
  const appIdStr = String(appId);
  try {
    const [summary, entries, pctRow] = await Promise.all([
      getAchievementSummaryFromDb(appIdStr),
      getAchievementEntriesFromDb(appIdStr),
      getAchievementPercentagesFromDb(appIdStr),
    ]);

    if (summary && entries.length > 0) {
      const percentages: AppAchievementPercentagesEntry[] = pctRow?.entries
        ? JSON.parse(pctRow.entries)
        : [];

      return {
        summary: {
          app_id: summary.appId,
          total: summary.total,
          unlocked: summary.unlocked ?? 0,
          percent: summary.percent ?? (summary.total > 0 ? Math.round((summary.unlocked / summary.total) * 100) : 0),
          progress_available: summary.progressAvailable ?? (summary.total > 0),
          source: summary.source ?? "sqlite",
          updated_at: summary.updatedAt,
        },
        achievements: entries.map((e, idx) => ({
          id: e.apiName || String(idx),
          api_name: e.apiName,
          name: e.name ?? e.apiName,
          description: e.description ?? "",
          icon: e.iconUrl ?? undefined,
          icon_url: e.iconUrl ?? undefined,
          icon_gray: e.iconGray ?? undefined,
          icon_gray_url: e.iconGray ?? undefined,
          unlocked: e.unlocked,
          unlock_time: e.unlockTime ?? undefined,
          rarity_percent: e.globalPct ?? undefined,
        })),
        achievement_percentages: percentages,
      };
    }
  } catch {
    // SQLite read failed — fall through to JSON
  }

  // Fallback: read from JSON files
  return readAchievementCache(appId);
}

// ---------------------------------------------------------------------------
// Store reviews — replaces store/reviews/{appid}.json
// ---------------------------------------------------------------------------

export type StoreReviewRow = {
  appId: string;
  data: string;
  updatedAt: number;
};

export async function upsertStoreReview(row: StoreReviewRow): Promise<void> {
  try {
    await invoke("upsert_store_review", { row });
  } catch {
    // silent — best-effort
  }
}

export async function getStoreReviewFromDb(appId: string): Promise<StoreReviewRow | null> {
  try {
    return await invoke<StoreReviewRow | null>("get_store_review", { appId });
  } catch {
    return null;
  }
}

export async function batchGetStoreReviews(appIds: string[]): Promise<StoreReviewRow[]> {
  try {
    return await invoke<StoreReviewRow[]>("batch_get_store_reviews", { appIds });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Provider status — replaces store/provider-status/{appId}/{providerId}.json
// ---------------------------------------------------------------------------

export type ProviderStatusRow = {
  appId: string;
  providerId: string;
  data: string;
  updatedAt: number;
};

export async function upsertProviderStatus(row: ProviderStatusRow): Promise<void> {
  try {
    await invoke("upsert_provider_status", { row });
  } catch {
    // silent — best-effort
  }
}

export async function getProviderStatusFromDb(appId: string, providerId: string): Promise<ProviderStatusRow | null> {
  try {
    return await invoke<ProviderStatusRow | null>("get_provider_status_from_db", { appId, providerId });
  } catch {
    return null;
  }
}

export async function getAllProviderStatusesFromDb(appId: string): Promise<ProviderStatusRow[]> {
  try {
    return await invoke<ProviderStatusRow[]>("get_all_provider_statuses", { appId });
  } catch {
    return [];
  }
}

// --- Game Catalog Blob (single-row SQLite storage for volatile catalogs) ---

const CATALOG_KEYS = {
  steamOwned: (steamId: string) => `steam-owned:${steamId}`,
  debridGames: "debrid-games",
  installedGames: "installed-games",
  startupSnapshot: "startup-snapshot",
} as const;

export async function upsertGameCatalogBlob(catalogKey: string, dataJson: string): Promise<void> {
  try {
    await invoke("upsert_game_catalog_blob", { catalogKey, dataJson });
  } catch {
    // Non-critical; JSON file is still written
  }
}

export async function getGameCatalogBlob(catalogKey: string): Promise<string | null> {
  try {
    return await invoke<string | null>("get_game_catalog_blob", { catalogKey });
  } catch {
    return null;
  }
}

export { CATALOG_KEYS };

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

export interface FileFilter {
  name: string;
  extensions: string[];
}

export async function pickFile(
  title?: string,
  filters?: FileFilter[],
): Promise<string | null> {
  return await invoke<string | null>("pick_file", { title, filters });
}

export async function pickFolder(
  title?: string,
  startDir?: string,
): Promise<string | null> {
  return await invoke<string | null>("pick_folder", { title, startDir });
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
  metadataSource?: string | null;
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

// --- Profile Media ---

export async function saveProfileMedia(kind: "avatar" | "banner", extension: string, data: number[]): Promise<string> {
  return await invoke<string>("save_profile_media", { kind, extension, data });
}

export async function deleteProfileMedia(path: string): Promise<void> {
  await invoke("delete_profile_media", { path });
}

// --- Desktop / Quick Menu ---

export async function openAppDataFolder(): Promise<void> {
  await invoke("open_app_data");
}

export async function openLogsFolder(): Promise<void> {
  await invoke("open_logs");
}

export async function clearTempCache(): Promise<number> {
  return await invoke<number>("clear_temp_cache");
}

export type SystemInfo = {
  os: string;
  arch: string;
  family: string;
  exe_path: string | null;
  current_dir: string | null;
};

export async function getSystemInfo(): Promise<SystemInfo> {
  return await invoke<SystemInfo>("get_system_info");
}

export async function powerShutdown(): Promise<void> {
  await invoke("power_shutdown");
}

export async function powerSuspend(): Promise<void> {
  await invoke("power_suspend");
}

export async function powerHibernate(): Promise<void> {
  await invoke("power_hibernate");
}

export async function powerRestart(): Promise<void> {
  await invoke("power_restart");
}

// ── IGDB (via Rust backend — no direct frontend fetch to api.igdb.com) ──

export interface IgdbAccessToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface IgdbArtworkBySteamIdResult {
  cover_url: string | null;
}

export interface IgdbGameSearchResult {
  igdb_id: number | null;
  name: string | null;
  summary: string | null;
  release_date: string | null;
  genres: string[] | null;
  developers: string[] | null;
  publishers: string[] | null;
  cover_url: string | null;
  screenshot_urls: string[] | null;
}

export async function igdbGetAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<IgdbAccessToken> {
  return await invoke<IgdbAccessToken>("igdb_get_access_token", {
    clientId,
    clientSecret,
  });
}

export async function igdbSearchBySteamAppId(
  clientId: string,
  accessToken: string,
  appId: string,
): Promise<IgdbArtworkBySteamIdResult> {
  return await invoke<IgdbArtworkBySteamIdResult>("igdb_search_by_steam_app_id", {
    clientId,
    accessToken,
    appId,
  });
}

export async function igdbSearchGamesByName(
  clientId: string,
  accessToken: string,
  name: string,
  limit?: number,
): Promise<IgdbGameSearchResult[]> {
  return await invoke<IgdbGameSearchResult[]>("igdb_search_games_by_name", {
    clientId,
    accessToken,
    name,
    limit: limit ?? 3,
  });
}

// ---------------------------------------------------------------------------
// IGDB Catalog Query
// ---------------------------------------------------------------------------

export interface IgdbCatalogGame {
  igdb_id: number;
  name: string | null;
  summary: string | null;
  first_release_date: string | null;
  genres: string[] | null;
  rating: number | null;
  popularity: number | null;
  cover_url: string | null;
  screenshot_urls: string[] | null;
  developers: string[] | null;
  publishers: string[] | null;
  steam_app_id: string | null;
}

export async function igdbQueryCatalog(
  clientId: string,
  accessToken: string,
  query: string,
): Promise<IgdbCatalogGame[]> {
  return await invoke<IgdbCatalogGame[]>("igdb_query_catalog", {
    clientId,
    accessToken,
    query,
  });
}

// ---------------------------------------------------------------------------
// Manual games JSON persistence
// ---------------------------------------------------------------------------

export type ManualGameEntryJson = {
  id: string;
  name: string;
  executablePath?: string;
  workingDirectory?: string;
  launchArguments?: string;
  installDir?: string;
  libraryPath?: string;
  coverPath?: string;
  landscapePath?: string;
  backgroundPath?: string;
  logoPath?: string;
  iconPath?: string;
  genres?: string[];
  developers?: string[];
  publishers?: string[];
  releaseDate?: string;
  description?: string;
  shortDescription?: string;
  categories?: string[];
  features?: string[];
  tags?: string[];
  sortingName?: string;
  userScore?: string;
  criticScore?: string;
  communityScore?: string;
  reviewSummary?: string;
  reviewCount?: string;
  reviewSource?: string;
  series?: string;
  ageRating?: string;
  region?: string;
  completionStatus?: string;
  linkedSteamAppId?: string;
  linkedIgdbId?: string;
  appId?: string;
  sizeOnDisk?: number;
  isFavorite?: boolean;
  createdAt: number;
  updatedAt: number;
};

/** Read all manual game entries from `games/manual/manual-games.json`. */
export async function readManualGames(): Promise<ManualGameEntryJson[]> {
  return await invoke<ManualGameEntryJson[]>("read_manual_games");
}

/** Atomically write the full manual games array to `games/manual/manual-games.json`. */
export async function writeManualGames(entries: ManualGameEntryJson[]): Promise<void> {
  return await invoke<void>("write_manual_games", { entries });
}

/** Create a timestamped backup of `manual-games.json`. Returns backup filename. */
export async function backupManualGames(): Promise<string> {
  return await invoke<string>("backup_manual_games");
}

// ─── Epic Games Store Scanner (Phase 1A) ─────────────────────────────────

export type EpicInstallClassification = "baseGame" | "dlc" | "addon" | "tool" | "unknown";

export type EpicInstallSourceKind = "native" | "thirdPartyManaged";

/** A single normalized Epic installation record (provider-level only, no LibraryGame UI state). */
export type EpicInstalledGame = {
  providerId: "epic";
  /** Canonical Epic identity: `{namespace}:{catalogItemId}` or fallback. */
  providerGameId: string;
  namespace?: string;
  catalogItemId?: string;
  appName?: string;
  displayName?: string;
  installLocation?: string;
  launchExecutable?: string;
  executablePath?: string;
  launchArguments?: string;
  releaseVersion?: string;
  installSize?: number;
  manifestPath?: string;
  processNames: string[];
  mainGameAppName?: string;
  mainGameCatalogItemId?: string;
  mainGameCatalogNamespace?: string;
  installed: boolean;
  executableExists: boolean;
  manifestValid: boolean;
  incompleteInstall: boolean;
  canRunOffline: boolean;
  classification: EpicInstallClassification;
  sourceKind: EpicInstallSourceKind;
  warnings: string[];
};

/** The complete scan result envelope from the Epic local scanner. */
export type EpicInstalledGamesScanResult = {
  games: EpicInstalledGame[];
  manifestDirectory: string;
  directoryExists: boolean;
  scannedFileCount: number;
  validManifestCount: number;
  invalidManifestCount: number;
  staleManifestCount: number;
  incompleteInstallCount: number;
  duplicateCount: number;
  warnings: string[];
  scannedAt: string;
};

/**
 * Scan for locally installed Epic Games Store games.
 *
 * Reads `.item` manifest files from the Epic Games Launcher data directory.
 * No authentication, no network calls, no manifest modification.
 *
 * @param manifestDir Optional override for the manifest directory path.
 *   Uses `%ProgramData%/Epic/EpicGamesLauncher/Data/Manifests` when omitted.
 */
export async function scanEpicInstalledGames(
  manifestDir?: string,
): Promise<EpicInstalledGamesScanResult> {
  return await invoke<EpicInstalledGamesScanResult>("scan_epic_installed_games", {
    manifestDir: manifestDir ?? null,
  });
}

// ── Epic launch ──

export type EpicLaunchResult = {
  success: boolean;
  method: string;
  error?: string;
};

export async function launchEpicGame(
  appName: string,
  executablePath?: string,
  launchArguments?: string,
  directLaunchEnabled?: boolean,
  namespace?: string,
  catalogItemId?: string,
): Promise<EpicLaunchResult> {
  return await invoke<EpicLaunchResult>("launch_epic_game", {
    appName,
    executablePath: executablePath ?? null,
    launchArguments: launchArguments ?? null,
    directLaunchEnabled: directLaunchEnabled ?? false,
    namespace: namespace ?? null,
    catalogItemId: catalogItemId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Library game fixes (src-tauri/commands/game_fix.rs)
// ---------------------------------------------------------------------------

export type GameFixInfo = {
  appId: number;
  name: string;
  installed: boolean;
  installPath: string | null;
  hasLua: boolean;
  luaCount: number;
  lastRevision: string | null;
  hasOnlineFix: boolean;
  hasSteamApi64: boolean;
  hasSteamApi32: boolean;
  gameArch: string | null;
  mainExe: string | null;
  /** SteamStub DRM present on the main executable (Steamless applicability). */
  hasSteamStubDrm: boolean;
  /** Full path of the resolved main executable (what Steamless would target). */
  exeName: string | null;
};

export type GameFixResult = {
  ok: boolean;
  tool: string;
  message: string;
  filesInstalled: string[];
  errors: string[];
  requiresManualSelection: boolean;
  availableFiles: string[];
};

export type GameFixEntryInput = {
  appId: number;
  installDir: string | null;
};

export type FixInstallationStatus = {
  smokeApiInstalled: boolean;
  steamlessInstalled: boolean;
  koaloaderInstalled: boolean;
  goldbergInstalled: boolean;
  smokeApiPath: string | null;
  steamlessPath: string | null;
  koaloaderPath: string | null;
  goldbergPath: string | null;
};

export async function libraryGetGameFixInfo(params: {
  appId: number;
  name: string;
  installDir: string;
  hasLua: boolean;
  luaCount: number;
}): Promise<GameFixInfo> {
  return await invoke<GameFixInfo>("library_get_game_fix_info", params);
}

export async function libraryApplyOnlineFix(params: {
  appId: number;
  name: string;
  installDir: string;
  manualFile?: string | null;
}): Promise<GameFixResult> {
  return await invoke<GameFixResult>("library_apply_online_fix", {
    appId: params.appId,
    name: params.name,
    installDir: params.installDir,
    manualFile: params.manualFile ?? null,
  });
}

export async function libraryApplySmokeApi(params: {
  appId: number;
  name: string;
  installDir: string;
}): Promise<GameFixResult> {
  return await invoke<GameFixResult>("library_apply_smoke_api", params);
}

export async function libraryApplySteamless(params: {
  appId: number;
  name: string;
  installDir: string;
}): Promise<GameFixResult> {
  return await invoke<GameFixResult>("library_apply_steamless", params);
}

export async function libraryCheckFixInstallations(): Promise<FixInstallationStatus> {
  return await invoke<FixInstallationStatus>("library_check_fix_installations");
}

export async function libraryInstallSmokeApi(): Promise<GameFixResult> {
  return await invoke<GameFixResult>("library_install_smoke_api");
}

export async function libraryInstallSteamless(): Promise<GameFixResult> {
  return await invoke<GameFixResult>("library_install_steamless");
}

export async function libraryInstallKoaloader(): Promise<GameFixResult> {
  return await invoke<GameFixResult>("library_install_koaloader");
}

export async function libraryUnfixSteamless(appId: number, installDir: string): Promise<GameFixResult> {
  return await invoke<GameFixResult>("library_unfix_steamless", { appId, installDir });
}

export async function libraryUnfixSmokeApi(appId: number, installDir: string): Promise<GameFixResult> {
  return await invoke<GameFixResult>("library_unfix_smoke_api", { appId, installDir });
}

export async function libraryHasOnlineFixFix(appId: number, installDir: string): Promise<boolean> {
  return await invoke<boolean>("library_has_online_fix_fix", { appId, installDir });
}

export async function libraryHasSmokeApiFix(appId: number, installDir: string): Promise<boolean> {
  return await invoke<boolean>("library_has_smoke_api_fix", { appId, installDir });
}

export async function libraryHasSteamlessFix(appId: number, installDir: string): Promise<boolean> {
  return await invoke<boolean>("library_has_steamless_fix", { appId, installDir });
}

export async function libraryHasGoldbergFix(appId: number, installDir: string): Promise<boolean> {
  return await invoke<boolean>("library_has_goldberg_fix", { appId, installDir });
}

export async function libraryApplyGoldberg(params: {
  appId: number;
  name: string;
  installDir: string;
}): Promise<GameFixResult> {
  return await invoke<GameFixResult>("library_apply_goldberg", params);
}

export async function libraryUnfixGoldberg(appId: number, installDir: string): Promise<GameFixResult> {
  return await invoke<GameFixResult>("library_unfix_goldberg", { appId, installDir });
}

export async function libraryGetAppliedFixIds(entries: GameFixEntryInput[]): Promise<number[]> {
  return await invoke<number[]>("library_get_applied_fix_ids", { entries });
}

export async function libraryUnfixOnlineFix(appId: number, installDir: string): Promise<GameFixResult> {
  return await invoke<GameFixResult>("library_unfix_online_fix", { appId, installDir });
}

export async function libraryOpenSteamLaunchOptions(appId: number): Promise<void> {
  await invoke<void>("library_open_steam_launch_options", { appId });
}

// ---------------------------------------------------------------------------
// Third-party tools (src-tauri/commands/thirdparty.rs)
// ---------------------------------------------------------------------------

export type ThirdPartyToolInfo = {
  id: string;
  name: string;
  description: string;
  githubOwner: string;
  githubRepo: string;
  installed: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  installPath: string | null;
};

export type ThirdPartyToolResult = {
  ok: boolean;
  tool: string;
  message: string;
  filesInstalled: string[];
  errors: string[];
};

export async function listThirdPartyTools(): Promise<ThirdPartyToolInfo[]> {
  return await invoke<ThirdPartyToolInfo[]>("list_thirdparty_tools");
}

export async function installThirdPartyTool(toolId: string): Promise<ThirdPartyToolResult> {
  return await invoke<ThirdPartyToolResult>("install_thirdparty_tool", { toolId });
}

export async function uninstallThirdPartyTool(toolId: string): Promise<ThirdPartyToolResult> {
  return await invoke<ThirdPartyToolResult>("uninstall_thirdparty_tool", { toolId });
}

export async function checkThirdPartyUpdates(): Promise<ThirdPartyToolInfo[]> {
  return await invoke<ThirdPartyToolInfo[]>("check_thirdparty_updates");
}

export async function updateThirdPartyTool(toolId: string): Promise<ThirdPartyToolResult> {
  return await invoke<ThirdPartyToolResult>("update_thirdparty_tool", { toolId });
}

export async function openThirdPartyFolder(): Promise<void> {
  await invoke<void>("open_thirdparty_folder");
}

export async function generateAchievementSchema(
  appId: number,
  schemaJson: string,
  accountId?: number,
  gameDir?: string,
  gameName?: string,
  savePath?: string,
  platform?: string,
): Promise<string> {
  return await invoke<string>("generate_achievement_schema", {
    appId,
    schemaJson,
    accountId: accountId ?? null,
    gameDir: gameDir ?? null,
    gameName: gameName ?? null,
    savePath: savePath ?? null,
    platform: platform ?? null,
  });
}