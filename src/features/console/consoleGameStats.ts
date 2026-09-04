import type { LibraryGame } from "../../types/libraryGame";
import { getPlaytimeEntryByAppId, getPlaytimeEntryByGameKey, resolvePlaytimeKey } from "../../services/playtimeService";
import { achievementStore } from "../../services/achievementStore";
import type { FolderAchievementSummary } from "../../services/tauri";

// Module-level cache for folder achievement data (populated by useConsoleAchievements or on demand)
let _folderCache: FolderAchievementSummary[] | null = null;
let _folderCachePromise: Promise<FolderAchievementSummary[]> | null = null;

export function setFolderAchievementCache(rows: FolderAchievementSummary[]): void {
  _folderCache = rows;
}

export async function ensureFolderAchievementCache(): Promise<FolderAchievementSummary[]> {
  if (_folderCache) return _folderCache;
  if (_folderCachePromise) return _folderCachePromise;
  _folderCachePromise = (async () => {
    try {
      const { scanAchievementFolders } = await import("../../services/tauri");
      const rows = await scanAchievementFolders();
      _folderCache = rows;
      return rows;
    } catch {
      _folderCache = [];
      return [];
    }
  })();
  return _folderCachePromise;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  return days <= 7 ? `${days}d ago` : new Date(ts * 1000).toLocaleDateString();
}

export function formatPlaytime(seconds: number): string | null {
  if (seconds < 60) return null;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function getGameDiskSize(game: LibraryGame): string {
  return formatBytes(game.sizeOnDisk);
}

export function getGameLastPlayedTimestamp(game: LibraryGame): number | null {
  // Source-specific key FIRST for manual/debrid (libraryId), not appId
  // (matches desktop GameHero's manualPlaytime map priority)
  const byKey = getPlaytimeEntryByGameKey(resolvePlaytimeKey(game))?.lastPlayedAt;
  if (byKey) return byKey;
  // Then canonical app-{appId} for Steam/Lua
  const byAppId = game.appId ? getPlaytimeEntryByAppId(game.appId)?.lastPlayedAt : null;
  if (byAppId) return byAppId;
  // Fallback to snapshot/game fields
  const ts = game.localLastPlayedAt ?? game.steamLastPlayedAt;
  return ts ?? null;
}

export function getGameAchievementSummary(game: LibraryGame): {
  unlocked: number;
  total: number;
  percent: number;
} | null {
  let unlocked = game.achievementUnlocked;
  let total = game.achievementTotal;

  const needsFallback = (typeof unlocked !== "number" || typeof total !== "number" || total <= 0);

  if (needsFallback) {
    // For Epic games: extract appName from providerGameId ("ns:catalogId:appName" → "appName")
    let epicAppName: string | null = null;
    if (game.source === "epic" && game.providerGameId) {
      const parts = game.providerGameId.split(":");
      epicAppName = parts[parts.length - 1] || null;
    }

    // Try bare keys first: appId, epicAppName, libraryId, id
    const bareKeys = [game.appId, epicAppName, game.libraryId, game.id].filter((k): k is string => !!k);
    const KNOWN_PLATFORMS = ["epic-official", "steam-official", "steam"];

    let storeSummary = undefined;
    for (const k of bareKeys) {
      storeSummary = achievementStore.getSummary(k);
      if (storeSummary && storeSummary.total > 0) break;
      storeSummary = undefined;
    }
    // Try composite keys (appId:platform)
    if (!storeSummary) {
      for (const k of bareKeys) {
        for (const platform of KNOWN_PLATFORMS) {
          storeSummary = achievementStore.getSummary(k, platform);
          if (storeSummary && storeSummary.total > 0) break;
          storeSummary = undefined;
        }
        if (storeSummary) break;
      }
    }
    if (storeSummary) {
      unlocked = storeSummary.unlocked ?? 0;
      total = storeSummary.total;
    }

    // Fallback: try folder achievement cache (reads from disk — Epic schema path)
    if ((!total || total <= 0) && _folderCache) {
      const matchRow = _folderCache.find((r) => bareKeys.includes(r.appId) && r.total > 0);
      if (matchRow) {
        unlocked = matchRow.unlocked;
        total = matchRow.total;
      }
    }
  }

  if (typeof unlocked !== "number" || typeof total !== "number" || total <= 0) return null;
  return {
    unlocked,
    total,
    percent: Math.round((unlocked / total) * 100),
  };
}

export function getGameCompletionStatus(game: LibraryGame, playtimeSeconds: number): string | null {
  if (playtimeSeconds === 0) return "Not Played";
  // Use getGameAchievementSummary which has achievementStore fallback
  const summary = getGameAchievementSummary(game);
  if (summary) {
    if (summary.unlocked >= summary.total) return "Completed";
    return "In Progress";
  }
  return "Played";
}

export type EffectiveCompletionStatus = "completed" | "in-progress" | "not-played" | "played";

/**
 * Get the effective completion status for a game.
 * Checks for a user-set override first (from GameEditDialog dropdown),
 * then falls back to auto-computation from playtime + achievements.
 */
export function getEffectiveCompletionStatus(
  game: LibraryGame,
  userOverride?: string,
): EffectiveCompletionStatus | null {
  // User-set manual overrides take priority
  if (userOverride === "completed") return "completed";
  if (userOverride === "in-progress") return "in-progress";
  if (userOverride === "not-played") return "not-played";

  // Auto-compute from playtime + achievements
  // Dual-tier: try appId first, then fall back to source-specific gameKey
  let ptEntry = game.appId ? getPlaytimeEntryByAppId(game.appId) : null;
  if (!ptEntry) {
    ptEntry = getPlaytimeEntryByGameKey(resolvePlaytimeKey(game));
  }
  const seconds = ptEntry?.totalPlaytimeSeconds ?? 0;
  const raw = getGameCompletionStatus(game, seconds);
  if (raw === "Completed") return "completed";
  if (raw === "In Progress") return "in-progress";
  if (raw === "Not Played") return "not-played";
  if (raw === "Played") return "played";
  return null;
}
