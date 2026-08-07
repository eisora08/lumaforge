import type { GameEntry } from "./tauri";
import {
  readAllGames,
  scanInstalledLuaScripts,
} from "./tauri";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { LibraryGame } from "../types/libraryGame";
import type { LocalExecutableGame } from "../types/localExecutableGame";

// ---------------------------------------------------------------------------
// Lua overlay — a flat map of appId → boolean
// Lua does NOT define the game list; it only flags existing games.
// ---------------------------------------------------------------------------

export type LuaOverlayMap = Record<string, boolean>;

let cachedLuaOverlay: LuaOverlayMap | null = null;

export async function scanLuaOverlay(luaPath?: string): Promise<LuaOverlayMap> {
  if (!luaPath) {
    cachedLuaOverlay = {};
    return {};
  }
  try {
    const scripts = await scanInstalledLuaScripts(luaPath);
    const map: LuaOverlayMap = {};
    for (const s of scripts) {
      map[String(s.app_id)] = true;
    }
    cachedLuaOverlay = map;
    return map;
  } catch {
    cachedLuaOverlay = {};
    return {};
  }
}

export function getCachedLuaOverlay(): LuaOverlayMap {
  return cachedLuaOverlay ?? {};
}

// ---------------------------------------------------------------------------
// Full Steam game index — from SQLite `games` table
// Instant read — no manifests, no blocking.
// ---------------------------------------------------------------------------

export type SteamGameIndexEntry = {
  appId: string;
  title: string;
  installed: boolean;
  playtime: number;
  lastPlayed: number;
  metadata: SteamAppMetadata | null;
};

function parseMetadata(json: string): SteamAppMetadata | null {
  if (!json || json === "{}") return null;
  try {
    return JSON.parse(json) as SteamAppMetadata;
  } catch {
    return null;
  }
}

function mapGameEntry(entry: GameEntry): SteamGameIndexEntry {
  return {
    appId: entry.appId,
    title: entry.title,
    installed: entry.installed,
    playtime: entry.playtime,
    lastPlayed: entry.lastPlayed,
    metadata: parseMetadata(entry.metadataJson),
  };
}

/**
 * Load all games from SQLite `games` table.
 * This is instant — no scanning, no I/O beyond SQLite.
 */
export async function loadSteamGameIndex(): Promise<SteamGameIndexEntry[]> {
  const entries = await readAllGames();
  return entries.map(mapGameEntry);
}

export async function getSteamGameCount(): Promise<number> {
  const entries = await readAllGames();
  return entries.length;
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

/**
 * Merge a SteamGameIndexEntry with a Lua overlay and local EXE data
 * to produce a LibraryGame.
 */
export function indexEntryToLibraryGame(
  entry: SteamGameIndexEntry,
  luaOverlay: LuaOverlayMap,
): LibraryGame {
  const appIdStr = entry.appId;
  const hasLua = luaOverlay[appIdStr] === true;
  return {
    id: `steam-${appIdStr}`,
    appId: appIdStr,
    title: entry.title || "",
    source: "steam",
    metadata: entry.metadata ?? undefined,
    imageUrl: entry.metadata?.header_image || entry.metadata?.capsule_image || entry.metadata?.capsule_image_v5 || undefined,
    isPlayable: entry.installed,
    isInstallable: !entry.installed,
    steamInstalled: entry.installed,
    hasLua,
    isLuaActive: hasLua,
    isLuaDisabled: false,
    hasLuaSource: false,
    luaScripts: [],
    sources: [],
    steamPlaytimeMinutes: entry.playtime,
    steamLastPlayedAt: entry.lastPlayed || undefined,
  };
}

export function localExeToLibraryGame(
  exe: LocalExecutableGame,
): LibraryGame {
  const dirName = exe.directoryName || "";
  const fileName = exe.fileName || exe.executablePath.split("\\").pop()?.split("/").pop() || exe.executablePath;
  const id = `local-${stableHash(exe.executablePath)}`;
  return {
    id,
    appId: undefined,
    title: dirName || fileName.replace(/\.exe$/i, ""),
    source: "local",
    executablePath: exe.executablePath,
    installDir: dirName,
    isPlayable: true,
    isInstallable: false,
    steamInstalled: false,
    hasLua: false,
    isLuaActive: false,
    isLuaDisabled: false,
    hasLuaSource: false,
    luaScripts: [],
    sources: [],
  };
}

function stableHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0;
  }
  return Math.abs(hash).toString(36);
}
