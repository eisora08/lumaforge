import type { LibraryGame } from "../types/libraryGame";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { ManualGameEntry } from "./manualGameStore";

const DEBUG_MANUAL_COVER = false;

/**
 * Returns true if the path looks like a full absolute path (contains a directory separator).
 * Bare filenames like "GTAIV.exe" return false — they cannot be launched reliably.
 */
function isAbsolutePath(p: string | undefined): boolean {
  if (!p) return false;
  const t = p.trim();
  if (!t) return false;
  // Windows absolute: C:\..., \\server\share
  if (/^[A-Za-z]:[\\/]/.test(t) || /^\\\\/.test(t)) return true;
  // Unix absolute: /home/...
  if (t.startsWith("/")) return true;
  return false;
}

/**
 * Builds a synthetic SteamAppMetadata from ManualGameEntry fields.
 * Uses app_id=0 (invalid but non-null) so consumers can detect manual games
 * via `game.source === "manual"` while still accessing `game.metadata.*`.
 *
 * Mapping:
 *   - entry.genres → metadata.genres (shown as genre chips)
 *   - entry.tags   → appended to metadata.genres (shown as genre chips)
 *   - entry.categories + entry.features → metadata.categories (shown as features)
 *   - entry.description → metadata.short_description + about_the_game
 *   - entry.developers → metadata.developer (joined)
 *   - entry.publishers → metadata.publishers
 *   - entry.releaseDate → metadata.release_date
 */
function buildManualMetadata(entry: ManualGameEntry): SteamAppMetadata {
  const description = entry.description ?? entry.shortDescription ?? null;
  const aboutTheGame = entry.description && entry.shortDescription
    ? entry.description
    : null;

  const genres = entry.genres ?? [];
  const tags = entry.tags ?? [];
  const mergedGenres = [...genres, ...tags.filter((t) => !genres.includes(t))];

  const categories = entry.categories ?? [];
  const features = entry.features ?? [];
  const mergedCategories = [...categories, ...features.filter((f) => !categories.includes(f))];

  return {
    app_id: 0,
    name: entry.name,
    developer: entry.developers?.join(", ") ?? null,
    short_description: description,
    about_the_game: aboutTheGame,
    detailed_description: null,
    genres: mergedGenres,
    publishers: entry.publishers ?? [],
    release_date: entry.releaseDate ?? null,
    categories: mergedCategories,
    platforms: [],
    languages: [],
    dlc_count: 0,
    dlc_app_ids: [],
    screenshots: [],
    movies: [],
    resolved: false,
  };
}

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
 * Metadata:
 *   - game.metadata is populated from ManualGameEntry fields via buildManualMetadata
 *   - app_id is set to 0 (manual games have no Steam appId)
 *   - Console Mode reads game.metadata.* for developer, publisher, release_date, genres, etc.
 *
 * Favorites:
 *   - isFavorite from ManualGameEntry is carried through for display parity,
 *     but the FavoritesContext (appId-based) cannot toggle these yet.
 *     Step 3+ will need to extend FavoritesContext to support libraryId keys.
 */
export function manualGameToLibraryGame(entry: ManualGameEntry): LibraryGame {
  const libraryId = `manual:${entry.id}`;
  // Library card priority: coverPath first (box art), then landscape, background, icon
  const imageUrl =
    entry.coverPath ??
    entry.landscapePath ??
    entry.backgroundPath ??
    entry.iconPath ??
    undefined;

  // Sidebar/HUD priority: iconPath first (compact thumbnail), then cover, landscape, background
  const iconPath =
    entry.iconPath ??
    entry.coverPath ??
    entry.landscapePath ??
    entry.backgroundPath ??
    undefined;

  if (DEBUG_MANUAL_COVER) console.log(`[MANUAL_COVER][MAPPER_INPUT] id=${entry.id} coverPath=${entry.coverPath} landscapePath=${entry.landscapePath} backgroundPath=${entry.backgroundPath} iconPath=${entry.iconPath}`);

  const metadata = buildManualMetadata(entry);

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
    iconPath,

    metadata,

    isPlayable: isAbsolutePath(entry.executablePath),
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
