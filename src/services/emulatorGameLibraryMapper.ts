/**
 * Emulator Game Library Mapper
 *
 * Converts EmulatorGameEntry to LibraryGame for integration with the library.
 * Follows the same pattern as manualGameLibraryMapper.ts.
 */

import type { LibraryGame } from "../types/libraryGame";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { EmulatorGameEntry } from "../data/emulatorDefinitions/types";
import { getPlatformById } from "../data/emulatorDefinitions/platforms";
import { getEmulatorConfig } from "./emulatorConfigStore";

/**
 * Builds a synthetic SteamAppMetadata from EmulatorGameEntry fields.
 * Uses app_id=0 (invalid but non-null) so consumers can detect emulator games
 * via `game.source === "emulator"` while still accessing `game.metadata.*`.
 */
function buildEmulatorMetadata(entry: EmulatorGameEntry): SteamAppMetadata {
  const platform = getPlatformById(entry.platform);

  return {
    app_id: 0,
    name: entry.title,
    developer: entry.developers?.join(", ") ?? null,
    short_description: entry.description ?? null,
    about_the_game: entry.description ?? null,
    detailed_description: null,
    genres: entry.genres ?? [],
    publishers: entry.publishers ?? [],
    release_date: entry.releaseDate ?? null,
    categories: [],
    platforms: platform ? [platform.name] : [],
    languages: [],
    dlc_count: 0,
    dlc_app_ids: [],
    screenshots: [],
    movies: [],
    resolved: false,
  };
}

/**
 * Pure function: converts a persisted EmulatorGameEntry into a LibraryGame
 * suitable for in-memory merge into the Library grid.
 *
 * Identity rules:
 *   - source = "emulator" always
 *   - appId is NEVER set (emulator games are not Steam games)
 *   - libraryId = "emulator:<entry.id>"
 *   - providerId = "emulator"
 *   - providerGameId = entry.id
 *
 * State flags:
 *   - isPlayable = true (ROM can be launched via emulator)
 *   - isInstallable = false
 *   - steamInstalled = false
 *   - all Lua flags = false / empty
 *
 * Metadata:
 *   - game.metadata is populated from EmulatorGameEntry fields
 *   - app_id is set to 0 (emulator games have no Steam appId)
 */
export function emulatorGameToLibraryGame(entry: EmulatorGameEntry): LibraryGame {
  // entry.id is already "emulator:<uuid>" format
  const libraryId = entry.id;

  // Get install directory from emulator config
  const config = entry.emulatorConfigId ? getEmulatorConfig(entry.emulatorConfigId) : undefined;
  const installDir = config?.installDir;

  // Library card priority: coverPath first, then landscape, background, icon
  const imageUrl =
    entry.coverPath ??
    entry.landscapePath ??
    entry.backgroundPath ??
    entry.iconPath ??
    undefined;

  // Sidebar/HUD priority: iconPath first, then cover, landscape, background
  const iconPath =
    entry.iconPath ??
    entry.coverPath ??
    entry.landscapePath ??
    entry.backgroundPath ??
    undefined;

  const metadata = buildEmulatorMetadata(entry);

  const game: LibraryGame = {
    id: libraryId,
    title: entry.title,
    source: "emulator",
    libraryId,
    providerId: "emulator",
    providerGameId: entry.id,

    executablePath: entry.romPath,
    installDir: installDir ?? undefined,

    coverPath: entry.coverPath,
    landscapePath: entry.landscapePath,
    backgroundPath: entry.backgroundPath,
    logoPath: entry.logoPath,
    imageUrl,
    iconPath,

    metadata,

    isInstalled: entry.isInstalled ?? false,
    isPlayable: true,
    isInstallable: false,
    steamInstalled: false,

    luaScripts: [],
    hasLua: false,
    isLuaActive: false,
    isLuaDisabled: false,
    hasLuaSource: false,
    sources: [],

    isFavorite: entry.isFavorite ?? false,
  };

  return game;
}

/**
 * Convert multiple EmulatorGameEntry to LibraryGame.
 */
export function emulatorGamesToLibraryGames(entries: EmulatorGameEntry[]): LibraryGame[] {
  return entries.map(emulatorGameToLibraryGame);
}

/**
 * Get the display name for a platform.
 */
export function getPlatformDisplayName(platformId: string): string {
  const platform = getPlatformById(platformId);
  return platform?.shortName ?? platformId;
}
