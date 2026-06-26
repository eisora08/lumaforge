import { invoke } from "@tauri-apps/api/core";

import { SteamPaths } from "../types/steam";
import { InstallResult } from "../types/install";
import type { ProviderAvailabilityResult } from "../types/providerAvailability";

export async function detectSteamPaths(): Promise<SteamPaths | null> {
  return await invoke<SteamPaths | null>("detect_steam_paths");
}

export async function downloadAndInstallPackage(params: {
  downloadUrl: string;
  luaTarget: string;
  depotcacheTarget: string;
  createBackups: boolean;
}): Promise<InstallResult> {
  return await invoke<InstallResult>("download_and_install_package", {
    downloadUrl: params.downloadUrl,
    luaTarget: params.luaTarget,
    depotcacheTarget: params.depotcacheTarget,
    createBackups: params.createBackups,
  });
}


export async function checkProviderAvailability(params: {
  url: string;
  successCode: number;
  unavailableCode: number;
}): Promise<ProviderAvailabilityResult> {
  return await invoke<ProviderAvailabilityResult>("check_provider_availability", {
    url: params.url,
    successCode: params.successCode,
    unavailableCode: params.unavailableCode,
  });
}
