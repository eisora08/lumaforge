/**
 * Generic mappers for converting between GameV2 (SQLite) and LibraryGame (UI).
 *
 * These mappers are source-agnostic — they work for Steam, Manual, Epic, Debrid, etc.
 * The goal: every read/write goes through games_v2, and these mappers handle the conversion.
 */

import type { GameV2 } from "../types/gameV2";
import type { LibraryGame, LibraryGameSource } from "../types/libraryGame";
import type { SteamAppMetadata, SteamMovie } from "../types/gameMetadata";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a timestamp to milliseconds.
 * DB may hold: seconds (<10^10), milliseconds (10^10–10^14), or nanoseconds (>10^14).
 */
function normalizeToMs(value: number): number {
  if (value > 1e14) return Math.floor(value / 1_000_000); // nanoseconds → ms
  if (value > 1e10) return value; // already ms
  return value * 1000; // seconds → ms
}

/** Parse a JSON array string safely, returning [] on failure. */
function parseJsonArray(s?: string): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Check if path looks like an absolute path. */
function isAbsolutePath(p?: string): boolean {
  if (!p) return false;
  const t = p.trim();
  if (!t) return false;
  if (/^[A-Za-z]:[\\/]/.test(t) || /^\\\\/.test(t)) return true;
  if (t.startsWith("/")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// GameV2 → LibraryGame (generic, works for any source)
// ---------------------------------------------------------------------------

/**
 * Convert a GameV2 row from games_v2 into a LibraryGame for the UI.
 *
 * This is the PRIMARY mapper — every game displayed in the library should go through here.
 * Source-specific fields (like repacker, debridStatus) need to be set separately
 * since they're not stored in games_v2.
 */
export function gameV2ToLibraryGame(game: GameV2): LibraryGame {
  const genres = parseJsonArray(game.genres);
  const tags = parseJsonArray(game.tags);
  const mergedGenres = [...genres, ...tags.filter((t) => !genres.includes(t))];

  const categories = parseJsonArray(game.categories);
  const features = parseJsonArray(game.features);
  const mergedCategories = [...categories, ...features.filter((f) => !categories.includes(f))];

  const developers = parseJsonArray(game.developers);
  const publishers = parseJsonArray(game.publishers);

  const description = game.description ?? game.shortDescription ?? null;
  const aboutTheGame = game.description && game.shortDescription
    ? game.description
    : null;

  // Parse providerMetadata for source-specific fields (e.g. repacker for Debrid)
  let repacker: string | undefined;
  let emulatorConfigId: string | undefined;
  let emulatorProfileId: string | undefined;
  let emulatorPlatform: string | undefined;
  let pmScreenshots: string[] = [];
  let pmMovies: unknown[] = [];
  try {
    if (game.providerMetadata) {
      const pm = JSON.parse(game.providerMetadata);
      repacker = pm.repacker ?? undefined;
      if (game.source === "emulator") {
        emulatorConfigId = pm.emulatorConfigId;
        emulatorProfileId = pm.emulatorProfileId;
        emulatorPlatform = pm.platform;
      }
      if (Array.isArray(pm.screenshots)) pmScreenshots = pm.screenshots;
      if (Array.isArray(pm.movies)) pmMovies = pm.movies;
    }
  } catch { /* ignore */ }

  const metadata: SteamAppMetadata = {
    app_id: game.appId ? parseInt(game.appId, 10) || 0 : 0,
    name: game.title,
    developer: developers.length > 0 ? developers.join(", ") : null,
    short_description: description,
    about_the_game: aboutTheGame,
    detailed_description: null,
    genres: mergedGenres,
    publishers,
    release_date: game.releaseDate ?? null,
    categories: mergedCategories,
    platforms: [],
    languages: [],
    dlc_count: 0,
    dlc_app_ids: [],
    screenshots: pmScreenshots.length > 0 ? pmScreenshots : [],
    movies: pmMovies.length > 0 ? pmMovies as SteamMovie[] : [],
    resolved: false,
  };

  const libraryId = game.libraryId ?? game.id;

  const imageUrl =
    game.coverPath ??
    game.landscapePath ??
    game.backgroundPath ??
    game.iconPath ??
    undefined;

  const iconPath =
    game.iconPath ??
    game.coverPath ??
    game.landscapePath ??
    game.backgroundPath ??
    undefined;

  // Determine source type for LibraryGame
  const source = game.source as LibraryGameSource;

  // Extract appId from ID when DB field is null (e.g., "steam-3768760" → "3768760")
  const appId = game.appId ?? (() => {
    const m = game.id?.match(/^(?:steam|lua)-(\d+)$/);
    return m ? m[1] : undefined;
  })();

  return {
    id: game.id,
    title: game.title,
    source,
    libraryId,
    providerId: game.source,
    providerGameId: game.providerGameId ?? appId,
    appId,
    linkedSteamAppId: game.linkedAppId,
    linkedIgdbId: game.linkedIgdbId,

    executablePath: game.exePath,
    workingDirectory: game.workingDirectory,
    launchArguments: game.launchArguments,
    installDir: game.installDir,
    libraryPath: undefined,
    repacker,

    coverPath: game.coverPath,
    landscapePath: game.landscapePath,
    backgroundPath: game.backgroundPath,
    logoPath: game.logoPath,
    imageUrl,
    iconPath,

    metadata,

    isPlayable: game.source === "emulator"
      ? game.isInstalled
      : game.isInstalled && (isAbsolutePath(game.exePath) || game.source === "lua" || game.source === "steam" || game.source === "epic"),
    isInstallable: game.source === "debrid",
    steamInstalled: (game.source === "steam" && game.isInstalled) || (game.hasLua && game.isInstalled),
    isInstalled: game.isInstalled,

    luaScripts: (() => { try { return JSON.parse(game.luaScriptsJson ?? "[]"); } catch { return []; } })(),
    hasLua: game.hasLua,
    isLuaActive: game.hasLua,
    isLuaDisabled: false,
    hasLuaSource: game.hasLua,
    sources: [],

    isFavorite: game.isFavorite,
    isStandalone: game.standalone,
    sizeOnDisk: game.installSize,
    createdAt: game.createdAt ?? undefined,

    // Playtime — restore to both steam and local fields so every consumer finds data regardless of source
    // DB may hold ns (epic launcher timestamps), ms (manual/epic via local session), or legacy seconds (steam via old importExternalPlaytime)
    // Normalize lastPlayedAt to ms for LibraryGame (consumers expect ms)
    steamPlaytimeMinutes: game.playtimeSeconds ? Math.floor(game.playtimeSeconds / 60) : undefined,
    localPlaytimeMinutes: game.playtimeSeconds ? Math.floor(game.playtimeSeconds / 60) : undefined,
    steamLastPlayedAt: game.lastPlayedAt != null ? normalizeToMs(game.lastPlayedAt) : undefined,
    localLastPlayedAt: game.lastPlayedAt != null ? normalizeToMs(game.lastPlayedAt) : undefined,

    // Completion status
    completionStatus: game.completionStatus ?? undefined,

    // Emulator-specific
    emulatorConfigId,
    emulatorProfileId,
    emulatorPlatform,
  };
}

// ---------------------------------------------------------------------------
// Manual: ManualGameEntry → GameV2
// ---------------------------------------------------------------------------

/**
 * Convert a ManualGameEntry to GameV2.
 */
export function manualGameEntryToGameV2(entry: {
  id: string;
  name: string;
  executablePath?: string;
  workingDirectory?: string;
  launchArguments?: string;
  installDir?: string;
  libraryPath?: string;
  coverPath?: string;
  landscapePath?: string;
  backgroundPath?: string;
  logoPath?: string;
  iconPath?: string;
  appId?: string;
  linkedSteamAppId?: string;
  genres?: string[];
  tags?: string[];
  categories?: string[];
  features?: string[];
  developers?: string[];
  publishers?: string[];
  description?: string;
  shortDescription?: string;
  releaseDate?: string;
  isFavorite?: boolean;
  sizeOnDisk?: number;
  createdAt?: number;
}): GameV2 {
  const now = Date.now();
  const libraryId = `manual:${entry.id}`;

  // Merge genres and tags
  const genres = entry.genres ?? [];
  const tags = entry.tags ?? [];
  const mergedGenres = [...genres, ...tags.filter((t) => !genres.includes(t))];

  // Merge categories and features
  const categories = entry.categories ?? [];
  const features = entry.features ?? [];
  const mergedCategories = [...categories, ...features.filter((f) => !categories.includes(f))];

  return {
    id: libraryId,
    title: entry.name ?? "Untitled",
    source: "manual",
    appId: entry.appId ?? entry.linkedSteamAppId,
    providerGameId: entry.id,
    libraryId,

    isInstalled: false, // Manual games are not "installed" in the traditional sense
    exePath: entry.executablePath,
    workingDirectory: entry.workingDirectory,
    launchArguments: entry.launchArguments,
    installDir: entry.installDir,
    installSize: entry.sizeOnDisk,

    playtimeSeconds: 0,
    playCount: 0,

    coverPath: entry.coverPath,
    landscapePath: entry.landscapePath,
    backgroundPath: entry.backgroundPath,
    logoPath: entry.logoPath,
    iconPath: entry.iconPath,

    genres: JSON.stringify(mergedGenres),
    developers: JSON.stringify(entry.developers ?? []),
    publishers: JSON.stringify(entry.publishers ?? []),
    categories: JSON.stringify(mergedCategories),
    features: JSON.stringify(entry.features ?? []),
    tags: JSON.stringify(entry.tags ?? []),
    shortDescription: entry.shortDescription ?? entry.description,
    releaseDate: entry.releaseDate,

    isFavorite: entry.isFavorite ?? false,
    isHidden: false,
    standalone: false,

    hasLua: false,

    createdAt: entry.createdAt ?? now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Steam: GameEntry (old table) → GameV2
// ---------------------------------------------------------------------------

/**
 * Convert a Steam GameEntry (from old `games` table) to GameV2.
 * Used during migration from old writes to games_v2.
 */
export function steamGameToGameV2(entry: {
  appId: string;
  title: string;
  installed: boolean;
  playtime: number;
  lastPlayed: number;
  metadataJson: string;
  updatedAt: number;
  provider?: string;
  mediaJson?: string;
}): GameV2 {
  const now = Date.now();

  // Parse metadata to extract genres, developers, etc.
  let metadata: Record<string, unknown> = {};
  try {
    metadata = entry.metadataJson ? JSON.parse(entry.metadataJson) : {};
  } catch {
    // ignore
  }

  // Parse media to extract cover paths
  let media: Record<string, unknown> = {};
  try {
    media = entry.mediaJson ? JSON.parse(entry.mediaJson) : {};
  } catch {
    // ignore
  }

  return {
    id: `steam-${entry.appId}`,
    title: entry.title,
    source: "steam",
    appId: entry.appId,
    providerGameId: entry.appId,
    libraryId: `steam-${entry.appId}`,

    isInstalled: entry.installed,
    playtimeSeconds: entry.playtime * 60, // Convert minutes to seconds
    playCount: 0, // Not tracked in old table
    lastPlayedAt: entry.lastPlayed ? entry.lastPlayed * 1000 : undefined, // Convert seconds to ms

    // Media from mediaJson (if available)
    coverPath: (media.coverPath as string) ?? (media.headerImage as string) ?? undefined,
    landscapePath: (media.landscapePath as string) ?? undefined,
    backgroundPath: (media.backgroundPath as string) ?? undefined,
    logoPath: (media.logoPath as string) ?? undefined,
    iconPath: (media.iconPath as string) ?? undefined,

    // Metadata fields
    genres: JSON.stringify(metadata.genres ?? []),
    developers: JSON.stringify(metadata.developer ? [metadata.developer] : []),
    publishers: JSON.stringify(metadata.publishers ?? []),
    categories: JSON.stringify(metadata.categories ?? []),
    features: JSON.stringify(metadata.features ?? []),
    shortDescription: (metadata.short_description as string) ?? undefined,
    releaseDate: (metadata.release_date as string) ?? undefined,

    isFavorite: false,
    isHidden: false,
    standalone: false,

    hasLua: false,

    createdAt: entry.updatedAt || now,
    updatedAt: entry.updatedAt || now,
  };
}

// ---------------------------------------------------------------------------
// Epic: EpicGameEntryJson → GameV2
// ---------------------------------------------------------------------------

/**
 * Convert an Epic game entry (from epic_games blob) to GameV2.
 */
export function epicGameToGameV2(entry: {
  appName?: string;
  displayName?: string;
  namespace?: string;
  catalogItemId?: string;
  installLocation?: string;
  executablePath?: string;
  installSize?: number;
  installDate?: string;
  // Media paths
  coverPath?: string;
  landscapePath?: string;
  backgroundPath?: string;
  logoPath?: string;
  iconPath?: string;
  // Metadata
  genres?: string[];
  developers?: string[];
  publishers?: string[];
  categories?: string[];
  features?: string[];
  shortDescription?: string;
  releaseDate?: string;
  // Screenshots / Movies (IGDB)
  screenshots?: string[];
  movies?: unknown[];
  // Playtime
  playtimeMinutes?: number;
  lastPlayedSeconds?: number;
  // State
  isInstalled?: boolean;
  isFavorite?: boolean;
  isHidden?: boolean;
  createdAt?: number;
}): GameV2 {
  const now = Date.now();
  const appName = entry.appName ?? "";
  const namespace = entry.namespace ?? "";
  const catalogItemId = entry.catalogItemId ?? "";

  // Build stable providerGameId
  let providerGameId = "";
  if (namespace && catalogItemId && appName) {
    providerGameId = `${namespace}:${catalogItemId}:${appName}`;
  } else if (namespace && catalogItemId) {
    providerGameId = `${namespace}:${catalogItemId}`;
  } else if (namespace && appName) {
    providerGameId = `${namespace}:${appName}`;
  } else {
    providerGameId = appName;
  }

  const libraryId = `epic:${providerGameId}`;

  return {
    id: libraryId,
    title: entry.displayName ?? "Unknown Epic Game",
    source: "epic",
    providerGameId,
    libraryId,

    isInstalled: entry.isInstalled ?? false,
    installDir: entry.installLocation ?? undefined,
    exePath: entry.executablePath ?? undefined,
    installSize: entry.installSize ?? undefined,

    // Media
    coverPath: entry.coverPath,
    landscapePath: entry.landscapePath,
    backgroundPath: entry.backgroundPath,
    logoPath: entry.logoPath,
    iconPath: entry.iconPath,

    // Metadata
    genres: entry.genres ? JSON.stringify(entry.genres) : undefined,
    developers: entry.developers ? JSON.stringify(entry.developers) : undefined,
    publishers: entry.publishers ? JSON.stringify(entry.publishers) : undefined,
    categories: entry.categories ? JSON.stringify(entry.categories) : undefined,
    features: entry.features ? JSON.stringify(entry.features) : undefined,
    shortDescription: entry.shortDescription,
    releaseDate: entry.releaseDate,

    // Screenshots / Movies (IGDB) — persisted in provider_metadata
    providerMetadata: (entry.screenshots?.length || entry.movies?.length)
      ? JSON.stringify({ screenshots: entry.screenshots ?? [], movies: entry.movies ?? [] })
      : undefined,

    // Playtime
    playtimeSeconds: entry.playtimeMinutes ? entry.playtimeMinutes * 60 : 0,
    playCount: 0,
    lastPlayedAt: entry.lastPlayedSeconds ? entry.lastPlayedSeconds * 1000 : undefined,

    // State
    isFavorite: entry.isFavorite ?? false,
    isHidden: entry.isHidden ?? false,
    standalone: false,

    hasLua: false,

    createdAt: entry.createdAt ?? now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Debrid: DebridGameEntry → GameV2
// ---------------------------------------------------------------------------

/**
 * Convert a Debrid game entry (from debrid_games blob) to GameV2.
 */
export function debridGameToGameV2(entry: {
  id: string;
  title: string;
  appId?: number | null;
  installSize?: number | null;
  repacker?: string | null;
  fileSize?: number | null;
  updatedAt?: number;
  // Install state
  installDir?: string | null;
  executablePath?: string | null;
  workingDirectory?: string | null;
  launchArguments?: string[] | null;
  // State
  isFavorite?: boolean;
  isHidden?: boolean;
  createdAt?: number;
}): GameV2 {
  const now = Date.now();
  const providerGameId = entry.id;
  const libraryId = `debrid:${providerGameId}`;

  // Build launch arguments string from array
  const launchArgs = entry.launchArguments?.join(" ") || undefined;

  return {
    id: libraryId,
    title: entry.title || "",
    source: "debrid",
    appId: entry.appId && entry.appId > 0 ? String(entry.appId) : undefined,
    providerGameId,
    libraryId,

    isInstalled: !!(entry.installDir || entry.executablePath),
    installDir: entry.installDir ?? undefined,
    exePath: entry.executablePath ?? undefined,
    workingDirectory: entry.workingDirectory ?? undefined,
    launchArguments: launchArgs,
    installSize: entry.installSize ?? entry.fileSize ?? undefined,

    playtimeSeconds: 0,
    playCount: 0,

    isFavorite: entry.isFavorite ?? false,
    isHidden: entry.isHidden ?? false,
    standalone: false,

    hasLua: false,

    // Store repacker info in providerMetadata
    providerMetadata: JSON.stringify({
      repacker: entry.repacker,
    }),

    createdAt: entry.createdAt ?? now,
    updatedAt: entry.updatedAt ?? now,
  };
}

// ---------------------------------------------------------------------------
// LibraryGame → GameV2 (generic, for seeding games_v2 from fallback sources)
// ---------------------------------------------------------------------------

/**
 * Convert a LibraryGame (UI model) back to a GameV2 row for writing to games_v2.
 * Used when games come from legacy sources (library_cache JSON, reconciled, snapshot)
 * and games_v2 is empty — seeds the table so next boot loads from games_v2 directly.
 */
export function libraryGameToGameV2(game: LibraryGame): GameV2 {
  const now = Date.now();
  const id = game.id || `unknown-${game.appId || now}`;
  const source = game.source || "steam";

  // Extract metadata fields from the embedded SteamAppMetadata if available
  const meta = game.metadata;
  const description = meta?.short_description ?? meta?.detailed_description ?? undefined;
  const genres = meta?.genres ?? [];
  const developers = meta?.developer ? [meta.developer] : [];
  const publishers = meta?.publishers ?? [];
  const categories = meta?.categories ?? [];

  return {
    id,
    title: game.title || "",
    source,
    appId: game.appId ?? undefined,
    providerGameId: game.providerGameId ?? game.appId ?? undefined,
    libraryId: game.libraryId ?? id,

    isInstalled: game.isInstalled ?? false,
    installDir: game.installDir ?? undefined,
    installSize: game.sizeOnDisk ?? undefined,
    exePath: game.executablePath ?? undefined,
    workingDirectory: game.workingDirectory ?? undefined,
    launchArguments: game.launchArguments ?? undefined,

    playtimeSeconds: ((game.steamPlaytimeMinutes ?? game.localPlaytimeMinutes ?? 0)) * 60,
    playCount: 0,
    lastPlayedAt: game.localLastPlayedAt ?? game.steamLastPlayedAt ?? undefined,

    coverPath: game.coverPath ?? undefined,
    landscapePath: game.landscapePath ?? undefined,
    backgroundPath: game.backgroundPath ?? undefined,
    logoPath: game.logoPath ?? undefined,
    iconPath: game.iconPath ?? undefined,

    description,
    shortDescription: meta?.short_description ?? undefined,
    genres: JSON.stringify(genres),
    developers: JSON.stringify(developers),
    publishers: JSON.stringify(publishers),
    categories: JSON.stringify(categories),

    isFavorite: game.isFavorite ?? false,
    isHidden: false,
    standalone: game.isStandalone ?? false,

    hasLua: game.hasLua ?? false,
    luaScriptsJson: JSON.stringify(game.luaScripts ?? []),

    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Emulator: EmulatorGameEntry → GameV2
// ---------------------------------------------------------------------------

/**
 * Convert an EmulatorGameEntry to GameV2 for persisting to games_v2.
 * Emulator-specific fields are stored in provider_metadata as JSON.
 */
export function emulatorGameEntryToGameV2(entry: {
  id: string;
  title: string;
  platform: string;
  romPath: string;
  emulatorConfigId?: string;
  emulatorProfileId?: string;
  fileSize?: number;
  region?: string;
  scanPath?: string;
  coverPath?: string;
  landscapePath?: string;
  backgroundPath?: string;
  logoPath?: string;
  iconPath?: string;
  genres?: string[];
  developers?: string[];
  publishers?: string[];
  releaseDate?: string;
  description?: string;
  screenshots?: string[];
  movies?: unknown[];
  isInstalled?: boolean;
  isFavorite?: boolean;
  lastPlayedAt?: number;
  totalPlaytimeMs?: number;
  createdAt?: number;
  updatedAt?: number;
}): GameV2 {
  const now = Date.now();

  const providerMetadata = JSON.stringify({
    emulatorConfigId: entry.emulatorConfigId,
    emulatorProfileId: entry.emulatorProfileId,
    platform: entry.platform,
    region: entry.region,
    fileSize: entry.fileSize,
    scanPath: entry.scanPath,
    screenshots: entry.screenshots ?? [],
    movies: entry.movies ?? [],
  });

  return {
    id: entry.id,
    title: entry.title,
    source: "emulator",
    providerGameId: entry.id,
    libraryId: entry.id,

    isInstalled: entry.isInstalled ?? true,
    exePath: entry.romPath,
    installDir: undefined,

    playtimeSeconds: entry.totalPlaytimeMs ? Math.floor(entry.totalPlaytimeMs / 1000) : 0,
    playCount: 0,
    lastPlayedAt: entry.lastPlayedAt,

    coverPath: entry.coverPath,
    landscapePath: entry.landscapePath,
    backgroundPath: entry.backgroundPath,
    logoPath: entry.logoPath,
    iconPath: entry.iconPath,

    genres: JSON.stringify(entry.genres ?? []),
    developers: JSON.stringify(entry.developers ?? []),
    publishers: JSON.stringify(entry.publishers ?? []),
    releaseDate: entry.releaseDate,
    description: entry.description,
    shortDescription: entry.description,

    region: entry.region,

    isFavorite: entry.isFavorite ?? false,
    isHidden: false,
    standalone: false,

    hasLua: false,

    providerMetadata,

    createdAt: entry.createdAt ?? now,
    updatedAt: entry.updatedAt ?? now,
  };
}
