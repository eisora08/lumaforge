/**
 * gamePlayStats.ts — Launch/session tracking backed by games_v2.
 *
 * Replaces the localStorage-based implementation with games_v2 commands.
 * Maintains the same API for backward compatibility with existing consumers.
 */
import { useCallback, useState } from "react";
import { incrementPlayCountV2, getGameV2 } from "./tauri";
import type { GameV2 } from "../types/gameV2";

export type GamePlayStats = {
  lastPlayedAt: number;
  launchCount: number;
  playtimeMinutes: number;
};

/** Convert GameV2 to GamePlayStats for backward compat. */
function gameV2ToStats(game: GameV2): GamePlayStats {
  return {
    lastPlayedAt: game.lastPlayedAt ?? Date.now(),
    launchCount: game.playCount,
    playtimeMinutes: Math.round(game.playtimeSeconds / 60),
  };
}

export function getGameStats(_gameId: string): GamePlayStats | null {
  // Synchronous lookup is not possible with async Tauri commands.
  // Return null — consumers should use the async version or hooks.
  return null;
}

/** Async version of getGameStats for consumers that can handle async. */
export async function getGameStatsAsync(gameId: string): Promise<GamePlayStats | null> {
  try {
    const game = await getGameV2(gameId);
    if (!game) return null;
    return gameV2ToStats(game);
  } catch {
    return null;
  }
}

export function recordLaunch(gameId: string): void {
  // Fire-and-forget: increment play count in games_v2
  incrementPlayCountV2(gameId).catch(() => {});
}

export function recordSessionEnd(gameId: string, durationMs: number): void {
  if (durationMs < 30000) return; // Only track sessions longer than 30s
  // Fire-and-forget: add playtime to games_v2
  const deltaSeconds = Math.round(durationMs / 1000);
  // We need to read current playtime first, but since this is fire-and-forget,
  // we'll use addPlaytimeV2 which adds to existing value
  import("./tauri").then(({ addPlaytimeV2 }) => {
    addPlaytimeV2(gameId, deltaSeconds).catch(() => {});
  }).catch(() => {});
}

export function useGamePlayStats(gameId: string) {
  const [stats, setStats] = useState<GamePlayStats | null>(null);

  const doRecordLaunch = useCallback(() => {
    recordLaunch(gameId);
    // Optimistic update
    setStats(prev => ({
      lastPlayedAt: Date.now(),
      launchCount: (prev?.launchCount ?? 0) + 1,
      playtimeMinutes: prev?.playtimeMinutes ?? 0,
    }));
  }, [gameId]);

  const doRecordSessionEnd = useCallback(
    (durationMs: number) => {
      recordSessionEnd(gameId, durationMs);
      // Optimistic update
      const additionalMinutes = Math.round(durationMs / 60000);
      setStats(prev => ({
        lastPlayedAt: Date.now(),
        launchCount: prev?.launchCount ?? 0,
        playtimeMinutes: (prev?.playtimeMinutes ?? 0) + additionalMinutes,
      }));
    },
    [gameId]
  );

  return {
    stats,
    recordLaunch: doRecordLaunch,
    recordSessionEnd: doRecordSessionEnd,
  };
}

// Legacy exports for backward compat — now no-ops since data lives in games_v2
export function loadAll(): Record<string, GamePlayStats> {
  return {};
}
