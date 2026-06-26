import { invoke } from "@tauri-apps/api/core";

import { SteamPaths } from "../types/steam";
import { InstallResult } from "../types/install";

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