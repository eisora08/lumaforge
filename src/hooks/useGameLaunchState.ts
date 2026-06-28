import { useCallback, useEffect, useMemo, useRef } from "react";
import { launchSteamApp, launchExecutable, terminateProcess } from "../services/tauri";
import { useGameSession, computeGameKey } from "../context/GameSessionContext";
import type { LibraryGame } from "../types/libraryGame";
import type { GameSessionState } from "../context/GameSessionContext";

export type GameLaunchState = GameSessionState;

export type GameLaunchInfo = {
  state: GameLaunchState;
  pid?: number;
  launchedAt?: number;
  error?: string;
};

export function useGameLaunchState(gameKey: string) {
  const session = useGameSession();
  const cancelledRef = useRef(false);
  const launchTokenRef = useRef<symbol | null>(null);
  const launchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      launchTokenRef.current = null;
      if (launchTimeoutRef.current !== null) {
        clearTimeout(launchTimeoutRef.current);
        launchTimeoutRef.current = null;
      }
    };
  }, [gameKey]);

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
      cancelledRef.current = false;
      const token = Symbol("launch");
      launchTokenRef.current = token;

      const computedKey = computeGameKey(game);

      console.debug("[Launch] clicked", {
        gameKey: computedKey,
        title: game.title,
        appId: game.appId,
        state: session.getState(computedKey),
      });

      session.startLaunching({
        gameKey: computedKey,
        gameId: game.id,
        appId: game.appId,
        title: game.title,
        source: game.source === "steam" ? "steam" : "local",
        executablePath: game.executablePath,
      });

      try {
        if (game.source === "steam" && game.appId) {
          await launchSteamApp(Number(game.appId));
          launchTimeoutRef.current = setTimeout(() => {
            launchTimeoutRef.current = null;
            if (launchTokenRef.current !== token || cancelledRef.current) {
              console.debug("[Launch] cancelled during steam delay, clearing");
              session.clearSession(computedKey);
              return;
            }
            console.debug("[Launch] marking running (steam)");
            session.markRunning(computedKey, { softSession: true });
          }, 2000);
        } else if (game.source === "local" && game.executablePath) {
          const result = await launchExecutable(game.executablePath);
          if (launchTokenRef.current !== token || cancelledRef.current) {
            console.debug("[Launch] cancelled during local launch, clearing");
            session.clearSession(computedKey);
            return;
          }
          session.markRunning(computedKey, { pid: result.pid });
        } else {
          if (launchTokenRef.current === token) {
            console.warn("[Launch] cannot determine launch method", game.id);
            session.clearSession(computedKey);
          }
        }
      } catch (err) {
        console.warn("[Launch] failed", err);
        if (launchTokenRef.current === token && !cancelledRef.current) {
          session.clearSession(computedKey);
        }
      }
    },
    [session]
  );

  const cancelLaunch = useCallback(async () => {
    const currentState = session.getState(gameKey);
    if (currentState !== "launching") return;

    const currentSession = session.getSession(gameKey);

    console.debug("[Launch] cancel clicked", {
      gameKey,
      state: currentState,
      pid: currentSession?.pid,
    });

    cancelledRef.current = true;
    launchTokenRef.current = null;

    if (launchTimeoutRef.current !== null) {
      clearTimeout(launchTimeoutRef.current);
      launchTimeoutRef.current = null;
    }

    if (currentSession?.pid != null) {
      try {
        await terminateProcess(currentSession.pid);
      } catch {
        // Ignore termination errors during cancel
      }
    }

    session.clearSession(gameKey);
  }, [session, gameKey]);

  const stopGame = useCallback(async () => {
    await session.stopSession(gameKey);
  }, [session, gameKey]);

  const resetToIdle = useCallback(() => {
    cancelledRef.current = false;
    launchTokenRef.current = null;
    if (launchTimeoutRef.current !== null) {
      clearTimeout(launchTimeoutRef.current);
      launchTimeoutRef.current = null;
    }
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
