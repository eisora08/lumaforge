import type { LibraryGame } from "../../types/libraryGame";
import { getPlaytimeEntryByAppId, getPlaytimeEntryByGameKey, resolvePlaytimeKey } from "../../services/playtimeService";

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
  // Check playtime store first (works for manual + Steam)
  const byAppId = game.appId ? getPlaytimeEntryByAppId(game.appId)?.lastPlayedAt : null;
  if (byAppId) return byAppId;
  const byKey = getPlaytimeEntryByGameKey(resolvePlaytimeKey(game))?.lastPlayedAt;
  if (byKey) return byKey;
  // Fallback to game fields
  const ts = game.localLastPlayedAt ?? game.steamLastPlayedAt;
  return ts ?? null;
}

export function getGameAchievementSummary(game: LibraryGame): {
  unlocked: number;
  total: number;
  percent: number;
} | null {
  const unlocked = game.achievementUnlocked;
  const total = game.achievementTotal;
  if (typeof unlocked !== "number" || typeof total !== "number" || total <= 0) return null;
  return {
    unlocked,
    total,
    percent: Math.round((unlocked / total) * 100),
  };
}

export function getGameCompletionStatus(game: LibraryGame, playtimeSeconds: number): string | null {
  if (playtimeSeconds === 0) return "Not Played";
  const unlocked = game.achievementUnlocked;
  const total = game.achievementTotal;
  if (typeof unlocked === "number" && typeof total === "number" && total > 0) {
    if (unlocked >= total) return "Completed";
    return "In Progress";
  }
  return "Played";
}
