import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isProcessRunning, terminateProcess, terminateProcessTree } from "../services/tauri";
import { findGameProcess } from "../utils/gameProcessDetection";
import type { ProcessCandidate, FindProcessInput } from "../utils/gameProcessDetection";

export type GameSessionState = "idle" | "launching" | "running" | "stopping" | "error";

export type ActiveGameState = Exclude<GameSessionState, "idle" | "error">;

export type TrackingConfidence = "high" | "medium" | "low" | "none";

export type GameSessionSource = "steam" | "epic" | "local" | "unknown";

export type RunningGameSession = {
  gameKey: string;
  gameId?: string;
  appId?: string;
  title?: string;
  source: GameSessionSource;
  state: ActiveGameState;
  pid?: number;
  processName?: string;
  executablePath?: string;
  installDir?: string;
  launchedAt: number;
  updatedAt: number;
  softSession?: boolean;
  trackingConfidence?: TrackingConfidence;
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
  markRunning: (gameKey: string, update: {
    pid?: number;
    softSession?: boolean;
    trackingConfidence?: TrackingConfidence;
    processName?: string;
  }) => void;
  markStopping: (gameKey: string) => void;
  clearSession: (gameKey: string) => void;
  updateSessionPid: (gameKey: string, pid: number, confidence: TrackingConfidence, processName?: string) => void;
  stopSession: (gameKey: string) => Promise<{ terminated: boolean }>;
  findGameProcessForSession: (gameKey: string) => Promise<ProcessCandidate | null>;
  recordPlaytime: (gameKey: string) => { durationMs: number } | null;
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
        } else if (s.softSession) {
          const age = Date.now() - s.updatedAt;
          if (age < STEAM_SOFT_TTL_MS) {
            console.debug("[GameSession] hydrate: soft session kept", { gameKey: key, age });
            cleaned[key] = s;
          } else {
            console.debug("[GameSession] hydrate: soft session expired", { gameKey: key, age });
            changed = true;
          }
        } else if (s.source === "steam" || s.source === "epic") {
          const age = Date.now() - s.updatedAt;
          if (age < STEAM_SOFT_TTL_MS) {
            console.debug("[GameSession] hydrate: soft session kept", { gameKey: key, age });
            cleaned[key] = { ...s, softSession: true };
          } else {
            console.debug("[GameSession] hydrate: soft session expired", { gameKey: key, age });
            changed = true;
          }
        } else {
          cleaned[key] = { ...s, softSession: true };
        }
      } else if (s.state === "stopping" || s.state === "error") {
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
      console.debug("[GameSession] launch start", { gameKey: input.gameKey, source: input.source });
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
    (gameKey: string, update: {
      pid?: number;
      softSession?: boolean;
      trackingConfidence?: TrackingConfidence;
      processName?: string;
    }) => {
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
            trackingConfidence: update.trackingConfidence ?? existing.trackingConfidence,
            processName: update.processName ?? existing.processName,
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

  const updateSessionPid = useCallback(
    (gameKey: string, pid: number, confidence: TrackingConfidence, processName?: string) => {
      console.debug("[GameSession] updateSessionPid", { gameKey, pid, confidence });
      setSessions((prev) => {
        const existing = prev[gameKey];
        if (!existing) return prev;
        return {
          ...prev,
          [gameKey]: {
            ...existing,
            pid,
            trackingConfidence: confidence,
            processName: processName ?? existing.processName,
            softSession: false,
            updatedAt: Date.now(),
          },
        };
      });
    },
    []
  );

  const stopSession = useCallback(
    async (gameKey: string): Promise<{ terminated: boolean }> => {
      const session = sessionsRef.current[gameKey];
      if (!session) return { terminated: false };

      console.debug("[GameSession] stopSession", { gameKey, pid: session.pid, confidence: session.trackingConfidence });

      // Set stopping state
      setSessions((prev) => {
        if (!prev[gameKey]) return prev;
        return {
          ...prev,
          [gameKey]: { ...prev[gameKey], state: "stopping", updatedAt: Date.now() },
        };
      });

      let terminated = false;

      if (session.pid != null && session.trackingConfidence && session.trackingConfidence !== "none" && session.trackingConfidence !== "low") {
        try {
          await terminateProcessTree(session.pid);
          console.debug("[GameSession] process tree terminated", { gameKey, pid: session.pid });
          terminated = true;
        } catch (err) {
          console.warn("[GameSession] terminate tree failed, trying single kill", { gameKey, pid: session.pid, err });
          // Fall back to single process kill
          try {
            await terminateProcess(session.pid);
            terminated = true;
          } catch (err2) {
            console.warn("[GameSession] terminate failed too", { gameKey, pid: session.pid, err: err2 });
          }
        }
      } else if (session.pid != null) {
        // Low confidence or no confidence — still try, but don't use tree kill
        try {
          await terminateProcess(session.pid);
          console.debug("[GameSession] process terminated (single)", { gameKey, pid: session.pid });
          terminated = true;
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

      return { terminated };
    },
    []
  );

  const findGameProcessForSession = useCallback(
    async (gameKey: string): Promise<ProcessCandidate | null> => {
      const session = sessionsRef.current[gameKey];
      if (!session) return null;

      const input: FindProcessInput = {
        executablePath: session.executablePath,
        installDir: session.installDir,
        processName: session.processName,
        title: session.title,
        appId: session.appId,
      };

      console.debug("[GameSession] findGameProcess", { gameKey, input });
      const candidate = await findGameProcess(input, []);

      if (candidate && (candidate.confidence === "high" || candidate.confidence === "medium")) {
        updateSessionPid(gameKey, candidate.pid, candidate.confidence, candidate.name);
      }

      return candidate;
    },
    [updateSessionPid]
  );

  const recordPlaytime = useCallback(
    (gameKey: string): { durationMs: number } | null => {
      const session = sessionsRef.current[gameKey];
      if (!session || !session.launchedAt) return null;

      const now = Date.now();
      const durationMs = now - session.launchedAt;
      return { durationMs };
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
      updateSessionPid,
      stopSession,
      findGameProcessForSession,
      recordPlaytime,
    }),
    [sessions, getSession, getState, startLaunching, markRunning, markStopping, clearSession, updateSessionPid, stopSession, findGameProcessForSession, recordPlaytime]
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
