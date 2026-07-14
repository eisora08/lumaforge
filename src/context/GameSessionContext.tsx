import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isProcessRunning, terminateProcess, terminateProcessTree, terminateProcessByName, launchSteamApp, launchExecutable, listProcesses } from "../services/tauri";
import { findGameProcess, findGameProcesses, findCandidates, pickBestCandidate, resolveExecutablePath, getExeNamesFromSession, extractExeName } from "../utils/gameProcessDetection";
import { startPlaySession, endPlaySession, getCachedPlaytimeStore } from "../services/playtimeService";
import { setActivePlayedSession, clearActivePlayedSession } from "../services/achievementAutoSyncService";
import { createSessionRecord, addSession } from "../services/gameSessionHistory";
import { pushActivityEvent } from "./GameActivityContext";
import type { ProcessCandidate, FindProcessInput } from "../utils/gameProcessDetection";
import type { LibraryGame } from "../types/libraryGame";
import type { ProcessInfo } from "../services/tauri";
import { setInstalledGameEntry, discoverAndRegister } from "../services/installedGamesRegistry";

async function evaluateLauncherAchievements(): Promise<void> {
  try {
    const { evaluateAchievements } = await import("../features/activity/achievements/achievementEngine");
    const { buildEvalContext } = await import("../features/activity/stats/statsService");
    const { getReconciledGames } = await import("../services/gameStore");
    const games = getReconciledGames();
    if (games.length === 0) return;
    const ctx = buildEvalContext(games);
    const result = evaluateAchievements(ctx);
    if (result.newlyUnlocked.length > 0) {
      console.log(`[LAUNCHER_ACH] unlocked=${result.newlyUnlocked.map(a => a.id).join(",")}`);
      const { showAchievementToasts } = await import("../components/activity/AchievementToast");
      showAchievementToasts(result.newlyUnlocked);
    }
  } catch {
    // non-critical
  }
}

const ENABLE_VERBOSE_LAUNCH_LOGS = false;
const ENABLE_VERBOSE_SESSION_POLL = false;
const ENABLE_VERBOSE_ACH_REFRESH_LOGS = false;
const STOP_RETRY_MAX = 5;
const STOP_RETRY_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Targeted lightweight local-cache achievement refresh for a single appId.
 *  Reads disk cache, compares with store, applies if newer, persists, snaps. */
async function attemptAchievementRefresh(appId: string): Promise<void> {
  try {
    const { readAchievementCache, writeAchievementCache } = await import("../services/tauri");
    const { achievementStore } = await import("../services/achievementStore");
    const cached = await readAchievementCache(Number(appId));
    if (!cached) {
      console.log(`[ACH][LOCAL_CACHE_READ] appid=${appId} cacheFound=false updatedAt=null`);
      return;
    }
    const diskUpdatedAt = cached.summary.updated_at;
    if (ENABLE_VERBOSE_ACH_REFRESH_LOGS) console.log(`[ACH][LOCAL_CACHE_READ] appid=${appId} cacheFound=true updatedAt=${diskUpdatedAt}`);
    const existingSummary = achievementStore.getSummary(appId);
    const storeUpdatedAt = existingSummary?.updatedAt ?? 0;
    if (diskUpdatedAt <= storeUpdatedAt) {
      console.log(`[ACH][SESSION_STOP_REFRESH_SKIP] appid=${appId} reason=no-newer-local-cache`);
      return;
    }
    const newUnlocked = cached.summary.unlocked;
    const newTotal = cached.summary.total;
    const oldUnlocked = existingSummary?.unlocked ?? 0;
    if (ENABLE_VERBOSE_ACH_REFRESH_LOGS) console.log(`[ACH][SUMMARY_COMPARE] appid=${appId} old=${oldUnlocked}/${existingSummary?.total ?? 0} new=${newUnlocked}/${newTotal} changed=true`);
    const achievements = cached.achievements.map((entry: any) => ({
      id: entry.api_name,
      apiName: entry.api_name,
      name: entry.name,
      description: entry.description,
      iconUrl: entry.icon ?? entry.icon_url,
      iconGrayUrl: entry.icon_gray ?? entry.icon_gray_url,
      unlocked: entry.unlocked,
      unlockTime: entry.unlock_time ? (entry.unlock_time < 1000000000000 ? entry.unlock_time * 1000 : entry.unlock_time) : undefined,
      rarityPercent: entry.rarity_percent,
      statId: entry.stat_id,
      bit: entry.bit,
    }));
    const summary = {
      appId,
      total: newTotal,
      unlocked: newUnlocked,
      percent: cached.summary.percent,
      progressAvailable: cached.summary.progress_available,
      source: cached.summary.source,
      achievements,
      updatedAt: diskUpdatedAt,
    } as any;
    achievementStore.setSummary(appId, summary);
    console.log(`[ACH][SUMMARY_APPLY] appid=${appId} unlocked=${newUnlocked}/${newTotal} reason=session-stop-local-cache`);
    // Phase 4: Persist to disk cache immediately
    try {
      await writeAchievementCache(Number(appId), cached);
      console.log(`[ACH][CACHE_WRITE] appid=${appId} unlocked=${newUnlocked}/${newTotal} updatedAt=${diskUpdatedAt}`);
    } catch (writeErr) {
      console.warn(`[ACH][CACHE_WRITE] failed appid=${appId}`, String(writeErr));
    }
    // Schedule snapshot write
    const { notifyMediaUpdated } = await import("../services/startupSnapshotService");
    await notifyMediaUpdated(appId, { source: "achievement-refresh" });
    console.log(`[BootSnapshot][SCHEDULE] reason=achievement-summary-changed appid=${appId}`);
    // Phase 7: Manual Refresh remaining paths
    // (Manual Refresh Achievements continues to work via existing code path)
  } catch (err) {
    console.warn(`[ACH][SESSION_STOP_REFRESH] failed appid=${appId}`, String(err));
  }
}

export type OverlayEvent = {
  id: string;
  type: "launch" | "end";
  gameTitle: string;
  provider: string;
  imageUrl?: string;
  durationSeconds?: number;
};

export type GameSessionState = "idle" | "launching" | "running" | "stopping" | "error";

export type ActiveGameState = Exclude<GameSessionState, "idle" | "error">;

export type TrackingConfidence = "high" | "medium" | "low" | "none";

export type GameSessionSource = "steam" | "epic" | "local" | "manual" | "unknown";

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
  /** Current overlay toast event, or null. */
  overlayEvent: OverlayEvent | null;
  /** Dismiss the current overlay toast. */
  clearOverlay: () => void;
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
            if (ENABLE_VERBOSE_SESSION_POLL) console.debug("[GameSession] pid check", { gameKey: key, pid: s.pid, running });
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

  const killPidWithRetry = useCallback(
    async (gameKey: string, pid: number, killNames?: string[]): Promise<boolean> => {
      for (let attempt = 1; attempt <= STOP_RETRY_MAX; attempt++) {
        // Check if process already dead
        try {
          const stillRunning = await isProcessRunning(pid);
          if (!stillRunning) {
            console.debug("[GameSession] process already dead", { gameKey, pid, attempt });
            return true;
          }
        } catch {
          // If check fails, proceed with kill
        }

        // Attempt A: Kill by PID tree
        try {
          await terminateProcessTree(pid);
          console.debug("[GameSession] kill by PID attempt", { gameKey, pid, attempt });
        } catch (err) {
          console.warn("[GameSession] kill by PID failed", { gameKey, pid, attempt, err });
        }

        await delay(STOP_RETRY_DELAY_MS);

        // Check if PID is dead
        try {
          const alive = await isProcessRunning(pid);
          if (!alive) {
            console.debug("[GameSession] process confirmed dead via PID", { gameKey, pid, attempt });
            return true;
          }
        } catch {
          // continue with name fallback
        }

        // Attempt B: Kill by name (fallback within same retry)
        if (killNames && killNames.length > 0) {
          for (const name of killNames) {
            try {
              console.debug("[GameSession] kill by name fallback", { gameKey, name, attempt });
              await terminateProcessByName(name);
            } catch {
              // ignore
            }
            await delay(STOP_RETRY_DELAY_MS);
          }

          // Verify with original PID
          try {
            const aliveAfterNameKill = await isProcessRunning(pid);
            if (!aliveAfterNameKill) {
              console.debug("[GameSession] process confirmed dead via name fallback", { gameKey, pid, attempt });
              return true;
            }
          } catch {
            if (attempt === STOP_RETRY_MAX) return true;
          }
        }

        console.warn("[GameSession] process still alive after attempt", { gameKey, pid, attempt });
      }
      return false;
    },
    []
  );

  const stopSession = useCallback(
    async (gameKey: string): Promise<{ terminated: boolean }> => {
      const session = sessionsRef.current[gameKey];
      if (!session) return { terminated: false };

      console.debug("[GameSession] stopSession", {
        gameKey,
        pid: session.pid,
        exePath: session.executablePath,
        processName: session.processName,
        title: session.title,
        confidence: session.trackingConfidence,
      });

      // Set stopping state immediately
      markStopping(gameKey);

      // Build kill names upfront (from multiple sources + registry)
      let registryExeName: string | undefined;
      let registryExePath: string | undefined;
      try {
        const { getInstalledGameEntry } = await import("../services/installedGamesRegistry");
        const registryEntry = await getInstalledGameEntry(gameKey);
        if (registryEntry) {
          registryExeName = registryEntry.exeName;
          registryExePath = registryEntry.exePath;
        }
      } catch {}
      const killNames = getExeNamesFromSession({
        processName: session.processName || registryExeName,
        executablePath: session.executablePath || registryExePath,
        title: session.title,
      });

      let terminated = false;

      // ---- LAYER 1: Kill by stored PID ----
      const storedPid =
        session.pid != null && session.pid > 0 ? session.pid : null;

      if (storedPid != null) {
        // Validate PID before using it
        try {
          const pidValid = await isProcessRunning(storedPid);
          if (pidValid) {
            terminated = await killPidWithRetry(gameKey, storedPid, killNames);
          } else {
            console.debug("[GameSession] stored PID not running, skipping layer 1", {
              gameKey,
              pid: storedPid,
            });
          }
        } catch {
          // If check fails, attempt kill anyway
          terminated = await killPidWithRetry(gameKey, storedPid, killNames);
        }
      }

      // ---- LAYER 2: Scan ALL processes for any matching candidate ----
      if (!terminated) {
        try {
          const input: FindProcessInput = {
            executablePath: session.executablePath,
            installDir: session.installDir,
            processName: session.processName,
            title: session.title,
            appId: session.appId,
          };
          const allCandidates = await findGameProcesses(input, []);
          console.debug("[GameSession] process scan found candidates", {
            gameKey,
            count: allCandidates.length,
            candidates: allCandidates.map((c) => ({ pid: c.pid, name: c.name, confidence: c.confidence })),
          });

          for (const candidate of allCandidates) {
            if (candidate.pid === storedPid) continue; // already tried
            const killed = await killPidWithRetry(gameKey, candidate.pid, killNames);
            if (killed) {
              terminated = true;
              // Update session with found process info
              setSessions((prev) => {
                const existing = prev[gameKey];
                if (!existing) return prev;
                return {
                  ...prev,
                  [gameKey]: {
                    ...existing,
                    pid: candidate.pid,
                    processName: candidate.name,
                    trackingConfidence: candidate.confidence,
                    updatedAt: Date.now(),
                  },
                };
              });
              break;
            }
          }
        } catch (err) {
          console.warn("[GameSession] process scan failed", { gameKey, err });
        }
      }

      // ---- LAYER 3: Kill by executable name (aggressive) ----
      if (!terminated && killNames.length > 0) {
        console.debug("[GameSession] layer 3: killing by name", { gameKey, names: killNames });

        for (const name of [...new Set(killNames)]) {
          if (terminated) break;
          for (let attempt = 1; attempt <= STOP_RETRY_MAX; attempt++) {
            try {
              await terminateProcessByName(name);
              await delay(STOP_RETRY_DELAY_MS);

              // Verify by listing all processes
              const alive = await listProcesses();
              const nameLower = name.toLowerCase().replace(".exe", "");
              const stillExists = alive.some(
                (p) =>
                  p.name.toLowerCase() === nameLower ||
                  p.name.toLowerCase() === `${nameLower}.exe` ||
                  p.name.toLowerCase() === name.toLowerCase() ||
                  p.exe?.toLowerCase().endsWith(`/${name.toLowerCase()}`) ||
                  p.exe?.toLowerCase().endsWith(`\\${name.toLowerCase()}`)
              );
              if (!stillExists) {
                terminated = true;
                break;
              }
            } catch (err) {
              console.warn("[GameSession] kill by name failed", {
                gameKey,
                name,
                attempt,
                err,
              });
            }
          }
        }
      }

      // ---- LAYER 4: Brute force — scan process list and kill any exe matching game title ----
      if (!terminated && session.title) {
        try {
          const titleWords = session.title
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length > 3);
          const allProcs = await listProcesses();
          for (const proc of allProcs) {
            const procName = proc.name.toLowerCase().replace(".exe", "");
            const match = titleWords.some(
              (word) => procName.includes(word) || word.includes(procName)
            );
            if (match && !procName.includes("steam") && !procName.includes("epic")) {
              try {
                await terminateProcessTree(proc.pid);
                await delay(200);
                const stillRunning = await isProcessRunning(proc.pid);
                if (!stillRunning) {
                  terminated = true;
                  break;
                }
              } catch {
                // continue
              }
            }
          }
        } catch {
          // best effort
        }
      }

      console.debug("[GameSession] stopSession result", { gameKey, terminated });

      if (terminated) {
        // Process confirmed dead — clean up session
        setSessions((prev) => {
          const next = { ...prev };
          delete next[gameKey];
          return next;
        });
      } else {
        // Do NOT clear session — prevent desync. Mark as soft session so UI shows correct state.
        console.warn("[GameSession] all stop attempts exhausted, marking as soft session", {
          gameKey,
        });
        setSessions((prev) => {
          const existing = prev[gameKey];
          if (!existing) return prev;
          return {
            ...prev,
            [gameKey]: {
              ...existing,
              state: "running" as ActiveGameState,
              softSession: true,
              trackingConfidence: "none",
              updatedAt: Date.now(),
            },
          };
        });
      }

      return { terminated };
    },
    [killPidWithRetry, markStopping]
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

  // Stores image URL and display info per session key for overlay events
  const sessionMediaRef = useRef<Record<string, { imageUrl?: string; title: string; provider: string }>>({});

  // Tracks active play session IDs for playtime recording
  const activePlaySessionsRef = useRef<Record<string, string>>({});

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
        source: game.source === "steam" ? "steam" : game.source === "local" ? "local" : game.source === "manual" ? "manual" : "unknown",
        state: "launching",
        executablePath: game.executablePath,
        installDir: game.installDir,
        launchedAt: now,
        updatedAt: now,
      },
    }));

    // Store media info for overlay events
    // For manual games, imageUrl is a relative path like "games/manual/<uuid>/media/cover.jpg"
    // that localPathToUrl can't handle — resolve via resolveProviderMediaPreviewUrl.
    const rawBestUrl = game.imageUrl || game.metadata?.background_image || game.metadata?.header_image || game.metadata?.capsule_image_v5 || game.metadata?.library_hero_image || game.metadata?.hero_image || undefined;
    let bestImageUrl: string | undefined = rawBestUrl;
    if (rawBestUrl && !rawBestUrl.startsWith("http") && !rawBestUrl.startsWith("asset://") && !rawBestUrl.startsWith("data:")) {
      try {
        const { resolveProviderMediaPreviewUrl } = await import("../services/gameCacheService");
        const resolved = await resolveProviderMediaPreviewUrl(rawBestUrl);
        if (resolved) bestImageUrl = resolved;
      } catch { /* non-critical — overlay will use fallback */ }
    }
    const providerLabel = game.source === "steam" ? "Steam" : game.source === "local" ? "Local" : game.source === "manual" ? "Manual" : "Unknown";
    sessionMediaRef.current[computedKey] = { imageUrl: bestImageUrl, title: game.title, provider: providerLabel };

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
        } else if (game.source === "local") {
          // Resolve executable path — registry first, then discovery
          let effectiveExePath = game.executablePath;
          if (!effectiveExePath) {
            const resolved = await resolveExecutablePath(game.id, game.installDir, game.title);
            if (resolved) {
              effectiveExePath = resolved.exePath;
              console.debug("[Launch] resolved executable", { gameKey: computedKey, exePath: effectiveExePath });

              // Persist to registry so future launches skip scanning
              if (game.id) {
                setInstalledGameEntry({
                  gameId: game.id,
                  installDir: game.installDir || "",
                  exePath: resolved.exePath,
                  exeName: resolved.exeName,
                  provider: "local",
                  lastValidated: Date.now(),
                }).catch(() => {});
              }

              // Update session with discovered executable info
              setSessions((prev) => {
                const existing = prev[computedKey];
                if (!existing) return prev;
                return {
                  ...prev,
                  [computedKey]: {
                    ...existing,
                    executablePath: resolved.exePath,
                    processName: resolved.exeName,
                    updatedAt: Date.now(),
                  },
                };
              });
            }
          }

          if (!effectiveExePath) {
            console.warn("[Launch] no executable path for local game", { gameKey: computedKey });
            setSessions((prev) => {
              const next = { ...prev };
              delete next[computedKey];
              return next;
            });
            return;
          }

          const result = await launchExecutable(effectiveExePath);
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
                  processName: extractExeName(effectiveExePath),
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
        } else if (game.source === "manual" && game.executablePath) {
          const exePath = game.executablePath.trim().replace(/^["']|["']$/g, "");
          const workingDir = game.workingDirectory || game.libraryPath || exePath.substring(0, exePath.lastIndexOf("\\"));
          const args = game.launchArguments
            ? game.launchArguments.trim().split(/\s+/).filter(Boolean)
            : undefined;

          const result = await launchExecutable(exePath, args, workingDir || undefined);
          if (ls.cancelled || ls.token !== token) {
            if (result.pid) {
              try { await terminateProcess(result.pid); } catch { /* ignore */ }
            }
            return;
          }

          if (result.pid) {
            if (ENABLE_VERBOSE_LAUNCH_LOGS) {
              console.debug("[Launch] manual process spawned", { gameKey: computedKey, pid: result.pid });
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
                  processName: extractExeName(exePath),
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

  // ---------------------------------------------------------------------------
  // Overlay event state — fires toast on launch / stop transitions
  // ---------------------------------------------------------------------------

  const [overlayEvent, setOverlayEvent] = useState<OverlayEvent | null>(null);
  const prevSessionsRef = useRef<Record<string, RunningGameSession>>(sessions);
  const everRanRef = useRef<Set<string>>(new Set());

  const clearOverlay = useCallback(() => {
    setOverlayEvent(null);
  }, []);

  // Detect transitions: launching→running (show launch), running→deleted (show end)
  useEffect(() => {
    const prev = prevSessionsRef.current;
    const current = sessions;

    // Check for first-time "running" transitions
    for (const [key, curSession] of Object.entries(current)) {
      const prevSession = prev[key];
      if (curSession.state === "running" && (!prevSession || prevSession.state !== "running")) {
        if (!everRanRef.current.has(key)) {
          everRanRef.current.add(key);

          // Phase 1: Register active played session for targeted achievement/playtime tracking
          if (curSession.appId) {
            setActivePlayedSession(curSession.appId, key);
          }

          // Discover and register executable for Steam games without exe info
          if (curSession.source === "steam" && !curSession.executablePath && curSession.installDir) {
            discoverAndRegister(key, curSession.installDir, curSession.title, "steam").catch(() => {});
          }

          const mediaInfo = sessionMediaRef.current[key];
          const provider = curSession.source === "steam" ? "Steam" : curSession.source === "local" ? "Local" : curSession.source === "manual" ? "Manual" : "Unknown";
          setOverlayEvent({
            id: `launch-${key}-${curSession.updatedAt}`,
            type: "launch",
            gameTitle: curSession.title || "Unknown Game",
            provider,
            imageUrl: mediaInfo?.imageUrl,
          });

          // Start playtime session
          const ptProvider = curSession.source === "steam" ? "steam" : curSession.source === "local" ? "local" : curSession.source === "manual" ? "manual" : "unknown";
          startPlaySession({
            gameKey: key,
            appId: curSession.appId,
            provider: ptProvider,
            title: curSession.title || "Unknown Game",
            startedAt: Math.floor(Date.now() / 1000),
          }).then((activeSession) => {
            activePlaySessionsRef.current[key] = activeSession.sessionId;
            // Phase 5: Update lastPlayedAt in cached store immediately so UI shows "just now"
            const cached = getCachedPlaytimeStore();
            if (cached) {
              const now = Math.floor(Date.now() / 1000);
              // Always update via canonical app-<appId> key for consistent lookup
              const canonicalKey = curSession.appId ? `app-${curSession.appId}` : key;
              if (cached.games[canonicalKey]) {
                cached.games[canonicalKey].lastPlayedAt = now;
              } else {
                // Create entry if it doesn't exist yet
                cached.games[canonicalKey] = {
                  gameKey: canonicalKey,
                  appId: curSession.appId ?? null,
                  provider: ptProvider,
                  title: curSession.title || "Unknown Game",
                  playtimeSource: ptProvider === "steam" ? "external" : "local",
                  externalPlaytimeSeconds: 0,
                  externalSource: ptProvider === "steam" ? "steam" : null,
                  externalImportedAt: null,
                  localPlaytimeSeconds: 0,
                  totalPlaytimeSeconds: 0,
                  lastPlayedAt: now,
                  lastSessionSeconds: null,
                  sessions: [],
                };
              }
              // Also update legacy key if different
              if (key !== canonicalKey) {
                if (cached.games[key]) {
                  cached.games[key].lastPlayedAt = now;
                } else {
                  cached.games[key] = { ...cached.games[canonicalKey], gameKey: key };
                }
              }
              cached.updatedAt = Date.now();
              console.log(`[ACTIVITY][LAUNCH_TRACKED] appid=${curSession.appId} lastPlayedAt=${now}`);
            }
          }).catch((err: unknown) => {
            console.warn("[Playtime] start failed", err);
          });
        }
      }
    }

    // Check for running-session deletions
    for (const [key, prevSession] of Object.entries(prev)) {
      if (!current[key] && everRanRef.current.has(key)) {
        everRanRef.current.delete(key);
        const durationSeconds = prevSession.launchedAt
          ? Math.floor((Date.now() - prevSession.launchedAt) / 1000)
          : 0;
        const mediaInfo = sessionMediaRef.current[key];
        const provider = prevSession.source === "steam" ? "Steam" : prevSession.source === "local" ? "Local" : prevSession.source === "manual" ? "Manual" : "Unknown";
        setOverlayEvent({
          id: `end-${key}-${Date.now()}`,
          type: "end",
          gameTitle: prevSession.title || "Unknown Game",
          provider,
          imageUrl: mediaInfo?.imageUrl,
          durationSeconds: Math.max(1, durationSeconds),
        });

        // End playtime session (skip if duration < 15s)
        const sessionId = activePlaySessionsRef.current[key];
        if (sessionId) {
          delete activePlaySessionsRef.current[key];
          if (durationSeconds >= 15) {
            const exitReason = prevSession.state === "stopping" ? "stopped" : "process-exited";
            endPlaySession({
              sessionId,
              gameKey: key,
              endedAt: Math.floor(Date.now() / 1000),
              exitReason: exitReason as "stopped" | "process-exited",
            }).catch((err: unknown) => {
              console.warn("[Playtime] end failed", err);
            });

            // Persist session record to local history
            const activitySource = prevSession.source === "steam" ? "steam" : prevSession.source === "local" ? "local" : prevSession.source === "manual" ? "manual" : "system";
            const sessionRecord = createSessionRecord({
              appId: prevSession.appId || key,
              title: prevSession.title || "Unknown Game",
              source: activitySource,
              startedAt: prevSession.launchedAt,
              endedAt: Date.now(),
              exitReason: exitReason as "normal" | "stopped" | "crashed" | "unknown",
            });
            if (sessionRecord) {
              const added = addSession(sessionRecord);
              if (added) {
                console.log(`[SESSION_HISTORY] recorded appid=${prevSession.appId} duration=${durationSeconds}s id=${sessionRecord.id}`);

                // Emit activity feed event (works from any page, not just GameDetails)
                const durStr = durationSeconds >= 3600
                  ? `${Math.floor(durationSeconds / 3600)}h ${Math.floor((durationSeconds % 3600) / 60)}m`
                  : durationSeconds >= 60
                    ? `${Math.floor(durationSeconds / 60)}m`
                    : `${durationSeconds}s`;
                const exitLabel = exitReason === "stopped" ? "Stopped" : "Process exited";
                pushActivityEvent({
                  gameId: prevSession.appId || key,
                  appId: prevSession.appId,
                  kind: "game-closed",
                  title: prevSession.title || "Unknown Game",
                  description: `Played for ${durStr} · ${exitLabel}`,
                  source: activitySource,
                  severity: "info",
                });
              }
          }
        } else {
            console.debug("[Playtime] skipped end — duration below 15s", { gameKey: key, durationSeconds });
          }
        }

        // Clean up media ref
        delete sessionMediaRef.current[key];

        // Evaluate launcher achievements after session
        if (durationSeconds >= 15) {
          setTimeout(() => evaluateLauncherAchievements(), 2000);
        }

        // Phase 1: Clear active played session
        if (prevSession.appId) {
          clearActivePlayedSession();
        }

        // Phase 3+4+5+6: Targeted achievement + playtime refresh with retries
        const stoppedAppId = prevSession.appId;
        if (stoppedAppId && durationSeconds >= 15) {
          console.log(`[ACH][SESSION_STOP_REFRESH] appid=${stoppedAppId} reason=played-session`);

          // Phase 5: Log playtime session end
          console.log(`[PLAYTIME][SESSION_STOP_REFRESH] appid=${stoppedAppId}`);
          console.log(`[PLAYTIME][SESSION_END] appid=${stoppedAppId} seconds=${durationSeconds} threshold=15`);

          (async () => {
            // Attempt 1: immediate read
            await attemptAchievementRefresh(stoppedAppId);

            // Phase 6: Schedule snapshot write for playtime changes
            try {
              const { notifyMediaUpdated } = await import("../services/startupSnapshotService");
              const cached = getCachedPlaytimeStore();
              const ptEntry = cached?.games[`app-${stoppedAppId}`];
              if (ptEntry) {
                console.log(`[ACTIVITY][PLAYTIME_UPDATED] appid=${stoppedAppId} external=${ptEntry.externalPlaytimeSeconds} local=${ptEntry.localPlaytimeSeconds} total=${ptEntry.totalPlaytimeSeconds} source=${ptEntry.playtimeSource}`);
              }
              // Schedule snapshot for playtime change
              notifyMediaUpdated(stoppedAppId, { source: "playtime-changed" }).catch(() => {});
              console.log(`[BootSnapshot][SCHEDULE] reason=playtime-changed appid=${stoppedAppId}`);
            } catch (snapErr) {
              console.warn("[PLAYTIME] snapshot schedule failed", String(snapErr));
            }
          })();

          // Retry 2: after 5 seconds
          setTimeout(() => {
            console.log(`[ACH][SESSION_STOP_REFRESH_RETRY] appid=${stoppedAppId} delayMs=5000`);
            attemptAchievementRefresh(stoppedAppId).catch(() => {});
          }, 5000);

          // Retry 3: after 20 seconds
          setTimeout(() => {
            console.log(`[ACH][SESSION_STOP_REFRESH_RETRY] appid=${stoppedAppId} delayMs=20000`);
            attemptAchievementRefresh(stoppedAppId).catch(() => {});
          }, 20000);
        } else if (stoppedAppId && durationSeconds < 15) {
          console.log(`[PLAYTIME][SESSION_DURATION_SKIP] appid=${stoppedAppId} seconds=${durationSeconds} threshold=15 lastPlayedKept=true`);
          // Clear session watch even for short sessions
        }
      }
    }

    prevSessionsRef.current = sessions;
  }, [sessions]);

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
      overlayEvent,
      clearOverlay,
    }),
    [sessions, getSession, getState, startLaunching, markRunning, markStopping, clearSession, updateSessionPid, stopSession, findGameProcessForSession, recordPlaytime, launchGame, cancelLaunch, findRunningSessionKey, stopGameByAppId, overlayEvent, clearOverlay]
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
