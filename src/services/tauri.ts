import { invoke } from "@tauri-apps/api/core";

import type { SteamPaths } from "../types/steam";
import type { InstallResult } from "../types/install";
import type { ProviderAvailabilityResult } from "../types/providerAvailability";
import type { InstalledLuaScript } from "../types/installedLua";
import type { LuaActionResult } from "../types/luaAction";
import type { GameNameResult } from "../types/gameName";
import type { SteamAppMetadata } from "../types/gameMetadata";

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
