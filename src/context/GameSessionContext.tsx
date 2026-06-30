import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isProcessRunning, terminateProcess, terminateProcessTree, launchSteamApp, launchExecutable, listProcesses } from "../services/tauri";
import { findGameProcess, findCandidates, pickBestCandidate } from "../utils/gameProcessDetection";
import type { ProcessCandidate, FindProcessInput } from "../utils/gameProcessDetection";
import type { LibraryGame } from "../types/libraryGame";
import type { ProcessInfo } from "../services/tauri";

const ENABLE_VERBOSE_LAUNCH_LOGS = false;

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
  /** Global launch orchestration — survives page navigation. */
  launchGame: (game: LibraryGame) => Promise<void>;
  /** Cancel a pending launch (only while in "launching" state before dispatch). */
  cancelLaunch: (gameKey: string) => Promise<void>;
  /** Find the actual session key for the currently running game, or null. */
  findRunningSessionKey: () => string | null;
  /** Stop a running game by its appId — resolves correct session key internally. */
  stopGameByAppId: (appId: string) => Promise<{ terminated: boolean }>;
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

  // ---------------------------------------------------------------------------
  // Global launch orchestration — lives in context, survives page navigation.
  // ---------------------------------------------------------------------------

  const launchStateRef = useRef<{
    token: symbol | null;
    cancelled: boolean;
    guardTimer: ReturnType<typeof setTimeout> | null;
    dispatchTimer: ReturnType<typeof setTimeout> | null;
    scanTimeouts: ReturnType<typeof setTimeout>[];
    launchTimeout: ReturnType<typeof setTimeout> | null;
    snapshotBefore: ProcessInfo[];
    dispatched: boolean;
  }>({
    token: null,
    cancelled: false,
    guardTimer: null,
    dispatchTimer: null,
    scanTimeouts: [],
    launchTimeout: null,
    snapshotBefore: [],
    dispatched: false,
  });

  // Clean up all timers for the current launch
  const clearLaunchTimers = useCallback(() => {
    const ls = launchStateRef.current;
    if (ls.guardTimer !== null) { clearTimeout(ls.guardTimer); ls.guardTimer = null; }
    if (ls.dispatchTimer !== null) { clearTimeout(ls.dispatchTimer); ls.dispatchTimer = null; }
    if (ls.launchTimeout !== null) { clearTimeout(ls.launchTimeout); ls.launchTimeout = null; }
    for (const t of ls.scanTimeouts) clearTimeout(t);
    ls.scanTimeouts = [];
  }, []);

  // Scan for process after launch
  const scanForProcessAfterLaunch = useCallback(async (
    computedKey: string,
    game: { executablePath?: string; installDir?: string; title?: string; appId?: string },
    token: symbol,
    delayMs: number,
  ): Promise<void> => {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(async () => {
        if (launchStateRef.current.cancelled || launchStateRef.current.token !== token) {
          resolve();
          return;
        }
        try {
          const processes = await listProcesses();
          if (ENABLE_VERBOSE_LAUNCH_LOGS) {
            console.debug("[Launch] scan after launch", { gameKey: computedKey, count: processes.length, delayMs });
          }
          const candidates = findCandidates(processes, {
            executablePath: game.executablePath,
            installDir: game.installDir,
            title: game.title,
            appId: game.appId,
          }, launchStateRef.current.snapshotBefore);
          const best = pickBestCandidate(candidates);
          if (best) {
            if (ENABLE_VERBOSE_LAUNCH_LOGS) {
              console.debug("[Launch] candidate found, marking running", { gameKey: computedKey, pid: best.pid, confidence: best.confidence });
            }
            setSessions((prev) => {
              const existing = prev[computedKey];
              if (!existing) return prev;
              return {
                ...prev,
                [computedKey]: {
                  ...existing,
                  state: "running",
                  pid: best.pid,
                  softSession: false,
                  trackingConfidence: best.confidence,
                  processName: best.name,
                  updatedAt: Date.now(),
                },
              };
            });
            resolve();
            return;
          }
          if (ENABLE_VERBOSE_LAUNCH_LOGS) {
            console.debug("[Launch] no candidate found", { gameKey: computedKey, delayMs });
          }
        } catch (err) {
          console.warn("[Launch] scan error", err);
        }
        resolve();
      }, delayMs);
      launchStateRef.current.scanTimeouts.push(timeout);
    });
  }, []);

  const launchGame = useCallback(async (game: LibraryGame) => {
    const ls = launchStateRef.current;
    clearLaunchTimers();
    ls.cancelled = false;
    ls.dispatched = false;
    const token = Symbol("launch");
    ls.token = token;

    const computedKey = computeGameKey(game);

    if (ENABLE_VERBOSE_LAUNCH_LOGS) {
      console.debug("[Launch] start", { gameKey: computedKey, title: game.title, appId: game.appId, source: game.source });
    }

    // Check existing state — ignore if already launching/running/stopping
    const currentState = sessionsRef.current[computedKey]?.state;
    if (currentState === "launching" || currentState === "running" || currentState === "stopping") {
      if (ENABLE_VERBOSE_LAUNCH_LOGS) {
        console.debug("[Launch] ignored — already in state", { gameKey: computedKey, state: currentState });
      }
      return;
    }

    // Snapshot current processes for diff
    try {
      ls.snapshotBefore = await listProcesses();
    } catch {
      ls.snapshotBefore = [];
    }

    // Set launching state
    const now = Date.now();
    setSessions((prev) => ({
      ...prev,
      [computedKey]: {
        gameKey: computedKey,
        gameId: game.id,
        appId: game.appId,
        title: game.title,
        source: game.source === "steam" ? "steam" : game.source === "local" ? "local" : "unknown",
        state: "launching",
        executablePath: game.executablePath,
        installDir: game.installDir,
        launchedAt: now,
        updatedAt: now,
      },
    }));

    // 30-second timeout guard — prevents infinite launching
    ls.guardTimer = setTimeout(() => {
      ls.guardTimer = null;
      if (ls.token === token && !ls.cancelled) {
        const s = sessionsRef.current[computedKey];
        if (s?.state === "launching") {
          if (ENABLE_VERBOSE_LAUNCH_LOGS) {
            console.debug("[Launch] timeout — 30s guard, forcing error", { gameKey: computedKey });
          }
          setSessions((prev) => {
            const existing = prev[computedKey];
            if (!existing || existing.state !== "launching") return prev;
            return {
              ...prev,
              [computedKey]: { ...existing, state: "running" as ActiveGameState, softSession: true, trackingConfidence: "none", updatedAt: Date.now() },
            };
          });
        }
      }
    }, 30000);

    // Delayed dispatch so Cancel can abort
    const dispatchDelayMs = game.source === "steam" ? 1500 : 800;
    ls.dispatchTimer = setTimeout(async () => {
      ls.dispatchTimer = null;
      if (ls.cancelled || ls.token !== token) return;

      ls.dispatched = true;
      if (ENABLE_VERBOSE_LAUNCH_LOGS) {
        console.debug("[Launch] backend response", { gameKey: computedKey });
      }

      try {
        if (game.source === "steam" && game.appId) {
          await launchSteamApp(Number(game.appId));
          if (ls.cancelled || ls.token !== token) return;

          if (ENABLE_VERBOSE_LAUNCH_LOGS) {
            console.debug("[Launch] running", { gameKey: computedKey });
          }

          ls.launchTimeout = setTimeout(async () => {
            ls.launchTimeout = null;
            if (ls.token !== token || ls.cancelled) return;

            await scanForProcessAfterLaunch(computedKey, game, token, 0);
            if (sessionsRef.current[computedKey]?.state !== "running") {
              await scanForProcessAfterLaunch(computedKey, game, token, 3000);
            }
            if (sessionsRef.current[computedKey]?.state !== "running") {
              await scanForProcessAfterLaunch(computedKey, game, token, 5000);
            }

            if (ls.token === token && !ls.cancelled && sessionsRef.current[computedKey]?.state === "launching") {
              if (ENABLE_VERBOSE_LAUNCH_LOGS) {
                console.debug("[Launch] no process detected, marking soft session", { gameKey: computedKey });
              }
              setSessions((prev) => {
                const existing = prev[computedKey];
                if (!existing || existing.state !== "launching") return prev;
                return {
                  ...prev,
                  [computedKey]: { ...existing, state: "running" as ActiveGameState, softSession: true, trackingConfidence: "none", updatedAt: Date.now() },
                };
              });
            }
          }, 2000);
        } else if (game.source === "local" && game.executablePath) {
          const result = await launchExecutable(game.executablePath);
          if (ls.cancelled || ls.token !== token) {
            if (result.pid) {
              try { await terminateProcess(result.pid); } catch { /* ignore */ }
            }
            return;
          }

          if (result.pid) {
            if (ENABLE_VERBOSE_LAUNCH_LOGS) {
              console.debug("[Launch] local process spawned", { gameKey: computedKey, pid: result.pid });
            }
            setSessions((prev) => {
              const existing = prev[computedKey];
              if (!existing) return prev;
              return {
                ...prev,
                [computedKey]: {
                  ...existing,
                  state: "running",
                  pid: result.pid,
                  softSession: false,
                  trackingConfidence: "high",
                  processName: game.executablePath!.split(/[/\\]/).pop(),
                  updatedAt: Date.now(),
                },
              };
            });
          } else {
            await scanForProcessAfterLaunch(computedKey, game, token, 0);
            if (ls.token === token && !ls.cancelled && sessionsRef.current[computedKey]?.state === "launching") {
              setSessions((prev) => {
                const existing = prev[computedKey];
                if (!existing || existing.state !== "launching") return prev;
                return {
                  ...prev,
                  [computedKey]: { ...existing, state: "running" as ActiveGameState, softSession: true, trackingConfidence: "none", updatedAt: Date.now() },
                };
              });
            }
          }
        } else {
          console.warn("[Launch] cannot determine launch method", { gameKey: computedKey });
          setSessions((prev) => {
            const next = { ...prev };
            delete next[computedKey];
            return next;
          });
        }
      } catch (err) {
        console.warn("[Launch] failed", err);
        if (ls.token === token && !ls.cancelled) {
          setSessions((prev) => {
            const next = { ...prev };
            delete next[computedKey];
            return next;
          });
        }
      }
    }, dispatchDelayMs);
  }, [clearLaunchTimers, scanForProcessAfterLaunch]);

  const cancelLaunch = useCallback(async (gameKey: string) => {
    const ls = launchStateRef.current;
    const currentState = sessionsRef.current[gameKey]?.state;
    if (currentState !== "launching") return;

    if (ls.dispatched) {
      if (ENABLE_VERBOSE_LAUNCH_LOGS) {
        console.debug("[Launch] cancel requested but already dispatched — marking soft running", { gameKey });
      }
      setSessions((prev) => {
        const existing = prev[gameKey];
        if (!existing) return prev;
        return {
          ...prev,
          [gameKey]: { ...existing, state: "running" as ActiveGameState, softSession: true, trackingConfidence: "none", updatedAt: Date.now() },
        };
      });
      return;
    }

    if (ENABLE_VERBOSE_LAUNCH_LOGS) {
      console.debug("[Launch] stop requested", { gameKey, processId: sessionsRef.current[gameKey]?.pid });
    }

    ls.cancelled = true;
    ls.token = null;
    clearLaunchTimers();

    const currentSession = sessionsRef.current[gameKey];
    if (currentSession?.pid != null) {
      try { await terminateProcess(currentSession.pid); } catch { /* ignore */ }
    }

    setSessions((prev) => {
      const next = { ...prev };
      delete next[gameKey];
      return next;
    });

    if (ENABLE_VERBOSE_LAUNCH_LOGS) {
      console.debug("[Launch] stopped", { gameKey });
    }
  }, [clearLaunchTimers]);

  const findRunningSessionKey = useCallback((): string | null => {
    for (const [key, s] of Object.entries(sessionsRef.current)) {
      if (s.state === "running") return key;
    }
    return null;
  }, []);

  const stopGameByAppId = useCallback(async (appId: string): Promise<{ terminated: boolean }> => {
    for (const [key, s] of Object.entries(sessionsRef.current)) {
      if (s.appId === appId) {
        return stopSession(key);
      }
    }
    return { terminated: false };
  }, [stopSession]);

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
      launchGame,
      cancelLaunch,
      findRunningSessionKey,
      stopGameByAppId,
    }),
    [sessions, getSession, getState, startLaunching, markRunning, markStopping, clearSession, updateSessionPid, stopSession, findGameProcessForSession, recordPlaytime, launchGame, cancelLaunch, findRunningSessionKey, stopGameByAppId]
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
