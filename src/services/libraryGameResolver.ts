import type { AppSettings } from "../types/settings";
import type { LibraryGame } from "../types/libraryGame";
import type { SteamInstalledGame } from "../types/steamInstalled";
import type { LocalExecutableGame } from "../types/localExecutableGame";
import type { InstalledLuaScript } from "../types/installedLua";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { OwnedSteamGame } from "../types/ownedSteamGame";

import type { LibraryLoadSource, LibraryLoadPhase } from "./libraryProgressService";
import { scanSteamInstalledGames, scanLocalGameFolders, scanInstalledLuaScripts, fetchSteamOwnedGames } from "./tauri";
import { resolveGameMetadata } from "./gameMetadataResolver";
import { readSyncIndex } from "./tauri";
import { isStandalone as isStandaloneById } from "./standaloneStore";

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
    isStandalone: isStandaloneById(String(steam.appId)),
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
    isInstallable: false,
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

function buildFromOwned(
  owned: OwnedSteamGame,
): LibraryGame {
  const appIdStr = String(owned.appid);
  const logoUrl = owned.img_logo_url
    ? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${owned.appid}/${owned.img_logo_url}.jpg`
    : undefined;
  return {
    id: `steam-${appIdStr}`,
    appId: appIdStr,
    title: owned.name || `Steam App ${appIdStr}`,
    source: "steam",
    isPlayable: false,
    isInstallable: true,
    steamInstalled: false,
    imageUrl: logoUrl,
    steamPlaytimeMinutes: Math.floor((owned.playtime_forever || 0) / 60),
    lastUpdated: owned.last_played ? Math.floor(owned.last_played) : undefined,
    luaScripts: [],
    hasLua: false,
    isLuaActive: false,
    isLuaDisabled: false,
    hasLuaSource: false,
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
  options?: { force?: boolean; onProgress?: (source: LibraryLoadSource, phase: LibraryLoadPhase, extra?: { itemsFound?: number; itemsAdded?: number }) => void },
): Promise<{ games: LibraryGame[]; warnings: string[] }> {
  const warnings: string[] = [];
  const { onProgress } = options ?? {};

  // TTL + Store route guard
  if (!checkSteamScanAllowed(options)) {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.startsWith("#/store")) {
      console.log("[steam-scan][SKIP] reason=store-active");
    } else {
      const now = Date.now();
      console.log(`[steam-scan][SKIP] reason=ttl-valid elapsedMs=${now - _lastSteamScanAt}`);
    }
    return { games: [], warnings };
  }

  // 1. Steam installed scan — this provides the PRIMARY game list
  markSteamScanComplete();
  onProgress?.("steam", "scanning-steam-installed");
  let steamGames: SteamInstalledGame[] = [];
  try {
    steamGames = await scanSteamInstalledGames({
      steamPath: settings.steamRoot || undefined,
      luaPath: settings.luaPath || undefined,
      depotcachePath: settings.depotcachePath || undefined,
      gameScanFolders: settings.gameScanFolders.length > 0 ? settings.gameScanFolders : undefined,
    });
    onProgress?.("steam", "scanning-steam-installed", { itemsFound: steamGames.length });
  } catch (error) {
    warnings.push(`Steam scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Local EXE scan
  let localExes: LocalExecutableGame[] = [];
  if (settings.scanLocalGames && settings.gameScanFolders.length > 0) {
    onProgress?.("local-exe", "scanning-local-exe");
    try {
      localExes = await scanLocalGameFolders(settings.gameScanFolders);
      onProgress?.("local-exe", "scanning-local-exe", { itemsFound: localExes.length });
    } catch (error) {
      warnings.push(`Local EXE scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 3. Lua script scan
  let luaScripts: InstalledLuaScript[] = [];
  if (settings.luaPath) {
    onProgress?.("lua", "scanning-lua");
    try {
      luaScripts = await scanInstalledLuaScripts(settings.luaPath);
      onProgress?.("lua", "scanning-lua", { itemsFound: luaScripts.length });
      console.log(`[LUA][LOAD_RESULT] entries=${luaScripts.length} path=${settings.luaPath}`);
    } catch (error) {
      warnings.push(`Lua scan failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`[LUA][LOAD_RESULT] error=${error instanceof Error ? error.message : String(error)}`);
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
      console.log(`[LUA][MERGE_INTO] appId=${appIdStr} title="${existingGame.title}" steamInstalled=${existingGame.steamInstalled} scripts=${scripts.length}`);
      mergeLuaIntoGame(existingGame, true, scripts, sourceAppIds);
      console.log(`[LUA][MERGE_AFTER] appId=${appIdStr} hasLua=${existingGame.hasLua} luaScripts=${existingGame.luaScripts.length} isPlayable=${existingGame.isPlayable} isInstallable=${existingGame.isInstallable} steamInstalled=${existingGame.steamInstalled}`);
    } else {
      console.log(`[LUA][ENTRY] appId=${appIdStr} scripts=${scripts.length} disabled=${scripts.every(s => s.is_disabled)}`);
      const game = buildFromLua(appIdStr, scripts, sourceAppIds, metadata);
      gamesMap.set(game.id, game);
    }
  }

  // 10. Steam owned games (non-installed, from Web API)
  if (settings.steamWebApiKey && settings.steamId64) {
    onProgress?.("steam-owned", "fetching-steam-owned");
    try {
      const ownedGames = await fetchSteamOwnedGames(settings.steamWebApiKey, settings.steamId64);
      let ownedMerged = 0;
      let ownedSkipped = 0;
      let ownedLuaMerged = 0;
      for (const owned of ownedGames) {
        const appIdStr = String(owned.appid);
        if (steamByAppId.has(appIdStr) || gamesMap.has(`steam-${appIdStr}`)) {
          ownedSkipped++;
          continue;
        }
        // Check if a Lua entry with this appId already exists; merge ownership into it
        const existingLua = gamesMap.get(`lua-${appIdStr}`);
        if (existingLua) {
          console.log(`[LUA][OWNED_MERGE] appId=${appIdStr} title="${existingLua.title}" wasInstallable=${existingLua.isInstallable} setInstallable=true`);
          existingLua.isInstallable = true;
          ownedLuaMerged++;
          continue;
        }
        // Create new Steam owned entry
        const game = buildFromOwned(owned);
        gamesMap.set(game.id, game);
        ownedMerged++;
      }
      onProgress?.("steam-owned", "fetching-steam-owned", { itemsFound: ownedGames.length, itemsAdded: ownedMerged });
      if (ownedMerged > 0 || ownedLuaMerged > 0) {
        console.log(`[LIBRARY][OWNED_MERGED] new=${ownedMerged} lua-merged=${ownedLuaMerged} skipped=${ownedSkipped}`);
      }
    } catch (error) {
      warnings.push(`Steam owned games fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  onProgress?.("unknown", "merging-library");
  const games = Array.from(gamesMap.values()).sort((a, b) => {
    const ta = a.title || a.appId || "";
    const tb = b.title || b.appId || "";
    return ta.localeCompare(tb);
  });

  return { games, warnings };
}
