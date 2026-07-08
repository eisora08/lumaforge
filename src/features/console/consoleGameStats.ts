import type { LibraryGame } from "../../types/libraryGame";

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
