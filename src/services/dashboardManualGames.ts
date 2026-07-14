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
};

/**
 * Convert a SnapshotGame to DashboardDisplayGame.
 * Resolves playtime from the playtime store (authoritative) with snapshot fallback.
 */
export function snapshotToDisplayGame(
  game: SnapshotGame,
  runningAppIds: Set<string>,
): DashboardDisplayGame {
  const ptKey = game.appId ? `app-${game.appId}` : null;
  const ptEntry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
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
  };
}

/**
 * Convert a manual LibraryGame to DashboardDisplayGame.
 * Resolves playtime from the playtime store.
 */
export function manualToDisplayGame(
  game: LibraryGame,
  runningAppIds: Set<string>,
): DashboardDisplayGame {
  const ptKey = resolvePlaytimeKey(game);
  const ptEntry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
  const totalSeconds = ptEntry?.totalPlaytimeSeconds ?? 0;
  const lastPlayed = ptEntry?.lastPlayedAt ?? null;

  return {
    stableId: game.libraryId || game.id,
    libraryId: game.libraryId,
    source: "manual",
    title: game.title,
    imageUrl: game.imageUrl ?? null,
    iconUrl: game.iconPath ?? null,
    totalPlaytimeSeconds: totalSeconds,
    lastPlayedAt: lastPlayed,
    isRunning: runningAppIds.has(game.id),
    installed: true, // manual games are always "installed"
    playable: game.isPlayable,
    updatedAt: 0,
    _libraryGame: game,
  };
}

/**
 * Filter manual games from libraryGames that should appear in dashboard sections.
 * Excludes games without a title.
 */
export function getManualGamesForDashboard(libraryGames: LibraryGame[]): LibraryGame[] {
  return libraryGames.filter((g) => g.source === "manual" && g.title);
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
      // Manual game: resolve provider media URL
      const rawPath = game._libraryGame.imageUrl;
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
