import { getCachedPlaytimeStore } from "../../../services/playtimeService";
import { getGameStats, loadAll } from "../../../services/gamePlayStats";
import { getAllSessions } from "../../../services/gameSessionHistory";
import type { GameSessionRecord } from "../../../services/gameSessionHistory";
import type { LibraryGame } from "../../../types/libraryGame";
import type { StatsTimeFilter, PlayActivityDay, SessionHistoryEntry } from "../types";
import type React from "react";
import { Diamond, Trophy, Medal, Circle, Award } from "lucide-react";

// ─── Aggregate stats ──────────────────────────────────────────────────

export type LibraryStats = {
  totalHours: number;
  totalSessions: number;
  gamesPlayed: number;
  gamesUnplayed: number;
  mostPlayedTitle: string;
  mostPlayedHours: number;
};

export function computeLibraryStats(games: LibraryGame[]): LibraryStats {
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
  const allSessions = getAllSessions();
  const sessionCountByAppId = new Map<string, number>();
  for (const s of allSessions) {
    sessionCountByAppId.set(s.appId, (sessionCountByAppId.get(s.appId) ?? 0) + 1);
  }

  for (const game of games) {
    const appId = game.appId;
    if (!appId) continue;

    const entry = store.games[`app-${appId}`];
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
      const historyCount = sessionCountByAppId.get(appId) ?? 0;
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
    case "week":   return 7 * 24 * 60 * 60 * 1000;
    case "month":  return 30 * 24 * 60 * 60 * 1000;
    case "30days": return 30 * 24 * 60 * 60 * 1000;
    case "year":   return 365 * 24 * 60 * 60 * 1000;
    case "all":    return now;
  }
}

export function computeFilteredPlaytime(games: LibraryGame[], filter: StatsTimeFilter): {
  totalSeconds: number;
  gamesPlayed: number;
  sessions: SessionHistoryEntry[];
} {
  const cutoff = Date.now() - getTimeFilterMs(filter);
  const store = getCachedPlaytimeStore();
  let totalSeconds = 0;
  let gamesPlayed = 0;
  const sessions: SessionHistoryEntry[] = [];

  // Use session history for session data
  const allSessions = getAllSessions();

  for (const game of games) {
    if (!game.appId) continue;

    let gameTotal = 0;

    // Real sessions from history
    for (const s of allSessions) {
      if (s.appId !== game.appId) continue;
      if (s.endedAt >= cutoff) {
        gameTotal += s.durationMs / 1000;
        sessions.push({
          gameTitle: s.title,
          appId: s.appId,
          source: s.source,
          exitReason: s.exitReason,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          durationSeconds: s.durationMs / 1000,
        });
      }
    }

    // Fallback: playtime store sessions (for LumaForge-launched games without history)
    if (gameTotal === 0 && store) {
      const entry = store.games[`app-${game.appId}`];
      if (entry) {
        for (const s of entry.sessions) {
          const sessionEnd = s.endedAt ?? s.startedAt;
          if (sessionEnd >= cutoff && s.durationSeconds) {
            gameTotal += s.durationSeconds;
            sessions.push({
              gameTitle: entry.title || game.title,
              appId: game.appId,
              startedAt: s.startedAt,
              endedAt: s.endedAt ?? s.startedAt,
              durationSeconds: s.durationSeconds,
            });
          }
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

export function computePlayActivityByDay(
  games: LibraryGame[],
  days = 90
): PlayActivityDay[] {
  const result: PlayActivityDay[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    result.push({ date: dayStr, seconds: 0, launches: 0 });
  }

  // Use session history as primary source
  const allSessions = getAllSessions();
  const gameAppIds = new Set(games.filter(g => g.appId).map(g => g.appId));

  for (const s of allSessions) {
    if (!gameAppIds.has(s.appId)) continue;
    if (s.durationMs <= 0) continue;
    const sessionDate = new Date(s.startedAt).toISOString().slice(0, 10);
    const bucket = result.find((r) => r.date === sessionDate);
    if (bucket) {
      bucket.seconds += s.durationMs / 1000;
      bucket.launches++;
    }
  }

  // Fallback: playtime store sessions (for games without history records)
  if (allSessions.length === 0) {
    const store = getCachedPlaytimeStore();
    if (store) {
      for (const game of games) {
        if (!game.appId) continue;
        const entry = store.games[`app-${game.appId}`];
        if (!entry) continue;

        for (const s of entry.sessions) {
          if (!s.durationSeconds) continue;
          const sessionDate = new Date(s.startedAt).toISOString().slice(0, 10);
          const bucket = result.find((r) => r.date === sessionDate);
          if (bucket) {
            bucket.seconds += s.durationSeconds;
            bucket.launches++;
          }
        }
      }
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

export function computeStreaks(games: LibraryGame[]): StreakInfo {
  const activityByDay = computePlayActivityByDay(games, 365);
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

export function computeHeatmapData(games: LibraryGame[], days = 90): { date: string; value: number }[] {
  const activityByDay = computePlayActivityByDay(games, days);
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
};

export function computeTopGames(games: LibraryGame[], limit = 10): TopGame[] {
  const store = getCachedPlaytimeStore();
  if (!store) return [];

  const topGames: TopGame[] = [];
  const allSessions = getAllSessions();
  const sessionCountByAppId = new Map<string, number>();
  for (const s of allSessions) {
    sessionCountByAppId.set(s.appId, (sessionCountByAppId.get(s.appId) ?? 0) + 1);
  }

  for (const game of games) {
    if (!game.appId) continue;
    const entry = store.games[`app-${game.appId}`];
    if (!entry || entry.totalPlaytimeSeconds <= 0) continue;

    // Prefer session history count; fall back to playtime store
    const historyCount = sessionCountByAppId.get(game.appId) ?? 0;
    const storeCount = entry.sessions.length;
    const effectiveSessions = historyCount > 0 ? historyCount : storeCount;

    topGames.push({
      title: entry.title || game.title,
      appId: game.appId,
      totalSeconds: entry.totalPlaytimeSeconds,
      sessions: effectiveSessions,
    });
  }

  return topGames
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, limit);
}

// ─── Session history ──────────────────────────────────────────────────

export function computeSessionHistory(games: LibraryGame[], limit = 20): SessionHistoryEntry[] {
  const allSessions = getAllSessions();
  const gameAppIds = new Set(games.filter(g => g.appId).map(g => g.appId));

  // Map session history records to SessionHistoryEntry format
  const result: SessionHistoryEntry[] = [];

  for (const s of allSessions) {
    if (!gameAppIds.has(s.appId)) continue;
    if (s.durationMs <= 0) continue;
    result.push({
      gameTitle: s.title,
      appId: s.appId,
      source: s.source,
      exitReason: s.exitReason,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSeconds: s.durationMs / 1000,
    });
  }

  // Fallback: playtime store sessions (for LumaForge-launched games without history)
  if (result.length === 0) {
    const store = getCachedPlaytimeStore();
    if (store) {
      for (const game of games) {
        if (!game.appId) continue;
        const entry = store.games[`app-${game.appId}`];
        if (!entry) continue;

        for (const s of entry.sessions) {
          if (!s.durationSeconds || s.durationSeconds < 10) continue;
          result.push({
            gameTitle: entry.title || game.title,
            appId: game.appId,
            startedAt: s.startedAt,
            endedAt: s.endedAt ?? s.startedAt,
            durationSeconds: s.durationSeconds,
          });
        }
      }
    }
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
    if (!game.appId) continue;
    const entry = store?.games[`app-${game.appId}`];
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
};

export function buildEvalContext(games: LibraryGame[]): EvaluationContextInput {
  const store = getCachedPlaytimeStore();
  let totalSeconds = 0;
  let totalSessions = 0;
  let gamesPlayed = 0;
  let marathonSessions = 0;
  let nightOwlSessions = 0;
  let earlyBirdSessions = 0;
  const genresPlayed = new Set<string>();

  // Use session history as primary source for session data
  const allSessions = getAllSessions();
  const gameAppIds = new Set(games.filter(g => g.appId).map(g => g.appId));

  // Count sessions per game from history
  const sessionsByAppId = new Map<string, GameSessionRecord[]>();
  for (const s of allSessions) {
    if (!gameAppIds.has(s.appId)) continue;
    const arr = sessionsByAppId.get(s.appId) ?? [];
    arr.push(s);
    sessionsByAppId.set(s.appId, arr);
  }

  if (store) {
    for (const game of games) {
      if (!game.appId) continue;
      const entry = store.games[`app-${game.appId}`];
      if (!entry) continue;

      if (entry.totalPlaytimeSeconds > 0) gamesPlayed++;
      totalSeconds += entry.totalPlaytimeSeconds;

      // Prefer session history; fall back to playtime store sessions
      const historySessions = sessionsByAppId.get(game.appId);
      if (historySessions && historySessions.length > 0) {
        totalSessions += historySessions.length;
        for (const s of historySessions) {
          const durSec = s.durationMs / 1000;
          if (durSec >= 4 * 3600) marathonSessions++;

          const startHour = new Date(s.startedAt).getHours();
          if (startHour < 7) earlyBirdSessions++;

          const endHour = new Date(s.endedAt).getHours();
          if (endHour >= 0 && endHour < 5) nightOwlSessions++;
        }
      } else {
        // Fallback to playtime store sessions (for LumaForge-launched games without history)
        totalSessions += entry.sessions.length;
        for (const s of entry.sessions) {
          if (!s.durationSeconds) continue;
          if (s.durationSeconds >= 4 * 3600) marathonSessions++;

          const startHour = new Date(s.startedAt).getHours();
          if (startHour < 7) earlyBirdSessions++;

          const endHour = new Date(s.endedAt ?? s.startedAt).getHours();
          if (endHour >= 0 && endHour < 5) nightOwlSessions++;
        }
      }

      // Collect genres from metadata
      if (game.metadata?.genres) {
        for (const g of game.metadata.genres) genresPlayed.add(g);
      }
    }
  }

  // Weekend streak — check last 8 weeks for weekend play
  const activityByDay = computePlayActivityByDay(games, 60);
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

  // Completed games — games with 100% Steam achievements
  let completedGames = 0;
  for (const game of games) {
    if (game.appId && game.achievementUnlocked && game.achievementTotal && game.achievementUnlocked > 0) {
      if (game.achievementUnlocked >= game.achievementTotal) {
        completedGames++;
      }
    }
  }

  const streaks = computeStreaks(games);

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
  };
}
