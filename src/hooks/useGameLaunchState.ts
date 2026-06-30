import { useCallback, useMemo } from "react";
import { useGameSession } from "../context/GameSessionContext";
import type { GameSessionState } from "../context/GameSessionContext";
import type { LibraryGame } from "../types/libraryGame";

export type GameLaunchState = GameSessionState;

export type GameLaunchInfo = {
  state: GameLaunchState;
  pid?: number;
  launchedAt?: number;
  error?: string;
};

export function useGameLaunchState(gameKey: string) {
  const session = useGameSession();

  const currentSession = session.getSession(gameKey);
  const state = session.getState(gameKey);

  const launchInfo: GameLaunchInfo = useMemo(
    () => ({
      state,
      pid: currentSession?.pid,
      launchedAt: currentSession?.launchedAt,
      error: currentSession?.errorMessage,
    }),
    [state, currentSession?.pid, currentSession?.launchedAt, currentSession?.errorMessage]
  );

  const launchGame = useCallback(
    async (game: LibraryGame) => {
      await session.launchGame(game);
    },
    [session]
  );

  const cancelLaunch = useCallback(async () => {
    await session.cancelLaunch(gameKey);
  }, [session, gameKey]);

  const stopGame = useCallback(async () => {
    await session.stopSession(gameKey);
  }, [session, gameKey]);

  const resetToIdle = useCallback(() => {
    session.clearSession(gameKey);
  }, [session, gameKey]);

  const clearError = useCallback(() => {
    if (state === "error") {
      session.clearSession(gameKey);
    }
  }, [session, gameKey, state]);

  return {
    launchInfo,
    launchGame,
    cancelLaunch,
    stopGame,
    resetToIdle,
    clearError,
  };
}
