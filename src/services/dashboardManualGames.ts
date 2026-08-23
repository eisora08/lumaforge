/**
 * Helpers for including manual games in dashboard sections.
 *
 * Dashboard sections primarily read from `StartupSnapshot.library.games`
 * (which only contains Steam/installed games). Manual games live in
 * `useLibraryGames()` and need to be merged in.
 *
 * This module provides:
 * - A common display shape for dashboard cards
 * - Playtime/lastPlayed resolution via playtime store
 * - Image URL resolution via resolveProviderMediaPreviewUrl
 */
import type { LibraryGame } from "../types/libraryGame";
import type { SnapshotGame } from "./startupSnapshotService";
import {
  resolvePlaytimeKey,
  getPlaytimeEntryByGameKey,
} from "./playtimeService";
import { resolveProviderMediaPreviewUrl } from "./gameCacheService";

/**
 * Pick the best image path from a LibraryGame's role fields.
 * Epic/manual games have role paths (coverPath, landscapePath, etc.) set by
 * mergeEpicOverrides or manualGameToLibraryGame, but imageUrl is often undefined.
 * This helper provides the single source of truth for picking the best image
 * from any LibraryGame regardless of provider.
 *
 * Priority for hero/background: backgroundPath → landscapePath → coverPath → imageUrl
 * Priority for card/thumbnail: coverPath → landscapePath → backgroundPath → imageUrl
 */
export function getHeroImageCandidate(game: {
  imageUrl?: string | null;
  backgroundPath?: string | null;
  landscapePath?: string | null;
  coverPath?: string | null;
}): string | null {
  return game.backgroundPath ?? game.landscapePath ?? game.coverPath ?? game.imageUrl ?? null;
}

/**
 * Card image candidate — prefers landscape for wider cards.
 */
export function getCardImageCandidate(game: {
  imageUrl?: string | null;
  coverPath?: string | null;
  landscapePath?: string | null;
  backgroundPath?: string | null;
}): string | null {
  return game.landscapePath ?? game.backgroundPath ?? game.coverPath ?? game.imageUrl ?? null;
}

/**
 * Icon candidate from a LibraryGame.
 */
export function getIconCandidate(game: {
  iconPath?: string | null;
  coverPath?: string | null;
}): string | null {
  return game.iconPath ?? game.coverPath ?? null;
}

/**
 * Lightweight display game that both SnapshotGame and manual LibraryGame
 * can map to. Used by dashboard sections for unified rendering.
 */
export type DashboardDisplayGame = {
  /** Stable unique key: `steam:<appId>` for Steam, `manual:<uuid>` for manual */
  stableId: string;
  /** Steam appId (undefined for manual games) */
  appId?: string;
  /** Manual game libraryId (undefined for Steam games) */
  libraryId?: string;
  /** source: "steam" | "manual" | etc. */
  source: string;
  /** Display title */
  title: string;
  /** Resolved image URL for card (landscape/cover/background) */
  imageUrl: string | null;
  /** Resolved icon URL for HUD/chips */
  iconUrl: string | null;
  /** Total playtime in seconds */
  totalPlaytimeSeconds: number;
  /** Last played timestamp in seconds (unix) */
  lastPlayedAt: number | null;
  /** Whether the game is running */
  isRunning: boolean;
  /** Whether the game is installed */
  installed: boolean;
  /** Whether the game is playable */
  playable: boolean;
  /** Snapshot updatedAt (for sorting) */
  updatedAt: number;
  /** The original LibraryGame reference (for navigation) */
  _libraryGame?: LibraryGame;
  /** The original SnapshotGame reference (for snapshot fields) */
  _snapshotGame?: SnapshotGame;
  /** Raw role paths from the source game (pre-resolution) for diagnostics */
  _rolePaths?: {
    backgroundPath?: string | null;
    landscapePath?: string | null;
    coverPath?: string | null;
    logoPath?: string | null;
    iconPath?: string | null;
  };
};

/**
 * Convert a SnapshotGame to DashboardDisplayGame.
 * Resolves playtime from the playtime store (authoritative) with snapshot fallback.
 * @param libraryGame - Optional matching LibraryGame for provider-aware playtime key resolution.
 *                     When provided, uses resolvePlaytimeKey (handles debrid/manual/epic keys).
 */
export function snapshotToDisplayGame(
  game: SnapshotGame,
  runningAppIds: Set<string>,
  libraryGame?: LibraryGame,
): DashboardDisplayGame {
  // Provider-aware: use resolvePlaytimeKey when a LibraryGame is available,
  // fall back to hardcoded `app-${appId}` for pure-SnapshotGame callers
  const ptKey = libraryGame
    ? resolvePlaytimeKey(libraryGame)
    : (game.appId ? `app-${game.appId}` : null);
  let ptEntry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
  // Fallback: entries may be under app-${appId} regardless of source (e.g. startPlaySession
  // uses computeGameKey which returns app-${appId} for any game with appId)
  if (!ptEntry && game.appId && ptKey !== `app-${game.appId}`) {
    ptEntry = getPlaytimeEntryByGameKey(`app-${game.appId}`);
  }
  // Defense: also check steam-{appId} key and pick the entry with the most recent lastPlayedAt.
  // enrichWithStats used to write under game.id ("steam-{appId}") while dashboard reads "app-{appId}".
  if (game.appId) {
    const altKey = `steam-${game.appId}`;
    const altEntry = getPlaytimeEntryByGameKey(altKey);
    if (altEntry && altEntry !== ptEntry) {
      const altLast = altEntry.lastPlayedAt ?? 0;
      const curLast = ptEntry?.lastPlayedAt ?? 0;
      if (altLast > curLast) ptEntry = altEntry;
      // Also merge: if primary has playtime but no lastPlayed, take from alt
      if (ptEntry && !ptEntry.lastPlayedAt && altEntry.lastPlayedAt) ptEntry = altEntry;
    }
  }
  const totalSeconds = ptEntry?.totalPlaytimeSeconds ?? (game.playtime ? game.playtime * 60 : 0);
  const lastPlayed = ptEntry?.lastPlayedAt ?? game.lastPlayed ?? null;

  return {
    stableId: game.appId,
    appId: game.appId,
    source: game.source,
    title: game.title,
    imageUrl: null, // resolved async by caller
    iconUrl: null,  // resolved async by caller
    totalPlaytimeSeconds: totalSeconds,
    lastPlayedAt: lastPlayed,
    isRunning: game.appId ? runningAppIds.has(game.appId) : false,
    installed: game.installed,
    playable: game.playable,
    updatedAt: game.updatedAt ?? 0,
    _snapshotGame: game,
    _libraryGame: libraryGame,
    _rolePaths: game.media ? {
      backgroundPath: game.media.backgroundPath ?? null,
      landscapePath: game.media.landscapePath ?? null,
      coverPath: game.media.coverPath ?? null,
      logoPath: game.media.logoPath ?? null,
      iconPath: game.media.iconPath ?? null,
    } : undefined,
  };
}

/**
 * Canonical game identity lookup — provider-neutral.
 * Priority: libraryId > providerId+providerGameId > id > appId (Steam-only).
 * Used for hero lookup, favorites lookup, click navigation, details identity.
 */
export function resolveCanonicalGameIdentity(game: LibraryGame): string {
  if (game.libraryId) return game.libraryId;
  if (game.providerId && game.providerGameId) return `${game.providerId}:${game.providerGameId}`;
  if (game.id) return game.id;
  if (game.appId) return game.appId;
  return game.id;
}

/**
 * Convert a manual/Epic LibraryGame to DashboardDisplayGame.
 * Resolves playtime from the playtime store.
 * @param sourceOverride - Force source field (e.g. "epic" for Epic games)
 */
export function manualToDisplayGame(
  game: LibraryGame,
  runningAppIds: Set<string>,
  sourceOverride?: string,
): DashboardDisplayGame {
  const ptKey = resolvePlaytimeKey(game);
  const ptEntry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
  const totalSeconds = ptEntry?.totalPlaytimeSeconds ?? 0;
  const lastPlayed = ptEntry?.lastPlayedAt ?? null;

  return {
    stableId: game.libraryId || game.id,
    appId: (game as any).appId ?? undefined,
    libraryId: game.libraryId,
    source: sourceOverride ?? game.source ?? "manual",
    title: game.title,
    imageUrl: null, // resolved async by caller — don't pre-bake; different surfaces need different role priorities
    iconUrl: getIconCandidate(game),
    totalPlaytimeSeconds: totalSeconds,
    lastPlayedAt: lastPlayed,
    isRunning: runningAppIds.has(game.id),
    installed: game.isInstalled ?? true,
    playable: game.isPlayable,
    updatedAt: 0,
    _libraryGame: game,
    _rolePaths: {
      backgroundPath: game.backgroundPath ?? null,
      landscapePath: game.landscapePath ?? null,
      coverPath: game.coverPath ?? null,
      logoPath: game.logoPath ?? null,
      iconPath: game.iconPath ?? null,
    },
  };
}

/**
 * Filter manual games from libraryGames that should appear in dashboard sections.
 * Excludes games without a title.
 * @deprecated Use getNonSnapshotGamesForDashboard for all non-snapshot games.
 */
export function getManualGamesForDashboard(libraryGames: LibraryGame[]): LibraryGame[] {
  return libraryGames.filter((g) => g.source === "manual" && g.title);
}

/**
 * Filter Epic games from libraryGames that should appear in dashboard sections.
 * Excludes games without a title.
 * @deprecated Use getNonSnapshotGamesForDashboard for all non-snapshot games.
 */
export function getEpicGamesForDashboard(libraryGames: LibraryGame[]): LibraryGame[] {
  return libraryGames.filter((g) => g.source === "epic" && g.title);
}

/**
 * Filter all non-snapshot games (manual + Epic + any future provider) from libraryGames.
 * Single source of truth for dashboard sections — replaces separate manual/epic filters.
 */
export function getNonSnapshotGamesForDashboard(libraryGames: LibraryGame[]): LibraryGame[] {
  return libraryGames.filter((g) => (g.source === "manual" || g.source === "epic" || g.source === "debrid") && g.title);
}

/**
 * Resolve image URLs for a batch of DashboardDisplayGames.
 * For snapshot games: uses snapshot media paths via resolveGameMediaUrl.
 * For manual games: uses resolveProviderMediaPreviewUrl on imageUrl/iconUrl.
 *
 * Returns a map of stableId → resolved image URL.
 */
export async function resolveDashboardImageUrls(
  games: DashboardDisplayGame[],
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};

  // Import resolveGameMediaUrl lazily to avoid circular deps
  const { resolveGameMediaUrl } = await import("./gameCacheService");

  for (const game of games) {
    if (game._snapshotGame) {
      // Snapshot game: resolve via media paths
      const m = game._snapshotGame.media;
      const imgPath = m?.landscapePath || m?.coverPath || m?.backgroundPath;
      if (game.appId && imgPath) {
        result[game.stableId] = await resolveGameMediaUrl(game.appId, imgPath);
      } else {
        result[game.stableId] = null;
      }
    } else if (game._libraryGame) {
      // Non-snapshot game: resolve provider media URL from role paths (not just imageUrl)
      const rawPath = getCardImageCandidate(game._libraryGame);
      if (rawPath) {
        result[game.stableId] = await resolveProviderMediaPreviewUrl(rawPath);
      } else {
        result[game.stableId] = null;
      }
    } else {
      result[game.stableId] = null;
    }
  }

  return result;
}

/**
 * Build a stable React key for a dashboard display game.
 */
export function dashboardGameKey(prefix: string, game: DashboardDisplayGame): string {
  return `${prefix}:${game.stableId}`;
}
