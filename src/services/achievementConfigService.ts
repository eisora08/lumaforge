/**
 * Achievement Config Service
 *
 * Manages per-game achievement configuration using JSON files on disk.
 * Each game has a config that tells the achievement resolver exactly
 * where to find achievement data (save_path) and what platform it is
 * (steam-official vs steam/cracked).
 *
 * Directory structure:
 *   <appData>/achievements/configs/steam-official/<Name>.json
 *   <appData>/achievements/configs/steam/<Name>.json
 *   <appData>/achievements/schema/steam-official/<appId>/achievements.json
 *   <appData>/achievements/schema/steam/<appId>/achievements.json
 */

import { detectSteamPaths, detectSteamAccountIdForApp } from "./tauri";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AchievementGameConfig = {
  app_id: string;
  name: string;
  platform: string;
  config_path?: string | null;
  save_path?: string | null;
  executable?: string | null;
  arguments?: string | null;
  process_name?: string | null;
  updated_at: number;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CrackType = "gse" | "rune" | "onlinefix" | "codex" | "empress" | "goldberg" | "unknown";

export interface AutoDetectResult {
  config: AchievementGameConfig;
  crackType?: CrackType;
}

// ---------------------------------------------------------------------------
// Known crack save directories (from reference: watched-folders.js)
// ---------------------------------------------------------------------------

interface CrackPathSpec {
  envKey: string;
  segments: string[];
  crackType: CrackType;
  label: string;
}

const CRACK_PATHS: CrackPathSpec[] = [
  { envKey: "APPDATA", segments: ["GSE Saves"], crackType: "gse", label: "GSE Saves" },
  { envKey: "PUBLIC", segments: ["Documents", "Steam", "RUNE"], crackType: "rune", label: "RUNE" },
  { envKey: "PUBLIC", segments: ["Documents", "OnlineFix"], crackType: "onlinefix", label: "OnlineFix" },
  { envKey: "PUBLIC", segments: ["Documents", "Steam", "CODEX"], crackType: "codex", label: "CODEX" },
  { envKey: "PUBLIC", segments: ["Documents", "EMPRESS"], crackType: "empress", label: "EMPRESS" },
  { envKey: "APPDATA", segments: ["Goldberg SteamEmu Saves"], crackType: "goldberg", label: "Goldberg" },
  { envKey: "APPDATA", segments: ["Goldberg UplayEmu Saves"], crackType: "goldberg", label: "Goldberg Uplay" },
  { envKey: "APPDATA", segments: ["Steam", "CODEX"], crackType: "codex", label: "CODEX (AppData)" },
  { envKey: "APPDATA", segments: ["SmartSteamEmu"], crackType: "gse", label: "SmartSteamEmu" },
];

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

async function getAppDataDir(): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("get_app_data_dir_path");
}

function getConfigsDir(appDataDir: string, platform: string): string {
  return `${appDataDir}\\achievements\\configs\\${platform}`;
}

function getConfigFilePath(appDataDir: string, platform: string, configName: string): string {
  return `${getConfigsDir(appDataDir, platform)}\\${configName}.json`;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}

// ---------------------------------------------------------------------------
// File I/O via Tauri commands (replaces @tauri-apps/plugin-fs)
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("file_exists", { path });
  } catch {
    return false;
  }
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const content = await invoke<string>("read_text_file", { path });
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile<T>(path: string, data: T): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const content = JSON.stringify(data, null, 2);
    await invoke("write_text_file", { path, content });
  } catch (err) {
    console.error(`[ACH][CONFIG] Failed to write ${path}:`, err);
  }
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const files = await invoke<string[]>("list_files_in_dir", { path: dir });
    return files.filter(f => f.endsWith(".json"));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Auto-detect steamPath
// ---------------------------------------------------------------------------

let _cachedSteamPath: string | null = null;

export async function resolveSteamPath(): Promise<string> {
  if (_cachedSteamPath) return _cachedSteamPath;

  try {
    const paths = await detectSteamPaths();
    if (paths?.steam_root) {
      _cachedSteamPath = paths.steam_root;
      return _cachedSteamPath;
    }
  } catch { /* detection failed */ }

  return "";
}

// ---------------------------------------------------------------------------
// Auto-detect crack type for a game
// ---------------------------------------------------------------------------

export async function detectCrackType(appId: string): Promise<{ crackType: CrackType; savePath: string } | null> {
  for (const spec of CRACK_PATHS) {
    const envBase = process.env[spec.envKey];
    if (!envBase) continue;

    const savePath = [envBase, ...spec.segments, appId].join("\\");
    if (await fileExists(savePath)) {
      return { crackType: spec.crackType, savePath };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Config CRUD (JSON files)
// ---------------------------------------------------------------------------

export async function readConfig(appId: string): Promise<AchievementGameConfig | null> {
  const appDataDir = await getAppDataDir();

  // Search both platform directories
  for (const platform of ["steam-official", "steam"]) {
    const configsDir = getConfigsDir(appDataDir, platform);
    const files = await listJsonFiles(configsDir);

    for (const file of files) {
      const filePath = `${configsDir}\\${file}`;
      const config = await readJsonFile<AchievementGameConfig>(filePath);
      if (config && config.app_id === appId) {
        return config;
      }
    }
  }

  return null;
}

export async function writeConfig(config: AchievementGameConfig): Promise<void> {
  const appDataDir = await getAppDataDir();
  const configName = sanitizeFileName(config.name || `Game ${config.app_id}`);
  const filePath = getConfigFilePath(appDataDir, config.platform, configName);

  await writeJsonFile(filePath, {
    ...config,
    updated_at: Date.now(),
  });

  console.log(`[ACH][CONFIG] wrote ${filePath}`);
}

export async function listConfigs(): Promise<AchievementGameConfig[]> {
  const appDataDir = await getAppDataDir();
  const configs: AchievementGameConfig[] = [];

  for (const platform of ["steam-official", "steam"]) {
    const configsDir = getConfigsDir(appDataDir, platform);
    const files = await listJsonFiles(configsDir);

    for (const file of files) {
      const filePath = `${configsDir}\\${file}`;
      const config = await readJsonFile<AchievementGameConfig>(filePath);
      if (config) configs.push(config);
    }
  }

  return configs;
}

// ---------------------------------------------------------------------------
// Auto-detect and create config
//
// Platform rules:
//   steam-official = Steam library games (source=steam, lua) → reads from appcache/stats/
//   steam = debrid/manual games with appId (cracked) → reads from crack save directory
// ---------------------------------------------------------------------------

export async function autoDetectAndCreateConfig(
  appId: string,
  gameName?: string,
  gameSource?: string, // "steam" | "lua" | "debrid" | "manual" | "epic"
): Promise<AutoDetectResult | null> {
  const steamPath = await resolveSteamPath();
  if (!steamPath) {
    console.warn(`[ACH][CONFIG] auto-detect failed: no steamPath`);
    return null;
  }

  const appDataDir = await getAppDataDir();

  // Determine platform based on game source
  const isCracked = gameSource === "debrid" || gameSource === "manual";

  if (isCracked) {
    // Cracked game (debrid/manual) — find crack save directory
    const crackResult = await detectCrackType(appId);

    const savePath = crackResult?.savePath ?? `${steamPath}\\appcache\\stats`;
    const configPath = `${appDataDir}\\achievements\\configs\\schema\\steam\\${appId}`;
    const config: AchievementGameConfig = {
      app_id: appId,
      name: gameName || `Game ${appId}`,
      platform: "steam",
      save_path: savePath,
      config_path: configPath,
      executable: "",
      arguments: "",
      process_name: "",
      updated_at: Date.now(),
    };

    await writeConfig(config);
    console.log(`[ACH][CONFIG] created config for ${appId} platform=steam source=${gameSource} crack=${crackResult?.crackType ?? "none"} save_path=${savePath}`);
    return { config, crackType: crackResult?.crackType };
  }

  // Steam library game (steam/lua/epic) — reads from appcache/stats/
  const configPath = `${appDataDir}\\achievements\\configs\\schema\\steam-official\\${appId}`;
  const config: AchievementGameConfig = {
    app_id: appId,
    name: gameName || `Game ${appId}`,
    platform: "steam-official",
    save_path: `${steamPath}\\appcache\\stats`,
    config_path: configPath,
    executable: "",
    arguments: "",
    process_name: "",
    updated_at: Date.now(),
  };

  await writeConfig(config);
  console.log(`[ACH][CONFIG] created config for ${appId} platform=steam-official source=${gameSource} save_path=${config.save_path}`);
  return { config, crackType: undefined };
}

// ---------------------------------------------------------------------------
// Get or create config for a game
// ---------------------------------------------------------------------------

export async function getOrCreateConfig(
  appId: string,
  gameName?: string,
  gameSource?: string,
): Promise<AchievementGameConfig | null> {
  // 1. Try existing config
  const existing = await readConfig(appId);
  if (existing) return existing;

  // 2. Auto-detect and create
  const result = await autoDetectAndCreateConfig(appId, gameName, gameSource);
  return result?.config ?? null;
}

// ---------------------------------------------------------------------------
// Get save_path for a game (the key field for achievement resolution)
// ---------------------------------------------------------------------------

export async function getSavePath(appId: string): Promise<string> {
  const config = await readConfig(appId);
  if (config?.save_path) return config.save_path;

  // Fallback: auto-detect
  const result = await autoDetectAndCreateConfig(appId);
  return result?.config.save_path ?? "";
}

// ---------------------------------------------------------------------------
// Get steamPath (auto-detected)
// ---------------------------------------------------------------------------

export async function getSteamPath(): Promise<string> {
  return resolveSteamPath();
}

// ---------------------------------------------------------------------------
// Get accountId (auto-detected from stats files)
// ---------------------------------------------------------------------------

let _cachedAccountId: string | null = null;

export async function getAccountId(appId: string): Promise<string> {
  if (_cachedAccountId) return _cachedAccountId;

  const steamPath = await resolveSteamPath();
  if (!steamPath) return "";

  try {
    const detected = await detectSteamAccountIdForApp(steamPath, Number(appId));
    if (detected) {
      _cachedAccountId = detected;
      return detected;
    }
  } catch { /* detection failed */ }

  return "";
}
