import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isProcessRunning, terminateProcess } from "../services/tauri";

export type GameSessionState = "idle" | "launching" | "running" | "stopping" | "error";

export type ActiveGameState = Exclude<GameSessionState, "idle" | "error">;

export type RunningGameSession = {
  gameKey: string;
  gameId?: string;
  appId?: string;
  title?: string;
  source: "steam" | "local";
  state: ActiveGameState;
  pid?: number;
  executablePath?: string;
  launchedAt: number;
  updatedAt: number;
  softSession?: boolean;
  errorMessage?: string;
};

export function computeGameKey(game: {
  id?: string;
  appId?: string;
  executablePath?: string;
}): string {
  if (game.id) return game.id;
  if (game.appId) return `app-${game.appId}`;
  if (game.executablePath) return `path-${game.executablePath}`;
  return `unknown-${Date.now()}`;
}

type GameSessionContextValue = {
  sessions: Record<string, RunningGameSession>;
  getSession: (gameKey: string) => RunningGameSession | undefined;
  getState: (gameKey: string) => GameSessionState;
  startLaunching: (session: Omit<RunningGameSession, "state" | "launchedAt" | "updatedAt">) => void;
  markRunning: (gameKey: string, update: { pid?: number; softSession?: boolean }) => void;
  markStopping: (gameKey: string) => void;
  clearSession: (gameKey: string) => void;
  stopSession: (gameKey: string) => Promise<{ terminated: boolean }>;
};

const STORAGE_KEY = "lumaforge-running-games-v1";
const POLL_INTERVAL_MS = 5000;
const LAUNCHING_TTL_MS = 2 * 60 * 1000;
const STEAM_SOFT_TTL_MS = 6 * 60 * 60 * 1000;

const GameSessionContext = createContext<GameSessionContextValue | null>(null);

function loadSessions(): Record<string, RunningGameSession> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const arr = JSON.parse(raw) as RunningGameSession[];
    const map: Record<string, RunningGameSession> = {};
    for (const s of arr) {
      map[s.gameKey] = s;
    }
    return map;
  } catch {
    return {};
  }
}

function persistSessions(sessions: Record<string, RunningGameSession>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.values(sessions)));
  } catch {
    /* storage full */
  }
}

export function GameSessionProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<Record<string, RunningGameSession>>(() => {
    const loaded = loadSessions();
    return loaded;
  });

  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Hydrate: clean stale entries on mount
  useEffect(() => {
    const raw = loadSessions();
    const cleaned: Record<string, RunningGameSession> = {};
    let changed = false;

    for (const [key, s] of Object.entries(raw)) {
      if (s.state === "launching") {
        const age = Date.now() - s.updatedAt;
        if (age < LAUNCHING_TTL_MS) {
          cleaned[key] = s;
        } else {
          console.debug("[GameSession] hydrate: stale launching cleared", { gameKey: key, age });
          changed = true;
        }
      } else if (s.state === "running") {
        if (s.pid != null) {
          // Will be confirmed by PID polling; keep for now
          cleaned[key] = s;
        } else if (s.source === "steam") {
          const age = Date.now() - s.updatedAt;
          if (age < STEAM_SOFT_TTL_MS) {
            console.debug("[GameSession] hydrate: soft session kept", { gameKey: key, age });
            cleaned[key] = { ...s, softSession: true };
          } else {
            console.debug("[GameSession] hydrate: soft session expired", { gameKey: key, age });
            changed = true;
          }
        } else {
          // Local without PID – keep with soft flag
          cleaned[key] = { ...s, softSession: true };
        }
      } else if (s.state === "stopping" || s.state === "error") {
        // Don't restore intermediate states
        changed = true;
      }
    }

    if (changed || Object.keys(cleaned).length !== Object.keys(raw).length) {
      console.debug("[GameSession] hydrate: cleaned sessions", { before: Object.keys(raw).length, after: Object.keys(cleaned).length });
      setSessions(cleaned);
      persistSessions(cleaned);
    }
  }, []);

  // PID polling
  useEffect(() => {
    const interval = setInterval(async () => {
      const current = sessionsRef.current;
      let changed = false;
      const next: Record<string, RunningGameSession> = {};

      for (const [key, s] of Object.entries(current)) {
        if (s.state === "running" && s.pid != null) {
          try {
            const running = await isProcessRunning(s.pid);
            console.debug("[GameSession] pid check", { gameKey: key, pid: s.pid, running });
            if (!running) {
              console.debug("[GameSession] process exited, clearing", { gameKey: key });
              changed = true;
              continue;
            }
          } catch {
            // keep session on poll error
          }
        }
        next[key] = s;
      }

      if (changed) {
        setSessions(next);
        persistSessions(next);
      } else if (Object.keys(next).length > 0) {
        // Still persist to keep updatedAt fresh
        persistSessions(next);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // Auto-persist on every change
  useEffect(() => {
    persistSessions(sessions);
  }, [sessions]);

  const getSession = useCallback(
    (gameKey: string) => sessions[gameKey],
    [sessions]
  );

  const getState = useCallback(
    (gameKey: string): GameSessionState => {
      const s = sessions[gameKey];
      if (!s) return "idle";
      return s.state;
    },
    [sessions]
  );

  const startLaunching = useCallback(
    (input: Omit<RunningGameSession, "state" | "launchedAt" | "updatedAt">) => {
      console.debug("[GameSession] startLaunching", { gameKey: input.gameKey, source: input.source });
      const now = Date.now();
      setSessions((prev) => ({
        ...prev,
        [input.gameKey]: {
          ...input,
          state: "launching",
          launchedAt: now,
          updatedAt: now,
        },
      }));
    },
    []
  );

  const markRunning = useCallback(
    (gameKey: string, update: { pid?: number; softSession?: boolean }) => {
      console.debug("[GameSession] markRunning", { gameKey, ...update });
      setSessions((prev) => {
        const existing = prev[gameKey];
        if (!existing) return prev;
        return {
          ...prev,
          [gameKey]: {
            ...existing,
            state: "running",
            pid: update.pid ?? existing.pid,
            softSession: update.softSession ?? existing.softSession,
            updatedAt: Date.now(),
          },
        };
      });
    },
    []
  );

  const markStopping = useCallback((gameKey: string) => {
    console.debug("[GameSession] markStopping", { gameKey });
    setSessions((prev) => {
      const existing = prev[gameKey];
      if (!existing) return prev;
      return {
        ...prev,
        [gameKey]: { ...existing, state: "stopping", updatedAt: Date.now() },
      };
    });
  }, []);

  const clearSession = useCallback((gameKey: string) => {
    console.debug("[GameSession] clear", { gameKey });
    setSessions((prev) => {
      const next = { ...prev };
      delete next[gameKey];
      return next;
    });
  }, []);

  const stopSession = useCallback(
    async (gameKey: string): Promise<{ terminated: boolean }> => {
      const session = sessionsRef.current[gameKey];
      if (!session) return { terminated: false };

      console.debug("[GameSession] stopSession", { gameKey, pid: session.pid });

      // Set stopping state
      setSessions((prev) => {
        if (!prev[gameKey]) return prev;
        return {
          ...prev,
          [gameKey]: { ...prev[gameKey], state: "stopping", updatedAt: Date.now() },
        };
      });

      if (session.pid != null) {
        try {
          await terminateProcess(session.pid);
          console.debug("[GameSession] process terminated", { gameKey, pid: session.pid });
        } catch (err) {
          console.warn("[GameSession] terminate failed", { gameKey, pid: session.pid, err });
        }
      }

      // Clear session
      setSessions((prev) => {
        const next = { ...prev };
        delete next[gameKey];
        return next;
      });

      return { terminated: !!session.pid };
    },
    []
  );

  const value = useMemo(
    () => ({
      sessions,
      getSession,
      getState,
      startLaunching,
      markRunning,
      markStopping,
      clearSession,
      stopSession,
    }),
    [sessions, getSession, getState, startLaunching, markRunning, markStopping, clearSession, stopSession]
  );

  return (
    <GameSessionContext.Provider value={value}>
      {children}
    </GameSessionContext.Provider>
  );
}

export function useGameSession(): GameSessionContextValue {
  const ctx = useContext(GameSessionContext);
  if (!ctx) {
    throw new Error("useGameSession must be used within GameSessionProvider");
  }
  return ctx;
}
