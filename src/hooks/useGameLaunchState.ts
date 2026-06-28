import { useCallback, useEffect, useMemo, useRef } from "react";
import { launchSteamApp, launchExecutable, terminateProcess, listProcesses } from "../services/tauri";
import { useGameSession, computeGameKey } from "../context/GameSessionContext";
import { findCandidates, pickBestCandidate } from "../utils/gameProcessDetection";
import type { LibraryGame } from "../types/libraryGame";
import type { GameSessionState } from "../context/GameSessionContext";
import type { ProcessInfo } from "../services/tauri";

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
  const scanTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const guardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchDispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchDispatchedRef = useRef(false);
  const snapshotBeforeRef = useRef<ProcessInfo[]>([]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      launchTokenRef.current = null;
      if (launchTimeoutRef.current !== null) {
        clearTimeout(launchTimeoutRef.current);
        launchTimeoutRef.current = null;
      }
      if (launchDispatchTimerRef.current !== null) {
        clearTimeout(launchDispatchTimerRef.current);
        launchDispatchTimerRef.current = null;
      }
      if (guardTimeoutRef.current !== null) {
        clearTimeout(guardTimeoutRef.current);
        guardTimeoutRef.current = null;
      }
      for (const t of scanTimeoutsRef.current) {
        clearTimeout(t);
      }
      scanTimeoutsRef.current = [];
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

  async function scanForProcess(computedKey: string, game: LibraryGame, token: symbol, delayMs: number) {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(async () => {
        if (cancelledRef.current || launchTokenRef.current !== token) {
          resolve();
          return;
        }
        try {
          const processes = await listProcesses();
          console.debug("[ProcessTracking] scan after launch", { gameKey: computedKey, count: processes.length, delayMs });
          const candidates = findCandidates(processes, game, snapshotBeforeRef.current);
          const best = pickBestCandidate(candidates);
          if (best) {
            console.debug("[ProcessTracking] found candidate, marking running with PID", {
              gameKey: computedKey, pid: best.pid, confidence: best.confidence, reason: best.reason,
            });
            session.markRunning(computedKey, {
              pid: best.pid,
              softSession: false,
              trackingConfidence: best.confidence,
              processName: best.name,
            });
            resolve();
            return;
          }
          console.debug("[ProcessTracking] no candidate found", { gameKey: computedKey, delayMs });
        } catch (err) {
          console.warn("[ProcessTracking] scan error", err);
        }
        resolve();
      }, delayMs);
      scanTimeoutsRef.current.push(timeout);
    });
  }

  const launchGame = useCallback(
    async (game: LibraryGame) => {
      cancelledRef.current = false;
      launchDispatchedRef.current = false;
      const token = Symbol("launch");
      launchTokenRef.current = token;

      const computedKey = computeGameKey(game);

      console.debug("[Launch] clicked", {
        gameKey: computedKey,
        title: game.title,
        appId: game.appId,
        source: game.source,
        state: session.getState(computedKey),
      });

      try {
        const before = await listProcesses();
        snapshotBeforeRef.current = before;
        console.debug("[ProcessTracking] snapshot before count", before.length);
      } catch {
        snapshotBeforeRef.current = [];
      }

      session.startLaunching({
        gameKey: computedKey,
        gameId: game.id,
        appId: game.appId,
        title: game.title,
        source: game.source === "steam" ? "steam" : game.source === "local" ? "local" : "unknown",
        executablePath: game.executablePath,
        installDir: game.installDir,
      });

      // 15-second timeout guard — prevents infinite launching state
      guardTimeoutRef.current = setTimeout(() => {
        guardTimeoutRef.current = null;
        if (launchTokenRef.current === token && !cancelledRef.current && session.getState(computedKey) === "launching") {
          console.warn("[Launch] 15s guard timeout — forcing soft session fallback", { gameKey: computedKey });
          session.markRunning(computedKey, { softSession: true, trackingConfidence: "none" });
        }
      }, 15000);

      // *** DELAYED DISPATCH ***
      // A timer delay before actually dispatching the launch so Cancel can abort
      const dispatchDelayMs = game.source === "steam" ? 1500 : 800;

      console.debug("[Launch] dispatch timer started", { gameKey: computedKey, delayMs: dispatchDelayMs });

      launchDispatchTimerRef.current = setTimeout(async () => {
        launchDispatchTimerRef.current = null;

        if (cancelledRef.current || launchTokenRef.current !== token) {
          console.debug("[Launch] dispatch cancelled before send", { gameKey: computedKey });
          return;
        }

        launchDispatchedRef.current = true;
        console.debug("[Launch] dispatch sent", { gameKey: computedKey });

        try {
          if (game.source === "steam" && game.appId) {
            await launchSteamApp(Number(game.appId));

            if (cancelledRef.current || launchTokenRef.current !== token) {
              console.debug("[Launch] cancelled after steam dispatch");
              return;
            }

            const scanDelay = 2000;
            launchTimeoutRef.current = setTimeout(async () => {
              launchTimeoutRef.current = null;
              if (launchTokenRef.current !== token || cancelledRef.current) {
                console.debug("[Launch] cancelled during steam scan delay, clearing");
                session.clearSession(computedKey);
                return;
              }

              await scanForProcess(computedKey, game, token, 0);
              if (session.getState(computedKey) !== "running") {
                await scanForProcess(computedKey, game, token, 3000);
              }
              if (session.getState(computedKey) !== "running") {
                await scanForProcess(computedKey, game, token, 5000);
              }

              if (launchTokenRef.current === token && !cancelledRef.current && session.getState(computedKey) === "launching") {
                console.debug("[Launch] no process detected, marking soft session (steam)");
                session.markRunning(computedKey, { softSession: true, trackingConfidence: "none" });
              }
            }, scanDelay);
          } else if (game.source === "local" && game.executablePath) {
            const result = await launchExecutable(game.executablePath);

            if (cancelledRef.current || launchTokenRef.current !== token) {
              console.debug("[Launch] cancelled after local dispatch, terminating if spawned");
              if (result.pid) {
                try {
                  await terminateProcess(result.pid);
                } catch {
                  // ignore termination error during cancel cleanup
                }
              }
              return;
            }

            if (result.pid) {
              session.markRunning(computedKey, {
                pid: result.pid,
                softSession: false,
                trackingConfidence: "high",
                processName: game.executablePath.split(/[/\\]/).pop(),
              });
            } else {
              await scanForProcess(computedKey, game, token, 0);
              if (launchTokenRef.current === token && !cancelledRef.current && session.getState(computedKey) === "launching") {
                session.markRunning(computedKey, { softSession: true, trackingConfidence: "none" });
              }
            }
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
      }, dispatchDelayMs);
    },
    [session]
  );

  const cancelLaunch = useCallback(async () => {
    const currentState = session.getState(gameKey);
    console.debug("[LaunchButton] cancel clicked", { gameKey, state: currentState, dispatched: launchDispatchedRef.current });

    if (currentState !== "launching") return;

    // If the dispatch has already been sent, we can't cancel — transition to soft running
    if (launchDispatchedRef.current) {
      console.debug("[Launch] dispatch already sent, cannot cancel — marking soft running", { gameKey });
      session.markRunning(gameKey, { softSession: true, trackingConfidence: "none" });
      return;
    }

    const currentSession = session.getSession(gameKey);

    cancelledRef.current = true;
    launchTokenRef.current = null;

    // Clear dispatch timer so the launch never fires
    if (launchDispatchTimerRef.current !== null) {
      clearTimeout(launchDispatchTimerRef.current);
      launchDispatchTimerRef.current = null;
    }

    // Clear scan timers
    for (const t of scanTimeoutsRef.current) {
      clearTimeout(t);
    }
    scanTimeoutsRef.current = [];

    if (launchTimeoutRef.current !== null) {
      clearTimeout(launchTimeoutRef.current);
      launchTimeoutRef.current = null;
    }

    if (guardTimeoutRef.current !== null) {
      clearTimeout(guardTimeoutRef.current);
      guardTimeoutRef.current = null;
    }

    // If local launch already spawned a process somehow, terminate it
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
    launchDispatchedRef.current = false;

    if (launchDispatchTimerRef.current !== null) {
      clearTimeout(launchDispatchTimerRef.current);
      launchDispatchTimerRef.current = null;
    }

    for (const t of scanTimeoutsRef.current) {
      clearTimeout(t);
    }
    scanTimeoutsRef.current = [];

    if (launchTimeoutRef.current !== null) {
      clearTimeout(launchTimeoutRef.current);
      launchTimeoutRef.current = null;
    }

    if (guardTimeoutRef.current !== null) {
      clearTimeout(guardTimeoutRef.current);
      guardTimeoutRef.current = null;
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
