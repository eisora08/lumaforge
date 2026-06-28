import { useCallback, useState } from "react";

const STORAGE_KEY = "lumaforge-game-play-stats-v1";

export type GamePlayStats = {
  lastPlayedAt: number;
  launchCount: number;
  playtimeMinutes: number;
};

function loadAll(): Record<string, GamePlayStats> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, GamePlayStats>) : {};
  } catch {
    return {};
  }
}

function saveAll(stats: Record<string, GamePlayStats>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    /* storage full */
  }
}

export function getGameStats(gameId: string): GamePlayStats | null {
  const all = loadAll();
  return all[gameId] ?? null;
}

export function recordLaunch(gameId: string): void {
  const all = loadAll();
  const prev = all[gameId];
  all[gameId] = {
    lastPlayedAt: Date.now(),
    launchCount: (prev?.launchCount ?? 0) + 1,
    playtimeMinutes: prev?.playtimeMinutes ?? 0,
  };
  saveAll(all);
}

export function useGamePlayStats(gameId: string) {
  const [stats, setStats] = useState<GamePlayStats | null>(() =>
    getGameStats(gameId)
  );

  const doRecordLaunch = useCallback(() => {
    recordLaunch(gameId);
    setStats(getGameStats(gameId));
  }, [gameId]);

  return { stats, recordLaunch: doRecordLaunch };
}
