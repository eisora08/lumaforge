import { useCallback, useEffect, useRef, useState } from "react";
import { launchSteamApp, launchExecutable, terminateProcess, isProcessRunning } from "../services/tauri";
import type { LibraryGame } from "../types/libraryGame";

export type GameLaunchState = "idle" | "launching" | "running" | "stopping" | "error";

export type GameLaunchInfo = {
  state: GameLaunchState;
  pid?: number;
  launchedAt?: number;
  error?: string;
};

const POLL_INTERVAL_MS = 5000;

export function useGameLaunchState(_gameId: string) {
  const [launchInfo, setLaunchInfo] = useState<GameLaunchInfo>({ state: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const gameRef = useRef<LibraryGame | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // Poll process lifecycle while running with PID
  useEffect(() => {
    if (launchInfo.state === "running" && launchInfo.pid != null) {
      if (pollRef.current !== null) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const running = await isProcessRunning(launchInfo.pid!);
          if (!running && !cancelledRef.current) {
            setLaunchInfo({ state: "idle" });
          }
        } catch {
          // Silently ignore poll errors
        }
      }, POLL_INTERVAL_MS);
    } else {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [launchInfo.state, launchInfo.pid]);

  const launchGame = useCallback(async (game: LibraryGame) => {
    gameRef.current = game;
    if (cancelledRef.current) return;
    setLaunchInfo({ state: "launching", launchedAt: Date.now() });

    try {
      if (game.source === "steam" && game.appId) {
        await launchSteamApp(Number(game.appId));
        // Steam games: soft running state (no PID tracking)
        if (!cancelledRef.current) {
          setLaunchInfo({ state: "running", launchedAt: Date.now() });
        }
      } else if (game.source === "local" && game.executablePath) {
        const result = await launchExecutable(game.executablePath);
        if (!cancelledRef.current) {
          setLaunchInfo({
            state: "running",
            pid: result.pid,
            launchedAt: Date.now(),
          });
        }
      } else {
        setLaunchInfo({ state: "error", error: "Cannot launch this game" });
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setLaunchInfo({ state: "error", error: String(err) });
        // Reset to idle after a short delay
        setTimeout(() => {
          if (!cancelledRef.current) {
            setLaunchInfo({ state: "idle" });
          }
        }, 2000);
      }
    }
  }, []);

  const cancelLaunch = useCallback(async () => {
    const current = launchInfo;
    if (current.state !== "launching") return;

    // If we have a PID (local EXE), terminate it
    if (current.pid != null) {
      try {
        await terminateProcess(current.pid);
      } catch {
        // Ignore termination errors during cancel
      }
    }
    cancelledRef.current = false;
    setLaunchInfo({ state: "idle" });
  }, [launchInfo]);

  const stopGame = useCallback(async () => {
    const current = launchInfo;
    if (current.state !== "running") return;

    setLaunchInfo({ ...current, state: "stopping" });

    if (current.pid != null) {
      try {
        await terminateProcess(current.pid);
        setLaunchInfo({ state: "idle" });
      } catch (err) {
        setLaunchInfo({ state: "running", pid: current.pid, error: String(err) });
      }
    } else {
      // Steam game with no PID — can't safely kill
      setLaunchInfo({ state: "running", error: "Cannot close Steam game safely" });
    }
  }, [launchInfo]);

  const resetToIdle = useCallback(() => {
    setLaunchInfo({ state: "idle" });
  }, []);

  const clearError = useCallback(() => {
    if (launchInfo.state === "error") {
      setLaunchInfo({ state: "idle" });
    }
  }, [launchInfo.state]);

  return {
    launchInfo,
    launchGame,
    cancelLaunch,
    stopGame,
    resetToIdle,
    clearError,
  };
}
