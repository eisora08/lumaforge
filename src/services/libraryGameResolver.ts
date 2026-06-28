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
  return {
    id: stableIdFromString("steam", String(steam.appId)),
    appId: String(steam.appId),
    title: meta?.name || steam.name || `Steam App ${steam.appId}`,
    source: "steam",
    installDir: steam.installDir || undefined,
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

function buildFromLuaScript(
  script: InstalledLuaScript,
  metadata: Record<number, SteamAppMetadata>,
): LibraryGame {
  const appId = script.app_id;
  const meta = metadata[appId];
  const id = stableIdFromString("lua", String(appId));
  const isDisabled = script.is_disabled;
  return {
    id,
    appId: String(appId),
    title: meta?.name || `Steam App ${appId}`,
    source: "lua",
    imageUrl: getImageUrl(meta),
    metadata: meta,
    isPlayable: false,
    isInstallable: !!script.app_id,
    steamInstalled: false,
    luaScripts: [script],
    hasLua: true,
    isLuaActive: !isDisabled,
    isLuaDisabled: isDisabled,
    hasLuaSource: false,
    sources: [],
  };
}

function mergeLuaIntoGame(
  game: LibraryGame,
  scripts: InstalledLuaScript[],
  sources: Set<string>,
): void {
  game.luaScripts = scripts;
  game.hasLua = true;
  game.isLuaActive = scripts.some((s) => !s.is_disabled);
  game.isLuaDisabled = scripts.every((s) => s.is_disabled);
  if (game.appId) {
    game.hasLuaSource = sources.has(game.appId);
  }
  if (game.source === "lua" && game.title === `Steam App ${game.appId}`) {
    const firstScript = scripts[0];
    if (firstScript) {
      game.title = `App ${game.appId}`;
    }
  }
}

export async function resolveLibraryGames(
  settings: AppSettings,
): Promise<{ games: LibraryGame[]; warnings: string[] }> {
  const warnings: string[] = [];

  // 1. Steam installed scan
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

  // 4. Collect all Steam appIds for metadata
  const steamAppIds = new Set<number>();
  for (const g of steamGames) {
    steamAppIds.add(g.appId);
  }
  for (const s of luaScripts) {
    steamAppIds.add(s.app_id);
  }

  let metadata: Record<number, SteamAppMetadata> = {};
  if (steamAppIds.size > 0) {
    try {
      metadata = await resolveGameMetadata(Array.from(steamAppIds));
    } catch (error) {
      warnings.push(`Metadata resolve failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 5. Read sync index for Lua sources
  const sourceAppIds = new Set<string>();
  try {
    const syncIndexData = await readSyncIndex();
    for (const key of Object.keys(syncIndexData.items)) {
      sourceAppIds.add(key);
    }
  } catch {
    // sync index is optional
  }

  // 6. Merge everything
  const gamesMap = new Map<string, LibraryGame>();

  // Steam games first
  for (const steam of steamGames) {
    const game = buildFromSteam(steam, metadata);
    gamesMap.set(game.id, game);
  }

  // Local EXEs
  for (const exe of localExes) {
    const game = buildFromLocalExe(exe);
    // Dedup by executable path
    const existingKey = game.id;
    if (!gamesMap.has(existingKey)) {
      gamesMap.set(existingKey, game);
    }
  }

  // Lua scripts — merge into existing or create new
  const luaByAppId = new Map<number, InstalledLuaScript[]>();
  for (const script of luaScripts) {
    const list = luaByAppId.get(script.app_id) || [];
    list.push(script);
    luaByAppId.set(script.app_id, list);
  }

  for (const [appIdNum, scripts] of luaByAppId) {
    const appIdStr = String(appIdNum);
    const existingGame = Array.from(gamesMap.values()).find(
      (g) => g.appId === appIdStr,
    );
    if (existingGame) {
      mergeLuaIntoGame(existingGame, scripts, sourceAppIds);
    } else {
      const game = buildFromLuaScript(scripts[0], metadata);
      game.luaScripts = scripts;
      game.isLuaActive = scripts.some((s) => !s.is_disabled);
      game.isLuaDisabled = scripts.every((s) => s.is_disabled);
      game.hasLuaSource = sourceAppIds.has(appIdStr);
      gamesMap.set(game.id, game);
    }
  }

  const games = Array.from(gamesMap.values()).sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  return { games, warnings };
}
