/**
 * Types for Steam Keys integration (DLC Query, Pin Version, Fetch Manifest)
 */

export interface SteamKeysCommandResult {
  success: boolean;
  message: string;
}

export interface SteamKeysDlcInfo {
  app_id: number;
  name: string | null;
  has_own_depot: boolean;
  is_already_in_lua: boolean;
  has_key: boolean;
}

export interface SteamKeysManifestInfo {
  manifest_id: string;
  pinned: boolean;
  in_lua: boolean;
}

export interface SteamKeysGenerateLuaRequest {
  app_id: number;
}

export interface SteamKeysPinManifestRequest {
  app_id: number;
  depot_id: number;
  manifest_id: string;
  pinned: boolean;
}

export interface SteamKeysFetchManifestsRequest {
  app_id: number;
}

export interface SteamKeysAddDlcRequest {
  app_id: number;
  dlc_app_id: number;
}

export interface SteamKeysAddAllDlcsRequest {
  app_id: number;
}

export interface SteamKeysManifestPin {
  depot_id: number;
  manifest_id: string;
  is_active: boolean;
}

export interface SteamKeysUnpinAllRequest {
  app_id: number;
}

export interface SteamKeysPinToCurrentRequest {
  app_id: number;
}
