import { getCachedPlaytimeStore, resolvePlaytimeKey } from "../../../services/playtimeService";
import { getGameStats, loadAll } from "../../../services/gamePlayStats";
import { getAllGameSessions } from "../../../services/tauri";
import type { GameSession } from "../../../services/tauri";
import type { LibraryGame } from "../../../types/libraryGame";
import type { StatsTimeFilter, PlayActivityDay, SessionHistoryEntry } from "../types";
import type React from "react";
import { Diamond, Trophy, Medal, Circle, Award } from "lucide-react";

export type { PlayActivityDay, SessionHistoryEntry } from "../types";

// ─── Session appId normalization ──────────────────────────────────────
// Session records store gameId as "app-{id}" for Steam games.
// resolvePlaytimeKey returns "steam-{id}" / "lua-{id}" for Steam/Lua games.
// We normalize both sides to ensure they match.
function normalizeSessionGameId(gameId: string): string {
  if (/^\d+$/.test(gameId)) return `app-${gameId}`;
  if (gameId.startsWith("steam-")) return `app-${gameId.slice(6)}`;
  if (gameId.startsWith("app-")) return gameId;
  return gameId;
}

/** Check if a session's gameId matches a game's ptKey (handles both formats) */
function sessionMatchesGameKey(sessionGameId: string, ptKey: string, game: LibraryGame): boolean {
  const normId = normalizeSessionGameId(sessionGameId);
  if (normId === ptKey) return true;
  // resolvePlaytimeKey returns "steam-{id}" but sessions store "app-{id}"
  if (game.appId && normId === `app-${game.appId}`) return true;
  return false;
}

/** Build a Set of all session-matching keys for the given games */
function buildSessionMatchKeys(games: LibraryGame[]): Set<string> {
  const keys = new Set<string>();
  for (const g of games) {
    const ptKey = resolvePlaytimeKey(g);
    if (ptKey) keys.add(ptKey);
    // Also add the "app-{appId}" format used by session records
    if (g.appId) keys.add(`app-${g.appId}`);
  }
  return keys;
}

// ─── Aggregate stats ──────────────────────────────────────────────────

export type LibraryStats = {
  totalHours: number;
  totalSessions: number;
  gamesPlayed: number;
  gamesUnplayed: number;
  mostPlayedTitle: string;
  mostPlayedHours: number;
};

export async function computeLibraryStats(games: LibraryGame[]): Promise<LibraryStats> {
  const store = getCachedPlaytimeStore();
  if (!store) {
    return { totalHours: 0, totalSessions: 0, gamesPlayed: 0, gamesUnplayed: games.length, mostPlayedTitle: "", mostPlayedHours: 0 };
  }

  let totalSeconds = 0;
  let totalSessions = 0;
  let gamesPlayed = 0;
  let mostPlayedTitle = "";
  let mostPlayedSeconds = 0;

  const playStats = loadAll();
  const allSessions = await getAllGameSessions();
  // Count sessions using BOTH "app-{id}" (session format) and "steam-{id}" (ptKey format)
  const sessionCountByAppId = new Map<string, number>();
  const sessionCountByPtKey = new Map<string, number>();
  for (const s of allSessions) {
    const normId = normalizeSessionGameId(s.gameId);
    sessionCountByAppId.set(normId, (sessionCountByAppId.get(normId) ?? 0) + 1);
    // Also store under the original gameId for games whose ptKey matches the raw id
    sessionCountByPtKey.set(s.gameId, (sessionCountByPtKey.get(s.gameId) ?? 0) + 1);
  }

  for (const game of games) {
    const ptKey = resolvePlaytimeKey(game);
    if (!ptKey) continue;

    const entry = store.games[ptKey];
    const ls = game.localPlaytimeMinutes ? game.localPlaytimeMinutes * 60 : 0;
    const ext = entry?.externalPlaytimeSeconds ?? 0;
    const total = entry?.totalPlaytimeSeconds ?? (ls + ext);

    // Also count via gamePlayStats (legacy)
    const gpStats = playStats[game.id];
    const gpMinutes = gpStats?.playtimeMinutes ?? 0;
    const gpSeconds = gpMinutes * 60;
    const effectiveTotal = Math.max(total, gpSeconds);

    if (effectiveTotal > 0) {
      gamesPlayed++;
      totalSeconds += effectiveTotal;
      // Only count real session history — launch count is displayed separately via getTotalLaunchCount()
      // Try ptKey directly, then fall back to app-{appId} format (session records use app-{appId})
      const appKey = game.appId ? `app-${game.appId}` : undefined;
      const historyCount = sessionCountByPtKey.get(ptKey) ?? sessionCountByAppId.get(ptKey)
        ?? (appKey ? (sessionCountByPtKey.get(appKey) ?? sessionCountByAppId.get(appKey) ?? 0) : 0);
      totalSessions += historyCount;
      if (effectiveTotal > mostPlayedSeconds) {
        mostPlayedSeconds = effectiveTotal;
        mostPlayedTitle = game.title;
      }
    }
  }

  return {
    totalHours: totalSeconds / 3600,
    totalSessions,
    gamesPlayed,
    gamesUnplayed: games.length - gamesPlayed,
    mostPlayedTitle,
    mostPlayedHours: mostPlayedSeconds / 3600,
  };
}

// ─── Time-filtered playtime ───────────────────────────────────────────

export function getTimeFilterMs(filter: StatsTimeFilter): number {
  const now = Date.now();
  switch (filter) {
    case "today":  return 24 * 60 * 60 * 1000;
    case "week":   return 7 * 24 * 60 * 60 * 1000;
    case "month":  return 30 * 24 * 60 * 60 * 1000;
    case "30days": return 30 * 24 * 60 * 60 * 1000;
    case "year":   return 365 * 24 * 60 * 60 * 1000;
    case "all":    return now;
  }
}

export async function computeFilteredPlaytime(games: LibraryGame[], filter: StatsTimeFilter): Promise<{
  totalSeconds: number;
  gamesPlayed: number;
  sessions: SessionHistoryEntry[];
}> {
  const cutoffSec = Math.floor((Date.now() - getTimeFilterMs(filter)) / 1000);
  let totalSeconds = 0;
  let gamesPlayed = 0;
  const sessions: SessionHistoryEntry[] = [];

  const store = getCachedPlaytimeStore();

  // Use game_sessions table as primary source
  const allSessions = await getAllGameSessions();

  for (const game of games) {
    const ptKey = resolvePlaytimeKey(game);
    if (!ptKey) continue;

    let gameTotal = 0;

    // Real sessions from game_sessions table
    for (const s of allSessions) {
      if (!sessionMatchesGameKey(s.gameId, ptKey, game)) continue;
      if (!s.durationSeconds || s.durationSeconds <= 0) continue;
      const sessionEnd = s.endedAt ?? s.startedAt;
      if (sessionEnd >= cutoffSec) {
        gameTotal += s.durationSeconds;
        sessions.push({
          gameTitle: game.title,
          appId: s.gameId,
          source: s.source as SessionHistoryEntry["source"],
          exitReason: s.exitReason ?? undefined,
          startedAt: s.startedAt * 1000, // convert to ms for display
          endedAt: (s.endedAt ?? s.startedAt) * 1000,
          durationSeconds: s.durationSeconds,
        });
      }
    }

    // Fallback: if no sessions found for this game, use playtime store total
    // (for "all_time" filter or when no launcher sessions exist)
    if (gameTotal === 0 && store) {
      const entry = store.games[ptKey];
      if (entry && entry.totalPlaytimeSeconds > 0) {
        // For "all" filter, use the full total; for time-restricted filters,
        // we can't split imported playtime by date, so only use for "all"
        if (filter === "all") {
          gameTotal = entry.totalPlaytimeSeconds;
        }
      }
    }

    if (gameTotal > 0) {
      gamesPlayed++;
      totalSeconds += gameTotal;
    }
  }

  sessions.sort((a, b) => b.startedAt - a.startedAt);
  return { totalSeconds, gamesPlayed, sessions };
}

// ─── Play activity by day ─────────────────────────────────────────────

export async function computePlayActivityByDay(
  games: LibraryGame[],
  days = 90
): Promise<PlayActivityDay[]> {
  const result: PlayActivityDay[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    result.push({ date: dayStr, seconds: 0, launches: 0 });
  }

  // Use game_sessions table as primary source
  const allSessions = await getAllGameSessions();
  const gameKeys = buildSessionMatchKeys(games);

  for (const s of allSessions) {
    if (!gameKeys.has(normalizeSessionGameId(s.gameId)) && !gameKeys.has(s.gameId)) continue;
    if (!s.durationSeconds || s.durationSeconds <= 0) continue;
    const sessionDate = new Date(s.startedAt * 1000).toISOString().slice(0, 10);
    const bucket = result.find((r) => r.date === sessionDate);
    if (bucket) {
      bucket.seconds += s.durationSeconds;
      bucket.launches++;
    }
  }

  return result;
}

// ─── Streak calculation ───────────────────────────────────────────────

export type StreakInfo = {
  currentStreak: number;
  longestStreak: number;
  streakStarted: number | null;
  totalDaysPlayed: number;
};

export async function computeStreaks(games: LibraryGame[]): Promise<StreakInfo> {
  const activityByDay = await computePlayActivityByDay(games, 365);
  const playDays = new Set(activityByDay.filter((d) => d.seconds > 0).map((d) => d.date));

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  let streakStarted: number | null = null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Current streak — count backward from today
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    if (playDays.has(dayStr)) {
      currentStreak++;
      if (i === 0 || currentStreak === 1) {
        streakStarted = d.getTime();
      }
    } else if (i === 0) {
      // Today hasn't been played yet — that's OK, check yesterday
      continue;
    } else {
      break;
    }
  }

  // Longest streak — linear scan
  const sortedDays = [...playDays].sort();
  tempStreak = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    if (i === 0) {
      tempStreak = 1;
    } else {
      const prev = new Date(sortedDays[i - 1]);
      const curr = new Date(sortedDays[i]);
      const diffMs = curr.getTime() - prev.getTime();
      const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
      if (diffDays === 1) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, tempStreak);
  }

  return { currentStreak, longestStreak, streakStarted, totalDaysPlayed: playDays.size };
}

// ─── Heatmap data ─────────────────────────────────────────────────────

export async function computeHeatmapData(games: LibraryGame[], days = 90): Promise<{ date: string; value: number }[]> {
  const activityByDay = await computePlayActivityByDay(games, days);
  const maxSeconds = Math.max(1, ...activityByDay.map((d) => d.seconds));

  return activityByDay.map((d) => ({
    date: d.date,
    value: d.seconds > 0 ? Math.max(1, Math.ceil((d.seconds / maxSeconds) * 4)) : 0,
  }));
}

// ─── Top games ────────────────────────────────────────────────────────

export type TopGame = {
  title: string;
  appId: string;
  totalSeconds: number;
  sessions: number;
  game?: LibraryGame;
};

export async function computeTopGames(games: LibraryGame[], limit = 10): Promise<TopGame[]> {
  const store = getCachedPlaytimeStore();
  if (!store) return [];

  const topGames: TopGame[] = [];
  const allSessions = await getAllGameSessions();
  const sessionCountByPtKey = new Map<string, number>();
  const sessionCountByAppId = new Map<string, number>();
  for (const s of allSessions) {
    const normId = normalizeSessionGameId(s.gameId);
    sessionCountByAppId.set(normId, (sessionCountByAppId.get(normId) ?? 0) + 1);
    sessionCountByPtKey.set(s.gameId, (sessionCountByPtKey.get(s.gameId) ?? 0) + 1);
  }

  for (const game of games) {
    const ptKey = resolvePlaytimeKey(game);
    if (!ptKey) continue;
    const entry = store.games[ptKey];
    if (!entry || entry.totalPlaytimeSeconds <= 0) continue;

    const appKey = game.appId ? `app-${game.appId}` : undefined;
    const historyCount = sessionCountByPtKey.get(ptKey) ?? sessionCountByAppId.get(ptKey)
      ?? (appKey ? (sessionCountByPtKey.get(appKey) ?? sessionCountByAppId.get(appKey) ?? 0) : 0);

    topGames.push({
      title: entry.title || game.title,
      appId: ptKey,
      totalSeconds: entry.totalPlaytimeSeconds,
      sessions: historyCount,
      game,
    });
  }

  return topGames
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, limit);
}

// ─── Session history ──────────────────────────────────────────────────

export async function computeSessionHistory(games: LibraryGame[], limit = 20): Promise<SessionHistoryEntry[]> {
  const allSessions = await getAllGameSessions();
  const gameKeys = buildSessionMatchKeys(games);

  const result: SessionHistoryEntry[] = [];

  for (const s of allSessions) {
    const normId = normalizeSessionGameId(s.gameId);
    if (!gameKeys.has(normId) && !gameKeys.has(s.gameId)) continue;
    if (!s.durationSeconds || s.durationSeconds <= 0) continue;

    // Find the game title
    const game = games.find(g => {
      const ptKey = resolvePlaytimeKey(g);
      return ptKey && sessionMatchesGameKey(s.gameId, ptKey, g);
    });
    result.push({
      gameTitle: game?.title ?? s.gameId,
      appId: s.gameId,
      source: s.source as SessionHistoryEntry["source"],
      exitReason: s.exitReason ?? undefined,
      startedAt: s.startedAt * 1000, // convert to ms for display
      endedAt: (s.endedAt ?? s.startedAt) * 1000,
      durationSeconds: s.durationSeconds,
    });
  }

  return result
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

// ─── Launch count from gamePlayStats ──────────────────────────────────

export function getLaunchCount(gameId: string): number {
  const stats = getGameStats(gameId);
  return stats?.launchCount ?? 0;
}

export function getTotalLaunchCount(games: LibraryGame[]): number {
  const allStats = loadAll();
  let total = 0;
  for (const game of games) {
    total += allStats[game.id]?.launchCount ?? 0;
  }
  return total;
}

// ─── Mastery tiers ─────────────────────────────────────────────────

export type MasteryTier = "diamond" | "platinum" | "gold" | "silver" | "bronze";

export type MasteryTierInfo = {
  tier: MasteryTier;
  label: string;
  thresholdHours: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  borderColor: string;
  bgColor: string;
};

export const MASTERY_TIERS: MasteryTierInfo[] = [
  { tier: "diamond",  label: "Diamond",  thresholdHours: 50, icon: Diamond,  color: "text-cyan-400",  borderColor: "border-cyan-400/30",  bgColor: "bg-cyan-400/10" },
  { tier: "platinum", label: "Platinum", thresholdHours: 25, icon: Trophy,   color: "text-slate-300", borderColor: "border-slate-300/30", bgColor: "bg-slate-300/10" },
  { tier: "gold",     label: "Gold",     thresholdHours: 10, icon: Medal,    color: "text-amber-400", borderColor: "border-amber-400/30", bgColor: "bg-amber-400/10" },
  { tier: "silver",   label: "Silver",   thresholdHours: 5,  icon: Circle,   color: "text-slate-400", borderColor: "border-slate-400/30", bgColor: "bg-slate-400/10" },
  { tier: "bronze",   label: "Bronze",   thresholdHours: 1,  icon: Award,    color: "text-orange-400", borderColor: "border-orange-400/30", bgColor: "bg-orange-400/10" },
];

export type MasteryTierResult = {
  tier: MasteryTierInfo;
  count: number;
};

export function computeMasteryTiers(games: LibraryGame[]): MasteryTierResult[] {
  const store = getCachedPlaytimeStore();
  const playStats = loadAll();
  const gameHoursMap = new Map<string, number>();

  for (const game of games) {
    const ptKey = resolvePlaytimeKey(game);
    if (!ptKey) continue;
    const entry = store?.games[ptKey];
    const ls = game.localPlaytimeMinutes ? game.localPlaytimeMinutes * 60 : 0;
    const ext = entry?.externalPlaytimeSeconds ?? 0;
    const total = entry?.totalPlaytimeSeconds ?? (ls + ext);
    const gpSeconds = (playStats[game.id]?.playtimeMinutes ?? 0) * 60;
    const effectiveSeconds = Math.max(total, gpSeconds);
    if (effectiveSeconds > 0) {
      gameHoursMap.set(game.id, effectiveSeconds / 3600);
    }
  }

  const hours = [...gameHoursMap.values()];
  return MASTERY_TIERS.map((tier) => ({
    tier,
    count: hours.filter((h) => h >= tier.thresholdHours).length,
  }));
}

// ─── Context builder for achievement engine ───────────────────────────

export type EvaluationContextInput = {
  librarySize: number;
  totalPlaytimeSeconds: number;
  totalSessions: number;
  completedGames: number;
  genreCount: number;
  marathonSessions: number;
  nightOwlSessions: number;
  earlyBirdSessions: number;
  weekendStreak: number;
  gamesPlayed: number;
  currentStreak: number;
  longestStreak: number;
  // Fase 2
  providerCount: number;
  luaGames: number;
  shortSessions: number;
};

export async function buildEvalContext(games: LibraryGame[], folderAchievements?: Map<string, { unlocked: number; total: number }>): Promise<EvaluationContextInput> {
  const store = getCachedPlaytimeStore();
  let totalSeconds = 0;
  let totalSessions = 0;
  let gamesPlayed = 0;
  let marathonSessions = 0;
  let nightOwlSessions = 0;
  let earlyBirdSessions = 0;
  const genresPlayed = new Set<string>();

  // Use game_sessions table as primary source
  const allSessions = await getAllGameSessions();
  const gameKeys = buildSessionMatchKeys(games);

  // Count sessions per game — store under the game's ptKey for direct lookup
  const sessionsByPtKey = new Map<string, GameSession[]>();
  for (const s of allSessions) {
    const normId = normalizeSessionGameId(s.gameId);
    const matchedKey = gameKeys.has(normId) ? normId : gameKeys.has(s.gameId) ? s.gameId : null;
    if (!matchedKey) continue;
    // Find the matching game to get its ptKey
    const matchGame = games.find(g => {
      const pk = resolvePlaytimeKey(g);
      return pk && sessionMatchesGameKey(s.gameId, pk, g);
    });
    if (!matchGame) continue;
    const ptKey = resolvePlaytimeKey(matchGame);
    if (!ptKey) continue;
    const arr = sessionsByPtKey.get(ptKey) ?? [];
    arr.push(s);
    sessionsByPtKey.set(ptKey, arr);
  }

  if (store) {
    for (const game of games) {
      const ptKey = resolvePlaytimeKey(game);
      if (!ptKey) continue;
      const entry = store.games[ptKey];
      if (!entry) continue;

      if (entry.totalPlaytimeSeconds > 0) gamesPlayed++;
      totalSeconds += entry.totalPlaytimeSeconds;

      const historySessions = sessionsByPtKey.get(ptKey);
      if (historySessions && historySessions.length > 0) {
        totalSessions += historySessions.length;
        for (const s of historySessions) {
          const durSec = s.durationSeconds ?? 0;
          if (durSec >= 4 * 3600) marathonSessions++;

          const startHour = new Date(s.startedAt * 1000).getHours();
          if (startHour < 7) earlyBirdSessions++;

          const endHour = new Date((s.endedAt ?? s.startedAt) * 1000).getHours();
          if (endHour >= 0 && endHour < 5) nightOwlSessions++;
        }
      }
    }
  }

  // Collect genres from all games
  for (const game of games) {
    if (game.metadata?.genres) {
      for (const g of game.metadata.genres) genresPlayed.add(g);
    }
  }

  // Weekend streak — check last 8 weeks for weekend play
  const activityByDay = await computePlayActivityByDay(games, 60);
  let weekendStreak = 0;
  for (let week = 0; week < 8; week++) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - (week + 1) * 7);
    const sat = new Date(weekStart);
    sat.setDate(sat.getDate() + 5);
    const sun = new Date(weekStart);
    sun.setDate(sun.getDate() + 6);

    const satStr = sat.toISOString().slice(0, 10);
    const sunStr = sun.toISOString().slice(0, 10);

    const satPlayed = activityByDay.find((d) => d.date === satStr);
    const sunPlayed = activityByDay.find((d) => d.date === sunStr);

    if ((satPlayed && satPlayed.seconds > 0) || (sunPlayed && sunPlayed.seconds > 0)) {
      weekendStreak++;
    } else {
      break;
    }
  }

  // Completed games — folder scan → completionStatus override → snapshot fallback
  let completedGames = 0;
  for (const game of games) {
    if (game.completionStatus === "completed") {
      completedGames++;
    } else if (game.appId && folderAchievements?.has(game.appId)) {
      const fa = folderAchievements.get(game.appId)!;
      if (fa.total > 0 && fa.unlocked >= fa.total) completedGames++;
    } else if (game.appId && game.achievementUnlocked && game.achievementTotal && game.achievementUnlocked > 0) {
      if (game.achievementUnlocked >= game.achievementTotal) {
        completedGames++;
      }
    }
  }

  // Provider count — distinct source values across played games
  const providersSeen = new Set<string>();
  const playedPtKeys = new Set(Object.keys(sessionsByPtKey));
  for (const game of games) {
    const ptKey = resolvePlaytimeKey(game);
    if (ptKey && playedPtKeys.has(ptKey) && game.source) {
      providersSeen.add(game.source);
    }
  }

  // Lua games — games with active Lua scripts
  let luaGames = 0;
  for (const game of games) {
    if (game.hasLua && game.isLuaActive) luaGames++;
  }

  // Short sessions — sessions under 15 minutes
  let shortSessions = 0;
  for (const s of allSessions) {
    const durSec = s.durationSeconds ?? 0;
    if (durSec > 0 && durSec < 15 * 60) shortSessions++;
  }

  const streaks = await computeStreaks(games);

  return {
    librarySize: games.length,
    totalPlaytimeSeconds: totalSeconds,
    totalSessions,
    completedGames,
    genreCount: genresPlayed.size,
    marathonSessions,
    nightOwlSessions,
    earlyBirdSessions,
    weekendStreak,
    gamesPlayed,
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak,
    providerCount: providersSeen.size,
    luaGames,
    shortSessions,
  };
}

// ─── Weekly comparison ─────────────────────────────────────────────

export type WeeklyComparison = {
  thisWeekSeconds: number;
  lastWeekSeconds: number;
  percentChange: number | null;
};

export async function computeWeeklyComparison(games: LibraryGame[]): Promise<WeeklyComparison> {
  const nowSec = Math.floor(Date.now() / 1000);
  const SECS_PER_WEEK = 7 * 24 * 60 * 60;
  const thisWeekStart = nowSec - SECS_PER_WEEK;
  const lastWeekStart = nowSec - 2 * SECS_PER_WEEK;

  const allSessions = await getAllGameSessions();
  const gameKeys = buildSessionMatchKeys(games);

  let thisWeekSeconds = 0;
  let lastWeekSeconds = 0;

  for (const s of allSessions) {
    const normId = normalizeSessionGameId(s.gameId);
    if (!gameKeys.has(normId) && !gameKeys.has(s.gameId)) continue;
    if (!s.durationSeconds || s.durationSeconds <= 0) continue;
    const sessionEnd = s.endedAt ?? s.startedAt;
    if (sessionEnd >= thisWeekStart) {
      thisWeekSeconds += s.durationSeconds;
    } else if (sessionEnd >= lastWeekStart) {
      lastWeekSeconds += s.durationSeconds;
    }
  }

  const percentChange = lastWeekSeconds > 0
    ? ((thisWeekSeconds - lastWeekSeconds) / lastWeekSeconds) * 100
    : thisWeekSeconds > 0 ? 100 : null;

  return { thisWeekSeconds, lastWeekSeconds, percentChange };
}

// ─── Avg session length ───────────────────────────────────────────

export async function computeAvgSessionLength(games: LibraryGame[]): Promise<number | null> {
  const allSessions = await getAllGameSessions();
  const gameKeys = buildSessionMatchKeys(games);

  let totalSeconds = 0;
  let count = 0;

  for (const s of allSessions) {
    const normId = normalizeSessionGameId(s.gameId);
    if (!gameKeys.has(normId) && !gameKeys.has(s.gameId)) continue;
    if (!s.durationSeconds || s.durationSeconds <= 0) continue;
    totalSeconds += s.durationSeconds;
    count++;
  }

  return count > 0 ? totalSeconds / count : null;
}

// ─── Time of day distribution ─────────────────────────────────────

export type TimeOfDayBucket = {
  label: string;
  hours: string;
  seconds: number;
  percent: number;
};

export async function computeTimeOfDay(games: LibraryGame[]): Promise<TimeOfDayBucket[]> {
  const allSessions = await getAllGameSessions();
  const gameKeys = buildSessionMatchKeys(games);

  const buckets = [
    { label: "Morning", hours: "6am–12pm", start: 6, end: 12, seconds: 0 },
    { label: "Afternoon", hours: "12pm–6pm", start: 12, end: 18, seconds: 0 },
    { label: "Evening", hours: "6pm–12am", start: 18, end: 24, seconds: 0 },
    { label: "Night", hours: "12am–6am", start: 0, end: 6, seconds: 0 },
  ];

  let totalSeconds = 0;

  for (const s of allSessions) {
    const normId = normalizeSessionGameId(s.gameId);
    if (!gameKeys.has(normId) && !gameKeys.has(s.gameId)) continue;
    if (!s.durationSeconds || s.durationSeconds <= 0) continue;
    const hour = new Date(s.startedAt * 1000).getHours();
    const durSec = s.durationSeconds;
    totalSeconds += durSec;
    for (const b of buckets) {
      if (b.start <= b.end) {
        if (hour >= b.start && hour < b.end) { b.seconds += durSec; break; }
      }
    }
  }

  return buckets.map(b => ({
    label: b.label,
    hours: b.hours,
    seconds: b.seconds,
    percent: totalSeconds > 0 ? Math.round((b.seconds / totalSeconds) * 100) : 0,
  }));
}
