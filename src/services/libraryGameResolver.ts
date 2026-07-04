import type { AppSettings } from "../types/settings";
import type { LibraryGame } from "../types/libraryGame";
import type { SteamInstalledGame } from "../types/steamInstalled";
import type { LocalExecutableGame } from "../types/localExecutableGame";
import type { InstalledLuaScript } from "../types/installedLua";
import type { SteamAppMetadata } from "../types/gameMetadata";

import { scanSteamInstalledGames, scanLocalGameFolders, scanInstalledLuaScripts } from "./tauri";
import { resolveGameMetadata } from "./gameMetadataResolver";
import { readSyncIndex } from "./tauri";

function stableIdFromString(prefix: string, value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0;
  }
  return `${prefix}-${Math.abs(hash).toString(36)}`;
}

function getImageUrl(meta?: SteamAppMetadata): string | undefined {
  return meta?.header_image || meta?.capsule_image || meta?.capsule_image_v5 || undefined;
}

function buildFromSteam(
  steam: SteamInstalledGame,
  metadata: Record<number, SteamAppMetadata>,
): LibraryGame {
  const meta = metadata[steam.appId];
  const metaName = meta?.resolved ? meta.name : undefined;
  return {
    id: stableIdFromString("steam", String(steam.appId)),
    appId: String(steam.appId),
    title: steam.name || metaName || "",
    source: "steam",
    installDir: steam.installPath || steam.installDir || undefined,
    libraryPath: steam.libraryPath,
    imageUrl: getImageUrl(meta),
    metadata: meta,
    isPlayable: steam.isInstalled,
    isInstallable: !steam.isInstalled,
    steamInstalled: steam.isInstalled,
    sizeOnDisk: steam.sizeOnDisk || undefined,
    lastUpdated: steam.lastUpdated || undefined,
    luaScripts: [],
    hasLua: false,
    isLuaActive: false,
    isLuaDisabled: false,
    hasLuaSource: false,
    sources: [],
  };
}

function buildFromLocalExe(
  exe: LocalExecutableGame,
): LibraryGame {
  const dirName = exe.directoryName || "";
  const fileName = exe.fileName || exe.executablePath.split("\\").pop()?.split("/").pop() || exe.executablePath;
  const id = stableIdFromString("local", exe.executablePath);
  return {
    id,
    appId: undefined,
    title: dirName || fileName.replace(/\.exe$/i, ""),
    source: "local",
    executablePath: exe.executablePath,
    installDir: dirName,
    imageUrl: undefined,
    metadata: undefined,
    isPlayable: true,
    isInstallable: false,
    steamInstalled: false,
    luaScripts: [],
    hasLua: false,
    isLuaActive: false,
    isLuaDisabled: false,
    hasLuaSource: false,
    sources: [],
  };
}

function buildFromLua(
  appId: string,
  scripts: InstalledLuaScript[],
  sources: Set<string>,
  metadata: Record<number, SteamAppMetadata>,
): LibraryGame {
  const meta = metadata[Number(appId)];
  const metaName = meta?.resolved ? meta.name : undefined;
  return {
    id: `lua-${appId}`,
    appId,
    title: metaName || "",
    source: "lua",
    isPlayable: false,
    isInstallable: true,
    steamInstalled: false,
    luaScripts: scripts,
    hasLua: true,
    isLuaActive: scripts.some((s) => !s.is_disabled),
    isLuaDisabled: scripts.every((s) => s.is_disabled),
    hasLuaSource: sources.has(appId),
    metadata: meta,
    sources: [],
  };
}

function mergeLuaIntoGame(
  game: LibraryGame,
  hasLua: boolean,
  scripts: InstalledLuaScript[],
  sources: Set<string>,
): void {
  if (!hasLua) return;
  game.luaScripts = scripts;
  game.hasLua = true;
  game.isLuaActive = scripts.some((s) => !s.is_disabled);
  game.isLuaDisabled = scripts.every((s) => s.is_disabled);
  if (game.appId) {
    game.hasLuaSource = sources.has(game.appId);
  }
}

// ── Steam scan TTL guard ──
// Prevents repeated scans on every navigation/reconciliation.
const STEAM_SCAN_TTL_MS = 10 * 60 * 1000; // 10 minutes
let _lastSteamScanAt = 0;

/** Check if a steam scan is allowed (TTL + Store route guard). Returns true if scanning is OK. */
export function checkSteamScanAllowed(options?: { force?: boolean }): boolean {
  if (options?.force) return true;
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  if (hash.startsWith("#/store")) {
    return false;
  }
  const now = Date.now();
  if (_lastSteamScanAt > 0 && now - _lastSteamScanAt < STEAM_SCAN_TTL_MS) {
    return false;
  }
  return true;
}

/** Mark steam scan timestamp (call after a successful scan). */
export function markSteamScanComplete(): void {
  _lastSteamScanAt = Date.now();
}

export async function resolveLibraryGames(
  settings: AppSettings,
  options?: { force?: boolean },
): Promise<{ games: LibraryGame[]; warnings: string[] }> {
  const warnings: string[] = [];

  // TTL + Store route guard
  if (!checkSteamScanAllowed(options)) {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.startsWith("#/store")) {
      console.log("[steam-scan][SKIP] reason=store-active");
      warnings.push("Skipped: store active");
    } else {
      const now = Date.now();
      console.log(`[steam-scan][SKIP] reason=ttl-valid elapsedMs=${now - _lastSteamScanAt}`);
      warnings.push("Skipped: TTL valid");
    }
    return { games: [], warnings };
  }

  // 1. Steam installed scan — this provides the PRIMARY game list
  markSteamScanComplete();
  let steamGames: SteamInstalledGame[] = [];
  try {
    steamGames = await scanSteamInstalledGames({
      steamPath: settings.steamRoot || undefined,
      luaPath: settings.luaPath || undefined,
      depotcachePath: settings.depotcachePath || undefined,
      gameScanFolders: settings.gameScanFolders.length > 0 ? settings.gameScanFolders : undefined,
    });
  } catch (error) {
    warnings.push(`Steam scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Local EXE scan
  let localExes: LocalExecutableGame[] = [];
  if (settings.scanLocalGames && settings.gameScanFolders.length > 0) {
    try {
      localExes = await scanLocalGameFolders(settings.gameScanFolders);
    } catch (error) {
      warnings.push(`Local EXE scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 3. Lua script scan
  let luaScripts: InstalledLuaScript[] = [];
  if (settings.luaPath) {
    try {
      luaScripts = await scanInstalledLuaScripts(settings.luaPath);
    } catch (error) {
      warnings.push(`Lua scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 4. Collect ALL appIds (Steam + Lua-only) for metadata resolution.
  //    This ensures Lua-only games get real names from metadata resolvers
  //    instead of showing placeholder "Steam App <appid>" titles.
  const allAppIds = new Set<number>();
  for (const g of steamGames) {
    allAppIds.add(g.appId);
  }
  for (const script of luaScripts) {
    allAppIds.add(script.app_id);
  }

  let metadata: Record<number, SteamAppMetadata> = {};
  if (allAppIds.size > 0) {
    try {
      metadata = await resolveGameMetadata(Array.from(allAppIds));
    } catch (error) {
      warnings.push(`Metadata resolve failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 6. Read sync index for Lua sources
  const sourceAppIds = new Set<string>();
  try {
    const syncIndexData = await readSyncIndex();
    for (const key of Object.keys(syncIndexData.items)) {
      sourceAppIds.add(key);
    }
  } catch {
    // sync index is optional
  }

  // 7. Build games map from Steam games (PRIMARY list)
  const gamesMap = new Map<string, LibraryGame>();
  const steamByAppId = new Map<string, LibraryGame>();

  for (const steam of steamGames) {
    const game = buildFromSteam(steam, metadata);
    gamesMap.set(game.id, game);
    if (game.appId) {
      steamByAppId.set(game.appId, game);
    }
  }

  // 8. Local EXEs
  for (const exe of localExes) {
    const game = buildFromLocalExe(exe);
    if (!gamesMap.has(game.id)) {
      gamesMap.set(game.id, game);
    }
  }

  // 9. Apply Lua overlay: for each Lua script, find matching Steam game and flag it
  const luaByAppId = new Map<number, InstalledLuaScript[]>();
  for (const script of luaScripts) {
    const list = luaByAppId.get(script.app_id) || [];
    list.push(script);
    luaByAppId.set(script.app_id, list);
  }

  for (const [appIdNum, scripts] of luaByAppId) {
    const appIdStr = String(appIdNum);
    const existingGame = steamByAppId.get(appIdStr);
    if (existingGame) {
      // Merge Lua into existing Steam game
      mergeLuaIntoGame(existingGame, true, scripts, sourceAppIds);
    } else {
      // Add Lua-only game (has Lua script but no Steam manifest)
      const game = buildFromLua(appIdStr, scripts, sourceAppIds, metadata);
      gamesMap.set(game.id, game);
    }
  }

  const games = Array.from(gamesMap.values()).sort((a, b) => {
    const ta = a.title || a.appId || "";
    const tb = b.title || b.appId || "";
    return ta.localeCompare(tb);
  });

  return { games, warnings };
}
