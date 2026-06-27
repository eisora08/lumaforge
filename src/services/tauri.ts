import { invoke } from "@tauri-apps/api/core";

import type { SteamPaths } from "../types/steam";
import type { InstallResult } from "../types/install";
import type { ProviderAvailabilityResult } from "../types/providerAvailability";
import type { InstalledLuaScript } from "../types/installedLua";

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