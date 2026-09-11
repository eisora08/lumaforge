import { invoke } from "@tauri-apps/api/core";

import type {
  SteamKeysCommandResult,
  SteamKeysDlcInfo,
  SteamKeysGenerateLuaRequest,
  SteamKeysPinManifestRequest,
  SteamKeysFetchManifestsRequest,
  SteamKeysAddDlcRequest,
  SteamKeysAddAllDlcsRequest,
  SteamKeysUnpinAllRequest,
  SteamKeysPinToCurrentRequest,
} from "../types/steam-keys";

/**
 * Ensure depot keys and app access tokens are cached.
 * If files don't exist or are stale, downloads them.
 */
export async function steamKeysEnsureCache(): Promise<SteamKeysCommandResult> {
  return await invoke<SteamKeysCommandResult>("steam_keys_ensure_cache");
}

/**
 * Force-refresh key files from the API.
 */
export async function steamKeysUpdateCache(): Promise<SteamKeysCommandResult> {
  return await invoke<SteamKeysCommandResult>("steam_keys_update_cache");
}

/**
 * Generate a .lua file for a game.
 */
export async function steamKeysGenerateLua(
  request: SteamKeysGenerateLuaRequest
): Promise<SteamKeysCommandResult> {
  return await invoke<SteamKeysCommandResult>("steam_keys_generate_lua", {
    request,
  });
}

/**
 * Pin or unpin a manifest in the Lua file.
 */
export async function steamKeysPinManifest(
  request: SteamKeysPinManifestRequest
): Promise<SteamKeysCommandResult> {
  return await invoke<SteamKeysCommandResult>("steam_keys_pin_manifest", {
    request,
  });
}

/**
 * Fetch all manifests for a game from GitHub.
 */
export async function steamKeysFetchManifests(
  request: SteamKeysFetchManifestsRequest
): Promise<SteamKeysCommandResult> {
  return await invoke<SteamKeysCommandResult>("steam_keys_fetch_manifests", {
    appId: request.app_id,
  });
}

/**
 * Update all manifest pins based on depotcache files.
 */
export async function steamKeysUpdateAllPins(
  app_id: number
): Promise<SteamKeysCommandResult> {
  return await invoke<SteamKeysCommandResult>("steam_keys_update_all_pins", {
    appId: app_id,
  });
}

/**
 * Query DLCs for a game.
 */
export async function steamKeysQueryDlcs(
  app_id: number
): Promise<SteamKeysDlcInfo[]> {
  return await invoke<SteamKeysDlcInfo[]>("steam_keys_query_dlcs", {
    appId: app_id,
  });
}

/**
 * Add a single DLC to a game's Lua file.
 */
export async function steamKeysAddDlc(
  request: SteamKeysAddDlcRequest
): Promise<SteamKeysCommandResult> {
  return await invoke<SteamKeysCommandResult>("steam_keys_add_dlc", {
    request,
  });
}

/**
 * Add all missing DLCs to a game's Lua file.
 */
export async function steamKeysAddAllDlcs(
  request: SteamKeysAddAllDlcsRequest
): Promise<SteamKeysCommandResult> {
  return await invoke<SteamKeysCommandResult>("steam_keys_add_all_dlcs", {
    request,
  });
}

/**
 * Check if a Lua file exists for a game.
 */
export async function steamKeysLuaExists(app_id: number): Promise<boolean> {
  return await invoke<boolean>("steam_keys_lua_exists", { appId: app_id });
}

/**
 * Check if a game has any active manifest pins.
 */
export async function steamKeysHasPins(app_id: number): Promise<boolean> {
  return await invoke<boolean>("steam_keys_has_pins", { appId: app_id });
}

/**
 * Unpin all manifests for a game (comment out all setManifestid lines).
 */
export async function steamKeysUnpinAll(
  request: SteamKeysUnpinAllRequest
): Promise<SteamKeysCommandResult> {
  return await invoke<SteamKeysCommandResult>("steam_keys_unpin_all", {
    appId: request.app_id,
  });
}

/**
 * Pin manifests to current installed version (reads from local ACF).
 */
export async function steamKeysPinToCurrent(
  request: SteamKeysPinToCurrentRequest
): Promise<SteamKeysCommandResult> {
  return await invoke<SteamKeysCommandResult>("steam_keys_pin_to_current", {
    appId: request.app_id,
  });
}
