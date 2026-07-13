import type { LibraryGame } from "../types/libraryGame";
import type { ManualGameEntry } from "./manualGameStore";

const DEBUG_MANUAL_COVER = false;

/**
 * Pure function: converts a persisted ManualGameEntry into a LibraryGame
 * suitable for in-memory merge into the Library grid.
 *
 * Identity rules:
 *   - source = "manual" always
 *   - appId is NEVER set (manual games are not Steam games)
 *   - libraryId = "manual:<entry.id>"
 *   - providerId = "manual"
 *   - providerGameId = entry.id
 *
 * State flags:
 *   - isPlayable = true when executablePath is set (Step 4)
 *   - isInstallable = false
 *   - steamInstalled = false
 *   - all Lua flags = false / empty
 *
 * Favorites:
 *   - isFavorite from ManualGameEntry is carried through for display parity,
 *     but the FavoritesContext (appId-based) cannot toggle these yet.
 *     Step 3+ will need to extend FavoritesContext to support libraryId keys.
 */
export function manualGameToLibraryGame(entry: ManualGameEntry): LibraryGame {
  const libraryId = `manual:${entry.id}`;
  const imageUrl =
    entry.coverPath ??
    entry.landscapePath ??
    entry.backgroundPath ??
    undefined;

  if (DEBUG_MANUAL_COVER) console.log(`[MANUAL_COVER][MAPPER_INPUT] id=${entry.id} coverPath=${entry.coverPath} landscapePath=${entry.landscapePath} backgroundPath=${entry.backgroundPath}`);

  const game: LibraryGame = {
    id: libraryId,
    title: entry.name,
    source: "manual",
    libraryId,
    providerId: "manual",
    providerGameId: entry.id,

    executablePath: entry.executablePath,
    workingDirectory: entry.workingDirectory,
    launchArguments: entry.launchArguments,
    installDir: entry.installDir,
    libraryPath: entry.libraryPath,

    imageUrl,

    isPlayable: !!entry.executablePath,
    isInstallable: false,
    steamInstalled: false,

    luaScripts: [],
    hasLua: false,
    isLuaActive: false,
    isLuaDisabled: false,
    hasLuaSource: false,
    sources: [],

    isFavorite: entry.isFavorite ?? false,
    sizeOnDisk: entry.sizeOnDisk,
  };

  if (DEBUG_MANUAL_COVER) console.log(`[MANUAL_COVER][MAPPER_OUTPUT] id=${game.id} source=${game.source} imageUrl=${game.imageUrl}`);

  return game;
}
