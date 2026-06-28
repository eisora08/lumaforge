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
import type { LocalDiscoveredGame } from "../types/localGame";
import type { LocalExecutableGame } from "../types/localExecutableGame";
import type { SyncIndex, SyncIndexItem, SyncCheckResult } from "../types/syncIndex";

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