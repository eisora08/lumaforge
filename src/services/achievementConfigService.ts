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

export type CrackType = "gse" | "rune" | "onlinefix" | "codex" | "empress" | "goldberg" | "tenoke" | "unknown";

export interface AutoDetectResult {
  config: AchievementGameConfig;
  crackType?: CrackType;
}

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

async function deleteFile(path: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_file", { path });
  } catch { /* file may not exist */ }
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

export async function detectCrackType(appId: string, installDir?: string): Promise<{ crackType: CrackType; savePath: string } | null> {
  try {
    const { detectCrackSaveType } = await import("./tauri");
    const result = await detectCrackSaveType(appId, installDir);
    if (result) {
      return { crackType: result.crack_type as CrackType, savePath: result.save_path };
    }
  } catch (err) {
    console.warn(`[ACH][CONFIG] detectCrackType failed for ${appId}:`, err);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Config CRUD (JSON files)
// ---------------------------------------------------------------------------

export async function readConfig(appId: string): Promise<AchievementGameConfig | null> {
  const appDataDir = await getAppDataDir();

  // Search platform directories — steam first (cracked), then steam-official, then epic-official
  let best: AchievementGameConfig | null = null;
  for (const platform of ["steam", "steam-official", "epic-official"]) {
    const configsDir = getConfigsDir(appDataDir, platform);
    const files = await listJsonFiles(configsDir);

    for (const file of files) {
      const filePath = `${configsDir}\\${file}`;
      const config = await readJsonFile<AchievementGameConfig>(filePath);
      if (config && config.app_id === appId) {
        // Validate: config.platform must match the directory it was found in
        if (config.platform !== platform) {
          console.warn(`[ACH][CONFIG] config platform mismatch: found in ${platform}/ but platform=${config.platform} — deleting stale config ${filePath}`);
          await deleteFile(filePath);
          continue;
        }
        // Prefer real save paths over appcache\stats fallbacks, then most recent
        if (!best) {
          best = config;
        } else {
          const currentIsFallback = best.save_path?.includes("appcache\\stats");
          const candidateIsFallback = config.save_path?.includes("appcache\\stats");
          if (currentIsFallback && !candidateIsFallback) {
            best = config;
          } else if (currentIsFallback === candidateIsFallback && (config.updated_at ?? 0) > (best.updated_at ?? 0)) {
            best = config;
          }
        }
      }
    }
  }

  return best;
}

export async function writeConfig(config: AchievementGameConfig): Promise<void> {
  const appDataDir = await getAppDataDir();
  const configName = sanitizeFileName(config.name || `Game ${config.app_id}`);
  const newFilePath = getConfigFilePath(appDataDir, config.platform, configName);

  // Delete any stale config files with the same app_id but different name
  // This prevents duplicates like "Game 3358170.json" + "Dodo Duckie.json"
  try {
    const configsDir = getConfigsDir(appDataDir, config.platform);
    const files = await listJsonFiles(configsDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = `${configsDir}\\${file}`;
        if (filePath !== newFilePath) {
          const existing = await readJsonFile<AchievementGameConfig>(filePath);
          if (existing && existing.app_id === config.app_id) {
            await deleteFile(filePath);
            console.log(`[ACH][CONFIG] deleted stale config ${filePath} (same app_id=${config.app_id})`);
          }
        }
      }
    }
  } catch { /* best-effort cleanup */ }

  await writeJsonFile(newFilePath, {
    ...config,
    updated_at: Date.now(),
  });

  console.log(`[ACH][CONFIG] wrote ${newFilePath}`);
}

/**
 * Update an existing config when crack detection finds a save directory.
 * Creates BOTH configs (steam + steam-official) so the user can switch freely.
 */
export async function updateConfigForCrack(
  appId: string,
  crackSavePath: string,
  gameName?: string,
  processName?: string,
): Promise<AchievementGameConfig | null> {
  const appDataDir = await getAppDataDir();
  const name = gameName || `Game ${appId}`;

  // Config crack — configs/steam/<appId>.json
  const crackConfigPath = `${appDataDir}\\achievements\\configs\\schema\\steam\\${appId}`;
  const crackConfig: AchievementGameConfig = {
    app_id: appId,
    name,
    platform: "steam",
    save_path: crackSavePath,
    config_path: crackConfigPath,
    executable: "",
    arguments: "",
    process_name: processName || "",
    updated_at: Date.now(),
  };
  await writeConfig(crackConfig);
  console.log(`[ACH][CONFIG] wrote crack config for ${appId} → platform=steam save_path=${crackSavePath}`);

  // Also ensure steam-official config exists so user can switch platforms freely.
  // Do NOT delete steam-official — both configs coexist.
  try {
    const steamPath = await resolveSteamPath();
    if (steamPath) {
      const officialConfigPath = `${appDataDir}\\achievements\\configs\\schema\\steam-official\\${appId}`;
      const officialConfig: AchievementGameConfig = {
        app_id: appId,
        name,
        platform: "steam-official",
        save_path: `${steamPath}\\appcache\\stats`,
        config_path: officialConfigPath,
        executable: "",
        arguments: "",
        process_name: "",
        updated_at: Date.now(),
      };
      await writeConfig(officialConfig);
      console.log(`[ACH][CONFIG] wrote official config for ${appId} → platform=steam-official`);
    }
  } catch { /* non-critical */ }

  return crackConfig;
}

export async function listConfigs(): Promise<AchievementGameConfig[]> {
  const appDataDir = await getAppDataDir();
  const configs: AchievementGameConfig[] = [];

  for (const platform of ["steam-official", "steam", "epic-official"]) {
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
  installDir?: string,
): Promise<AutoDetectResult | null> {
  const appDataDir = await getAppDataDir();

  // If gameSource/installDir/gameName not provided, look up from games_v2
  let effectiveSource = gameSource;
  let effectiveInstallDir = installDir;
  let effectiveName = gameName;
  if (!effectiveSource || !effectiveInstallDir || !effectiveName) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const game = await invoke<any>("get_game_v2_by_app_id", { appId });
      if (game) {
        if (!effectiveSource) effectiveSource = game.source;
        if (!effectiveInstallDir) effectiveInstallDir = game.installDir;
        if (!effectiveName) effectiveName = game.title;
      }
    } catch { /* not critical */ }
  }

  // Resolve installDir: if it's just a name (not an absolute path), derive from exePath
  if (effectiveInstallDir && !/^[A-Za-z]:\\|^\\\\|^\//.test(effectiveInstallDir)) {
    // installDir is a relative name — try to derive full path from exePath
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const game = await invoke<any>("get_game_v2_by_app_id", { appId });
      if (game?.exePath) {
        // exePath = "E:\GAMES\Dodo Duckie\DoDoDuck.exe" → parent = "E:\GAMES\Dodo Duckie"
        const parentDir = game.exePath.replace(/[\\/][^\\/]+$/, "");
        effectiveInstallDir = parentDir;
      }
    } catch { /* not critical */ }
  }

  // Determine platform based on game source
  const isCracked = effectiveSource === "debrid" || effectiveSource === "manual";
  const isEpic = effectiveSource === "epic" || effectiveSource === "epic-official";

  // Epic games don't need Steam — handle early
  if (isEpic) {
    // Epic Official game — no local save_path needed (progress fetched from Epic API)
    const configPath = `${appDataDir}\\achievements\\schema\\epic-official\\${appId}`;
    const config: AchievementGameConfig = {
      app_id: appId,
      name: effectiveName || `Game ${appId}`,
      platform: "epic-official",
      save_path: null, // Epic achievements are fetched from API, not local files
      config_path: configPath,
      executable: effectiveInstallDir || "",
      arguments: "",
      process_name: "",
      updated_at: Date.now(),
    };

    await writeConfig(config);
    console.log(`[ACH][CONFIG] created config for ${appId} platform=epic-official source=${effectiveSource}`);
    return { config, crackType: undefined };
  }

  // Steam games need steamPath — resolve after Epic early return
  const steamPath = await resolveSteamPath();
  if (!steamPath) {
    console.warn(`[ACH][CONFIG] auto-detect failed: no steamPath`);
    return null;
  }

  if (isCracked) {
    // Cracked game (debrid/manual) — find crack save directory
    const crackResult = await detectCrackType(appId, effectiveInstallDir);
    console.log(`[ACH][CONFIG] crackResult appId=${appId} crackType=${crackResult?.crackType ?? "null"} savePath=${crackResult?.savePath ?? "null"} installDir=${effectiveInstallDir ?? "null"}`);

    const savePath = crackResult?.savePath ?? `${steamPath}\\appcache\\stats`;
    const configPath = `${appDataDir}\\achievements\\schema\\steam\\${appId}`;
    const config: AchievementGameConfig = {
      app_id: appId,
      name: effectiveName || `Game ${appId}`,
      platform: "steam",
      save_path: savePath,
      config_path: configPath,
      executable: "",
      arguments: "",
      process_name: "",
      updated_at: Date.now(),
    };

    await writeConfig(config);
    console.log(`[ACH][CONFIG] created config for ${appId} platform=steam source=${effectiveSource} crack=${crackResult?.crackType ?? "none"} save_path=${savePath}`);
    return { config, crackType: crackResult?.crackType };
  }

  // Steam library game (steam/lua/epic) — reads from appcache/stats/
  const configPath = `${appDataDir}\\achievements\\schema\\steam-official\\${appId}`;
  const config: AchievementGameConfig = {
    app_id: appId,
    name: effectiveName || `Game ${appId}`,
    platform: "steam-official",
    save_path: `${steamPath}\\appcache\\stats`,
    config_path: configPath,
    executable: "",
    arguments: "",
    process_name: "",
    updated_at: Date.now(),
  };

  await writeConfig(config);
  console.log(`[ACH][CONFIG] created config for ${appId} platform=steam-official source=${effectiveSource} save_path=${config.save_path}`);
  return { config, crackType: undefined };
}

// ---------------------------------------------------------------------------
// Get or create config for a game
//
// Concurrent calls for the same appId are serialized: the second caller waits
// for the first to finish and then reads the freshly-written config instead of
// racing to create a duplicate.
// ---------------------------------------------------------------------------

const _pendingCreations = new Map<string, Promise<AchievementGameConfig | null>>();

export async function getOrCreateConfig(
  appId: string,
  gameName?: string,
  gameSource?: string,
  installDir?: string,
): Promise<AchievementGameConfig | null> {
  // If another call is already handling this appId, piggyback on it
  const pending = _pendingCreations.get(appId);
  if (pending) {
    console.debug(`[ACH][CONFIG] getOrCreateConfig appId=${appId} — waiting for in-flight creation`);
    return pending;
  }

  const promise = _doGetOrCreateConfig(appId, gameName, gameSource, installDir);
  _pendingCreations.set(appId, promise);
  try {
    return await promise;
  } finally {
    _pendingCreations.delete(appId);
  }
}

async function _doGetOrCreateConfig(
  appId: string,
  gameName?: string,
  gameSource?: string,
  installDir?: string,
): Promise<AchievementGameConfig | null> {
  // 1. Try existing config
  const existing = await readConfig(appId);
  console.log(`[ACH][CONFIG] getOrCreateConfig appId=${appId} existing=${existing?.save_path ?? "null"} gameSource=${gameSource ?? "null"} installDir=${installDir ?? "null"}`);

  // Stale config fix: if existing config points to appcache/stats but the game
  // is debrid/manual (cracked), re-detect to find the actual crack save path.
  // This handles configs created before the tenoke/recursive-search fix.
  if (existing && existing.save_path?.includes("appcache\\stats")) {
    // Look up source from games_v2 if not provided by caller
    let effectiveSource = gameSource;
    if (!effectiveSource) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const game = await invoke<any>("get_game_v2_by_app_id", { appId });
        if (game) effectiveSource = game.source;
      } catch { /* not critical */ }
    }
    if (effectiveSource === "debrid" || effectiveSource === "manual") {
      console.log(`[ACH][CONFIG] stale save_path for cracked game appId=${appId} old=${existing.save_path} re-detecting...`);
      const result = await autoDetectAndCreateConfig(appId, gameName ?? existing.name, effectiveSource, installDir);
      console.log(`[ACH][CONFIG] stale re-detect appId=${appId} newSavePath=${result?.config?.save_path ?? "null"} changed=${result?.config?.save_path !== existing.save_path}`);
      if (result?.config?.save_path && !result.config.save_path.includes("appcache\\stats")) {
        // Save path changed — restart watcher so extraWatchDirMap picks up the new directory
        try {
          const { achievementWatcherService } = await import("./achievementWatcherService");
          if (achievementWatcherService.started) {
            console.log(`[ACH][CONFIG] stale save_path re-detected appid=${appId} old=${existing.save_path} new=${result.config.save_path}, restarting watcher`);
            await achievementWatcherService.restartWatching();
          }
        } catch { /* non-critical */ }
        return result.config;
      }
      // If re-detection still can't find crack, keep existing config
      console.log(`[ACH][CONFIG] stale re-detect appId=${appId} still no crack path — keeping existing config`);
    }
  }

  if (existing) return existing;

  // 2. Auto-detect and create
  const result = await autoDetectAndCreateConfig(appId, gameName, gameSource, installDir);

  // Restart watcher so extraWatchDirMap picks up any new save_path directories
  if (result?.config) {
    try {
      const { achievementWatcherService } = await import("./achievementWatcherService");
      if (achievementWatcherService.started) {
        console.log(`[ACH][CONFIG] new config created appid=${appId} platform=${result.config.platform} save_path=${result.config.save_path ?? "null"}, restarting watcher`);
        await achievementWatcherService.restartWatching();
      }
    } catch { /* non-critical */ }
  }

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
