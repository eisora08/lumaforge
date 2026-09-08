import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isProcessRunning, terminateProcess, terminateProcessTree, launchSteamApp, launchExecutable, listProcesses, upsertGameSession } from "../services/tauri";
import { findGameProcess, findGameProcesses, findCandidates, pickBestCandidate, resolveExecutablePath, extractExeName } from "../utils/gameProcessDetection";
import { startPlaySession, endPlaySession, getCachedPlaytimeStore } from "../services/playtimeService";
import { setActivePlayedSession, clearActivePlayedSession } from "../services/achievementAutoSyncService";
import { pushActivityEvent } from "./GameActivityContext";
import { dispatchProviderLaunch } from "../utils/providerLaunchAdapter";
import { loadSettings } from "../context/SettingsContext";
import type { ProcessCandidate, FindProcessInput } from "../utils/gameProcessDetection";
import type { LibraryGame } from "../types/libraryGame";
import type { ProcessInfo, GameSession } from "../services/tauri";
import { setInstalledGameEntry, discoverAndRegister } from "../services/installedGamesRegistry";
import { showError } from "../components/toast/GameToast";

async function evaluateLauncherAchievements(): Promise<void> {
  try {
    const { evaluateAchievements } = await import("../features/activity/achievements/achievementEngine");
    const { buildEvalContext } = await import("../features/activity/stats/statsService");
    const { getReconciledGames } = await import("../services/gameStore");
    const { getAllManualGames } = await import("../services/manualGameStore");
    const { manualGameToLibraryGame } = await import("../services/manualGameLibraryMapper");
    const steamGames = getReconciledGames();
    const manualGames = getAllManualGames().map(manualGameToLibraryGame);
    const games = [...steamGames, ...manualGames];
    if (games.length === 0) return;
    const ctx = await buildEvalContext(games);
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
async function attemptAchievementRefresh(appId: string, platform?: string): Promise<void> {
  try {
    const { readAchievementCache, writeAchievementCache } = await import("../services/tauri");
    const { achievementStore } = await import("../services/achievementStore");
    const cached = await readAchievementCache(Number(appId), platform);
    if (!cached) {
      console.log(`[ACH][LOCAL_CACHE_READ] appid=${appId} cacheFound=false updatedAt=null`);
      return;
    }
    const diskUpdatedAt = cached.summary.updated_at;
    if (ENABLE_VERBOSE_ACH_REFRESH_LOGS) console.log(`[ACH][LOCAL_CACHE_READ] appid=${appId} cacheFound=true updatedAt=${diskUpdatedAt}`);
    const existingSummary = achievementStore.getSummary(appId, platform);
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
    achievementStore.setSummary(appId, summary, platform);
    console.log(`[ACH][SUMMARY_APPLY] appid=${appId} unlocked=${newUnlocked}/${newTotal} reason=session-stop-local-cache platform=${platform ?? "none"}`);
    // Phase 4: Persist to disk cache immediately
    try {
      await writeAchievementCache(Number(appId), cached, false, platform);
      console.log(`[ACH][CACHE_WRITE] appid=${appId} unlocked=${newUnlocked}/${newTotal} updatedAt=${diskUpdatedAt} platform=${platform ?? "none"}`);
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
  /** Cover-first image for backward compat (same as heroUrl for most games). */
  imageUrl?: string;
  /** Hero/background image for the summary overlay (background-first for manual). */
  heroUrl?: string;
  /** Icon for the HUD chip. */
  iconUrl?: string;
  durationSeconds?: number;
};

export type GameSessionState = "idle" | "launching" | "running" | "stopping" | "error";

export type ActiveGameState = Exclude<GameSessionState, "idle" | "error">;

export type TrackingConfidence = "high" | "medium" | "low" | "none";

  export type GameSessionSource = "steam" | "epic" | "debrid" | "local" | "manual" | "lua" | "emulator" | "unknown";

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
  stopError?: string;
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
  /** Get resolved media info (imageUrl, heroUrl, iconUrl) for a session key. Returns undefined if no media resolved yet. */
  getSessionMedia: (gameKey: string) => { imageUrl?: string; heroUrl?: string; iconUrl?: string; title: string; provider: string } | undefined;
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
    const expiredKeys: string[] = [];

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
            expiredKeys.push(key);
            changed = true;
          }
        } else if (s.source === "steam" || s.source === "epic" || s.source === "debrid") {
          const age = Date.now() - s.updatedAt;
          if (age < STEAM_SOFT_TTL_MS) {
            console.debug("[GameSession] hydrate: soft session kept", { gameKey: key, age });
            cleaned[key] = { ...s, softSession: true };
          } else {
            console.debug("[GameSession] hydrate: soft session expired", { gameKey: key, age });
            expiredKeys.push(key);
            changed = true;
          }
        } else {
          cleaned[key] = { ...s, softSession: true };
        }
      } else if (s.state === "stopping" || s.state === "error") {
        changed = true;
      }
    }

    // Force lastPlayedAt to last session end for expired sessions
    // so the dashboard shows the correct time instead of "just now"
    if (expiredKeys.length > 0) {
      import("../services/playtimeService").then(({ getCachedPlaytimeStore }) => {
        const cached = getCachedPlaytimeStore();
        if (!cached) return;
        for (const key of expiredKeys) {
          const entry = cached.games[key];
          if (entry) {
            // Set lastPlayedAt to the session's updatedAt (last known activity)
            const s = raw[key];
            const lastActivity = s ? Math.floor(s.updatedAt / 1000) : Math.floor(Date.now() / 1000);
            entry.lastPlayedAt = lastActivity;
          }
        }
        window.dispatchEvent(new CustomEvent("lumaforge-data-changed", { detail: { key: "lumaforge-playtime-v1" } }));
      });
    }

    if (changed || Object.keys(cleaned).length !== Object.keys(raw).length) {
      console.debug("[GameSession] hydrate: cleaned sessions", { before: Object.keys(raw).length, after: Object.keys(cleaned).length });
      setSessions(cleaned);
      persistSessions(cleaned);
    }
  }, []);

  // PID polling
  useEffect(() => {
    let softScanCounter = 0;
    const interval = setInterval(async () => {
      const current = sessionsRef.current;
      let changed = false;
      const next: Record<string, RunningGameSession> = {};
      const softSessions: Array<[string, RunningGameSession]> = [];

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
        } else if (s.state === "running" && s.softSession && s.pid == null) {
          softSessions.push([key, s]);
        }
        next[key] = s;
      }

      // Re-scan for soft sessions (no PID) every ~60s to detect when game closed
      if (softSessions.length > 0) {
        softScanCounter++;
        if (softScanCounter >= 12) {
          softScanCounter = 0;
          try {
            const allProcesses = await listProcesses();
            for (const [key, s] of softSessions) {
              const candidates = findCandidates(allProcesses, {
                executablePath: s.executablePath,
                installDir: s.installDir,
                title: s.title,
                appId: s.appId,
              }, []);
              const best = pickBestCandidate(candidates);
              if (!best) {
                console.debug("[GameSession] soft session: process not found, clearing", { gameKey: key });
                delete next[key];
                changed = true;
              } else {
                // Found process — promote to PID-tracked session
                if (ENABLE_VERBOSE_SESSION_POLL) console.debug("[GameSession] soft session: process found, promoting", { gameKey: key, pid: best.pid });
                next[key] = { ...s, pid: best.pid, softSession: false, trackingConfidence: best.confidence, updatedAt: Date.now() };
                changed = true;
              }
            }
          } catch {
            // scan error — keep sessions alive
          }
        }
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

  /** Kill a single PID via terminateProcessTree with retries. No name-based fallback. */
  const killPidSingleTarget = useCallback(
    async (gameKey: string, pid: number): Promise<boolean> => {
      for (let attempt = 1; attempt <= STOP_RETRY_MAX; attempt++) {
        try {
          const stillRunning = await isProcessRunning(pid);
          if (!stillRunning) {
            console.debug("[GameSession] process already dead", { gameKey, pid, attempt });
            return true;
          }
        } catch {
          // If check fails, proceed with kill
        }

        try {
          await terminateProcessTree(pid);
          console.debug("[GameSession] terminateProcessTree sent", { gameKey, pid, attempt });
        } catch (err) {
          console.warn("[GameSession] terminateProcessTree failed", { gameKey, pid, attempt, err });
        }

        await delay(STOP_RETRY_DELAY_MS);

        try {
          const alive = await isProcessRunning(pid);
          if (!alive) {
            console.debug("[GameSession] process confirmed dead", { gameKey, pid, attempt });
            return true;
          }
        } catch {
          // assume dead on check failure
          return true;
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

      let terminated = false;
      let lastError: string | null = null;
      let killedPid: number | null = null; // Track the actual PID that was killed

      // Ownership context: canonical paths for verifying PID identity before kill
      const ownedExePath = session.executablePath
        ? session.executablePath.replace(/\\/g, "/").toLowerCase()
        : "";
      const ownedInstallDir = session.installDir
        ? session.installDir.replace(/\\/g, "/").toLowerCase()
        : "";

      /**
       * Verify that a PID belongs to this game by checking its exe path against
       * known game exe/installDir. Returns true if the PID is owned by us.
       *
       * Relaxed mode (relaxed=true): when exe context exists but doesn't match,
       * still accept if the process is NOT in the excluded list (launcher/helper).
       * This handles Epic games where the manifest exe path may differ from the
       * actual running process (game moved, wrapper exe, etc.).
       */
      async function verifyPidOwnership(pid: number, relaxed = false): Promise<boolean> {
        if (!ownedExePath && !ownedInstallDir) return true; // no context → trust
        try {
          const all = await listProcesses();
          const proc = all.find((p) => p.pid === pid);
          if (!proc?.exe) return false;
          const pexe = proc.exe.replace(/\\/g, "/").toLowerCase();
          if (ownedExePath && pexe === ownedExePath) return true;
          if (ownedInstallDir && pexe.startsWith(ownedInstallDir)) return true;
          // Relaxed: accept if not a known excluded process
          if (relaxed) {
            const { isExcluded } = await import("../utils/gameProcessDetection");
            if (!isExcluded(proc.name)) return true;
          }
          return false;
        } catch {
          return true; // trust on check failure
        }
      }

      // ---- LAYER 1: Kill by stored PID (with ownership verification) ----
      const storedPid =
        session.pid != null && session.pid > 0 ? session.pid : null;
      if (storedPid != null) {
        try {
          const pidRunning = await isProcessRunning(storedPid);
          if (pidRunning) {
            // Try strict ownership first, then relaxed (exe path may differ from stored path
            // for Epic manifests, Steam games with wrapper exes, or moved installations)
            let owned = await verifyPidOwnership(storedPid);
            if (!owned) {
              owned = await verifyPidOwnership(storedPid, true);
              if (owned) {
                console.debug("[GameSession] stored PID passed relaxed ownership check", { gameKey, pid: storedPid });
              }
            }
            if (owned) {
              terminated = await killPidSingleTarget(gameKey, storedPid);
              if (terminated) killedPid = storedPid;
            } else {
              console.warn("[GameSession] stored PID failed ownership check", {
                gameKey,
                pid: storedPid,
              });
            }
          } else {
            console.debug("[GameSession] stored PID not running, session already dead", {
              gameKey,
              pid: storedPid,
            });
            terminated = true; // process already gone — clean up session
            killedPid = storedPid;
          }
        } catch {
          // If check fails, skip (do NOT kill blindly without ownership)
          console.warn("[GameSession] ownership check failed for stored PID", {
            gameKey,
            pid: storedPid,
          });
        }
      }

      // ---- LAYER 2: Scan for candidates via process detection (ownership-validated) ----
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
            candidates: allCandidates.map((c) => ({
              pid: c.pid,
              name: c.name,
              confidence: c.confidence,
              reason: c.reason,
            })),
          });

          for (const candidate of allCandidates) {
            if (candidate.pid === storedPid) continue; // already tried in layer 1
            if (candidate.confidence === "low") {
              console.debug("[GameSession] skipping low-confidence candidate", {
                gameKey,
                pid: candidate.pid,
                name: candidate.name,
                reason: candidate.reason,
              });
              continue; // never kill low-confidence without ownership proof
            }
            // Try strict ownership first, then relaxed (exe path may differ from stored path)
            let owned = await verifyPidOwnership(candidate.pid);
            if (!owned) {
              owned = await verifyPidOwnership(candidate.pid, true);
              if (owned) {
                console.debug("[GameSession] candidate passed relaxed ownership check", {
                  gameKey,
                  pid: candidate.pid,
                  name: candidate.name,
                });
              }
            }
            if (!owned) {
              console.warn("[GameSession] candidate failed ownership check", {
                gameKey,
                pid: candidate.pid,
                name: candidate.name,
              });
              continue;
            }
            const killed = await killPidSingleTarget(gameKey, candidate.pid);
            if (killed) {
              terminated = true;
              killedPid = candidate.pid;
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
          lastError = "Process scan failed";
        }
      }

      // ---- POST-KILL VERIFICATION ----
      if (terminated) {
        // Verify the actually-killed PID is dead, not the original storedPid
        // (Layer 2 may have killed a different PID than what was stored)
        const verifyPid = killedPid;
        if (verifyPid != null && verifyPid > 0) {
          await delay(300);
          try {
            const stillAlive = await isProcessRunning(verifyPid);
            if (stillAlive) {
              console.warn("[GameSession] post-kill verification failed — PID still alive", {
                gameKey,
                pid: verifyPid,
              });
              terminated = false;
              lastError = `PID ${verifyPid} still running after termination attempt`;
            }
          } catch {
            // Check failure — assume dead
          }
        }
      }

      console.debug("[GameSession] stopSession result", {
        gameKey,
        terminated,
        error: lastError,
      });

      if (terminated) {
        // Process confirmed dead — clean up session
        setSessions((prev) => {
          const next = { ...prev };
          delete next[gameKey];
          return next;
        });
      } else {
        // Do NOT clear session — keep Running with error so user sees the state
        console.warn("[GameSession] stop failed, keeping session running with error", {
          gameKey,
          error: lastError,
        });
        setSessions((prev) => {
          const existing = prev[gameKey];
          if (!existing) return prev;
          return {
            ...prev,
            [gameKey]: {
              ...existing,
              state: "running" as ActiveGameState,
              stopError: lastError ?? "Failed to terminate process",
              updatedAt: Date.now(),
            },
          };
        });
      }

      return { terminated };
    },
    [markStopping]
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
    /** Synchronous single-flight guard — prevents concurrent launchGame calls
     *  from passing the async state check before React batches the first setSessions.
     *  Set true at call start, cleared in all exit paths (success, error, cancel). */
    inFlight: boolean;
  }>({
    token: null,
    cancelled: false,
    guardTimer: null,
    dispatchTimer: null,
    scanTimeouts: [],
    launchTimeout: null,
    snapshotBefore: [],
    dispatched: false,
    inFlight: false,
  });

  // Stores image URL and display info per session key for overlay events
  const sessionMediaRef = useRef<Record<string, { imageUrl?: string; heroUrl?: string; iconUrl?: string; title: string; provider: string }>>({});

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

  // Check if Steam client is currently running
  const isSteamRunning = useCallback(async (): Promise<boolean> => {
    try {
      const processes = await listProcesses();
      return processes.some((p) => p.name?.toLowerCase() === "steam.exe");
    } catch {
      return false;
    }
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

          // Epic detection diagnostics — always log for debugging
          if (launchStateRef.current.token === token) {
            const source = sessionsRef.current[computedKey]?.source;
            if (source === "epic" || source === "debrid" || candidates.length > 0) {
              console.debug("[Launch][EPIC_SCAN]", {
                gameKey: computedKey,
                processCount: processes.length,
                candidateCount: candidates.length,
                best: best ? { pid: best.pid, name: best.name, confidence: best.confidence, exe: best.exe } : null,
                executablePath: game.executablePath ? game.executablePath.substring(0, 60) : "none",
                title: game.title,
                delayMs,
              });
            }
          }

          if (best) {
            if (ENABLE_VERBOSE_LAUNCH_LOGS) {
              console.debug("[Launch] candidate found, marking running", { gameKey: computedKey, pid: best.pid, confidence: best.confidence, score: best.score });
            }
            setSessions((prev) => {
              const existing = prev[computedKey];
              if (!existing) return prev;
              if (existing.state !== "launching") return prev;
              // PID ownership protection: don't replace a verified high-confidence PID
              // with a lower-scoring candidate (e.g. crash handler in install dir)
              if (existing.pid != null && existing.trackingConfidence === "high" && best.confidence !== "high") {
                if (ENABLE_VERBOSE_LAUNCH_LOGS) {
                  console.debug("[Launch] PID ownership protected — keeping existing", { gameKey: computedKey, existingPid: existing.pid, newCandidatePid: best.pid, newConfidence: best.confidence });
                }
                return prev;
              }
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
            launchStateRef.current.inFlight = false;
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

    // Synchronous single-flight guard — prevents concurrent calls from passing
    // the async state check before React batches the first setSessions.
    if (ls.inFlight) {
      console.debug("[Launch] blocked — launch already in flight", { source: game.source, title: game.title });
      return;
    }

    clearLaunchTimers();
    ls.cancelled = false;
    ls.dispatched = false;
    ls.inFlight = true;
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
      ls.inFlight = false;
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
    setSessions((prev) => {
      const existing = prev[computedKey];
      return {
        ...prev,
        [computedKey]: {
          ...existing,
          gameKey: computedKey,
          gameId: game.id,
          appId: game.appId,
          title: game.title,
          source: game.source === "steam" ? "steam" : game.source === "epic" ? "epic" : game.source === "debrid" ? "debrid" : game.source === "local" ? "local" : game.source === "manual" ? "manual" : game.source === "lua" ? "lua" : game.source === "emulator" ? "emulator" : "unknown",
          state: "launching",
          executablePath: game.executablePath,
          installDir: game.installDir,
          launchedAt: now,
          updatedAt: now,
        },
      };
    });

    // Store media info for overlay events + HUD

    // Helper: resolve a raw path (relative/absolute) to a full URL.
    // Uses resolveGameMediaUrl for relative "media/"/"img/" paths to resolve
    // against <appData>/games/<provider>/<appId>/ — NOT against appData root.
    const appIdStr = game.appId ? String(game.appId) : "";
    const _resolveMediaModule = await import("../services/gameCacheService");
    async function resolveUrl(raw?: string | null, provider?: string): Promise<string | undefined> {
      if (!raw) return undefined;
      if (raw.startsWith("http") || raw.startsWith("asset://") || raw.startsWith("data:") || raw.startsWith("file://")) return raw;
      try {
        if ((raw.startsWith("media/") || raw.startsWith("img/")) && appIdStr) {
          return await _resolveMediaModule.resolveGameMediaUrl(appIdStr, raw, provider || game.source || "steam") ?? undefined;
        }
        return await _resolveMediaModule.resolveProviderMediaPreviewUrl(raw) ?? undefined;
      } catch { return undefined; }
    }

    let imageUrl: string | undefined;   // landscape-first for overlay card (420×200, object-fit: cover)
    let heroUrl: string | undefined;    // landscape-first (summary overlay hero)
    let iconUrl: string | undefined;    // icon-first (HUD chip)

    if (game.source === "manual" && game.providerGameId) {
      // Manual games: resolve each role individually from ManualGameEntry
      const { getManualGame } = await import("../services/manualGameStore");
      const entry = getManualGame(game.providerGameId);

      // Resolve all paths in parallel (4 roles, non-critical on failure)
      const [_resolvedCover, resolvedLandscape, resolvedBackground, resolvedIcon] = await Promise.all([
        resolveUrl(entry?.coverPath, "steam"),
        resolveUrl(entry?.landscapePath, "steam"),
        resolveUrl(entry?.backgroundPath, "steam"),
        resolveUrl(entry?.iconPath, "steam"),
      ]);

      // HUD chip: icon first (compact thumbnail)
      iconUrl = resolvedIcon ?? resolvedLandscape ?? resolvedBackground;
      // Overlay card: landscape first, background second — NO cover
      heroUrl = resolvedLandscape ?? resolvedBackground;
    } else if (game.source === "emulator" && game.providerGameId) {
      // Emulator games: resolve each role individually from EmulatorGameEntry
      const { getEmulatorGame } = await import("../services/emulatorGameStore");
      const entry = getEmulatorGame(game.providerGameId);

      // Resolve all paths in parallel (4 roles, non-critical on failure)
      const [_resolvedCover, resolvedLandscape, resolvedBackground, resolvedIcon] = await Promise.all([
        resolveUrl(entry?.coverPath, "steam"),
        resolveUrl(entry?.landscapePath, "steam"),
        resolveUrl(entry?.backgroundPath, "steam"),
        resolveUrl(entry?.iconPath, "steam"),
      ]);

      // HUD chip: icon first (compact thumbnail)
      iconUrl = resolvedIcon ?? resolvedLandscape ?? resolvedBackground;
      // Overlay card: landscape first, background second — NO cover
      heroUrl = resolvedLandscape ?? resolvedBackground;
      imageUrl = resolvedLandscape ?? resolvedBackground;

      // Fallback: manual game with appId — local appinfo media (work offline)
      if (game.appId && (!imageUrl || !heroUrl || !iconUrl)) {
        try {
          const { loadGameAppInfoWithMediaFallback } = await import("../services/gameCacheService");
          const appInfo = await loadGameAppInfoWithMediaFallback(String(game.appId));
          if (appInfo?.media) {
            if (!imageUrl) imageUrl = await resolveUrl(appInfo.media.landscapePath || appInfo.media.backgroundPath, "steam");
            if (!heroUrl) heroUrl = await resolveUrl(appInfo.media.landscapePath || appInfo.media.backgroundPath, "steam");
            if (!iconUrl) iconUrl = await resolveUrl(appInfo.media.iconPath, "steam");
          }
        } catch { /* non-critical */ }
      }

      // Last resort: LibraryGame fields (may be HTTP URLs)
      if (!imageUrl) imageUrl = await resolveUrl(game.imageUrl, "steam");
      if (!heroUrl) heroUrl = await resolveUrl(game.backgroundPath || game.imageUrl, "steam");
      if (!iconUrl) iconUrl = await resolveUrl(game.iconPath, "steam");
    } else if (game.source === "epic" && game.providerGameId) {
      // Epic games: resolve each role from override store
      const { readEpicOverrides } = await import("../services/epicOverrideStore");
      const overrides = readEpicOverrides(game.providerGameId);

      const [_resolvedCover, resolvedLandscape, resolvedBackground, resolvedIcon] = await Promise.all([
        resolveUrl(overrides?.coverPath, "epic"),
        resolveUrl(overrides?.landscapePath, "epic"),
        resolveUrl(overrides?.backgroundPath, "epic"),
        resolveUrl(overrides?.iconPath, "epic"),
      ]);

      iconUrl = resolvedIcon ?? resolvedLandscape ?? resolvedBackground;
      heroUrl = resolvedLandscape ?? resolvedBackground;
      imageUrl = resolvedLandscape ?? resolvedBackground;
    } else if (game.source === "debrid") {
      // Debrid games: prefer local media (work offline), fall back to Steam CDN.
      const { buildSteamCdnUrl, loadGameAppInfoWithMediaFallback } = await import("../services/gameCacheService");
      const cdnHero = appIdStr ? buildSteamCdnUrl(appIdStr, "hero") ?? undefined : undefined;
      const cdnCapsule = appIdStr ? buildSteamCdnUrl(appIdStr, "capsule") ?? undefined : undefined;
      const cdnLogo = appIdStr ? buildSteamCdnUrl(appIdStr, "logo") ?? undefined : undefined;

      // Try local media files first (downloaded by artwork refresh)
      if (appIdStr) {
        try {
          const appInfo = await loadGameAppInfoWithMediaFallback(appIdStr);
          if (appInfo?.media) {
            imageUrl = await resolveUrl(appInfo.media.landscapePath || appInfo.media.backgroundPath, "steam");
            heroUrl = await resolveUrl(appInfo.media.landscapePath || appInfo.media.backgroundPath, "steam");
            iconUrl = await resolveUrl(appInfo.media.iconPath, "steam");
          }
        } catch { /* non-critical */ }
      }
      // Fallback to CDN URLs (require internet)
      if (!imageUrl) {
        const rawBestUrl = game.metadata?.header_image || game.metadata?.background_image || game.metadata?.library_hero_image || game.metadata?.hero_image || game.metadata?.capsule_image_v5 || game.imageUrl || cdnCapsule || cdnHero || undefined;
        imageUrl = (await resolveUrl(rawBestUrl, "steam")) ?? cdnCapsule ?? cdnHero;
      }
      if (!heroUrl) {
        const rawBestUrl = game.metadata?.header_image || game.metadata?.background_image || game.metadata?.library_hero_image || game.metadata?.hero_image || game.metadata?.capsule_image_v5 || game.imageUrl || cdnHero || cdnCapsule || undefined;
        heroUrl = (await resolveUrl(rawBestUrl, "steam")) ?? cdnHero ?? cdnCapsule;
      }
      if (!iconUrl) iconUrl = (await resolveUrl(game.iconPath, "steam")) ?? cdnLogo ?? imageUrl;
    } else {
      // Steam / Local: prefer local media files (work offline), fall back to metadata HTTP URLs
      const { loadGameAppInfoWithMediaFallback } = await import("../services/gameCacheService");
      if (appIdStr) {
        try {
          const appInfo = await loadGameAppInfoWithMediaFallback(appIdStr);
          if (appInfo?.media) {
            imageUrl = await resolveUrl(appInfo.media.landscapePath || appInfo.media.backgroundPath, "steam");
            heroUrl = await resolveUrl(appInfo.media.landscapePath || appInfo.media.backgroundPath, "steam");
            iconUrl = await resolveUrl(appInfo.media.iconPath, "steam");
          }
        } catch { /* non-critical */ }
      }
      // Fallback to metadata HTTP URLs (require internet)
      if (!imageUrl) {
        const rawBestUrl = game.metadata?.header_image || game.metadata?.background_image || game.metadata?.library_hero_image || game.metadata?.hero_image || game.metadata?.capsule_image_v5 || game.imageUrl || undefined;
        imageUrl = await resolveUrl(rawBestUrl, "steam");
      }
      if (!heroUrl) heroUrl = imageUrl;
      if (!iconUrl) iconUrl = await resolveUrl(game.iconPath, "steam");
    }

    const providerLabel = game.source === "steam" ? "Steam" : game.source === "epic" ? "Epic" : game.source === "debrid" ? "Debrid" : game.source === "local" ? "Local" : game.source === "manual" ? "Manual" : game.source === "lua" ? "Lua" : game.source === "emulator" ? "Emulator" : "Unknown";
    sessionMediaRef.current[computedKey] = { imageUrl, heroUrl, iconUrl, title: game.title, provider: providerLabel };

    // Timeout guard — prevents infinite launching
    // Epic needs longer: extended scan runs up to ~55s; use 65s guard
    // Steam cold-start: initialWait 5s + scans up to 15s = ~35s total; use 45s guard
    const isEpicSource = game.source === "epic";
    const guardTimeoutMs = isEpicSource ? 65000 : game.source === "steam" ? 45000 : 30000;
    ls.guardTimer = setTimeout(() => {
      ls.guardTimer = null;
      if (ls.token === token && !ls.cancelled) {
        const s = sessionsRef.current[computedKey];
        if (s?.state === "launching") {
          if (ENABLE_VERBOSE_LAUNCH_LOGS) {
            console.debug("[Launch] timeout — guard, forcing", { gameKey: computedKey, isEpic: isEpicSource, timeoutMs: guardTimeoutMs });
          }
          setSessions((prev) => {
            const existing = prev[computedKey];
            if (!existing || existing.state !== "launching") return prev;
            return {
              ...prev,
              [computedKey]: { ...existing, state: "running" as ActiveGameState, softSession: true, trackingConfidence: "none", updatedAt: Date.now() },
            };
          });
          ls.inFlight = false;
        }
      }
    }, guardTimeoutMs);

    // Delayed dispatch so Cancel can abort
    const dispatchDelayMs = game.source === "steam" ? 1500 : game.source === "epic" ? 1500 : game.source === "debrid" ? 800 : 800;
    ls.dispatchTimer = setTimeout(async () => {
      ls.dispatchTimer = null;
          if (ls.cancelled || ls.token !== token) return;

          ls.dispatched = true;
          if (ENABLE_VERBOSE_LAUNCH_LOGS) {
            console.debug("[Launch] backend response", { gameKey: computedKey });
          }

          try {
            if (game.source === "steam" && game.isStandalone) {
              // Standalone mode: launch exe directly (no Steam)
              let effectiveExePath = game.executablePath?.trim().replace(/^["']|["']$/g, "");
              if (!effectiveExePath && game.installDir) {
                // Fallback: discover exe from install dir via Rust
                try {
                  const { libraryGetGameFixInfo } = await import("../services/tauri");
                  const fixInfo = await libraryGetGameFixInfo({
                    appId: Number(game.appId), name: game.title,
                    installDir: game.installDir, hasLua: !!game.hasLua, luaCount: game.luaScripts?.length ?? 0,
                  });
                  if (fixInfo.exeName) {
                    effectiveExePath = fixInfo.exeName;
                    console.debug("[Launch] standalone exe discovered", { gameKey: computedKey, exePath: fixInfo.exeName });
                  }
                } catch (err) {
                  console.warn("[Launch] standalone exe discovery failed", err);
                }
              }
              if (!effectiveExePath) {
                console.warn("[Launch] standalone mode but no executable found", { gameKey: computedKey });
                showError("No se encontró el ejecutable. Abrí Configuración > Game Fixes para detectarlo.");
                setSessions((prev) => { const next = { ...prev }; delete next[computedKey]; return next; });
                ls.inFlight = false;
                return;
              }
              const workingDir = game.installDir || effectiveExePath.substring(0, effectiveExePath.lastIndexOf("\\"));
              const result = await launchExecutable(effectiveExePath, undefined, workingDir || undefined);
              if (ls.cancelled || ls.token !== token) {
                if (result.pid) { try { await terminateProcess(result.pid); } catch { /* ignore */ } }
                return;
              }
              if (result.pid) {
                console.debug("[Launch] standalone process spawned", { gameKey: computedKey, pid: result.pid });
                setSessions((prev) => {
                  const existing = prev[computedKey];
                  if (!existing) return prev;
                  return {
                    ...prev,
                    [computedKey]: { ...existing, state: "running", pid: result.pid, softSession: false, trackingConfidence: "high", processName: extractExeName(effectiveExePath), updatedAt: Date.now() },
                  };
                });
                ls.inFlight = false;
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
                  ls.inFlight = false;
                }
              }
            } else if (game.source === "steam" && game.appId) {
              await launchSteamApp(Number(game.appId), loadSettings().steamRoot || undefined);
              if (ls.cancelled || ls.token !== token) {
                ls.inFlight = false;
                return;
              }

          if (ENABLE_VERBOSE_LAUNCH_LOGS) {
            console.debug("[Launch] running", { gameKey: computedKey });
          }

          ls.launchTimeout = setTimeout(async () => {
            ls.launchTimeout = null;
            if (ls.token !== token || ls.cancelled) return;

            // Detect if Steam client is running to adjust scan timing
            const steamOpen = await isSteamRunning();
            if (ENABLE_VERBOSE_LAUNCH_LOGS) {
              console.debug("[Launch] steam client running", { gameKey: computedKey, steamOpen });
            }

            // Cold start: Steam needs time to open + launch game → more scans, longer delays
            // Already open: Steam just needs to launch game → fewer scans, shorter delays
            const scanDelays = steamOpen ? [0, 3000, 5000] : [0, 3000, 6000, 10000, 15000];
            const initialWait = steamOpen ? 2000 : 5000;

            // Wait before first scan (gives Steam time to cold-start)
            await new Promise<void>((r) => {
              ls.scanTimeouts.push(setTimeout(r, initialWait));
            });
            if (ls.token !== token || ls.cancelled) return;

            for (const delay of scanDelays) {
              await scanForProcessAfterLaunch(computedKey, game, token, delay);
              if (sessionsRef.current[computedKey]?.state === "running") break;
            }

            // Force soft session if still launching after all scans
            if (ls.token === token && !ls.cancelled && sessionsRef.current[computedKey]?.state === "launching") {
              if (ENABLE_VERBOSE_LAUNCH_LOGS) {
                console.debug("[Launch] no process detected, marking soft session", { gameKey: computedKey, steamOpen });
              }
              setSessions((prev) => {
                const existing = prev[computedKey];
                if (!existing || existing.state !== "launching") return prev;
                return {
                  ...prev,
                  [computedKey]: { ...existing, state: "running" as ActiveGameState, softSession: true, trackingConfidence: "none", updatedAt: Date.now() },
                };
              });
              ls.inFlight = false;
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
                }).catch((err) => console.warn(err));
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
            ls.inFlight = false;
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
              ls.inFlight = false;
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
            ls.inFlight = false;
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
              ls.inFlight = false;
            }
          }
        } else if (game.source === "lua" && game.executablePath) {
          const exePath = game.executablePath.trim().replace(/^["']|["']$/g, "");
          const workingDir = exePath.substring(0, exePath.lastIndexOf("\\"));
          console.log(`[Launch][LUA] appid=${game.appId} exe="${exePath}" workDir="${workingDir}"`);

          const result = await launchExecutable(exePath, undefined, workingDir || undefined);
          if (ls.cancelled || ls.token !== token) {
            if (result.pid) {
              try { await terminateProcess(result.pid); } catch { /* ignore */ }
            }
            return;
          }

          if (result.pid) {
            if (ENABLE_VERBOSE_LAUNCH_LOGS) {
              console.debug("[Launch] lua process spawned", { gameKey: computedKey, pid: result.pid });
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
            ls.inFlight = false;
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
              ls.inFlight = false;
            }
          }
        } else if (game.source === "debrid") {
          // Debrid games: direct executable launch (no protocol)
          const result = await dispatchProviderLaunch(game);
          if (ls.cancelled || ls.token !== token) {
            if (result.pid) {
              try { await terminateProcess(result.pid); } catch { /* ignore */ }
            }
            return;
          }

          if (result.dispatched) {
            if (ENABLE_VERBOSE_LAUNCH_LOGS) {
              console.debug("[Launch] debrid dispatched", { gameKey: computedKey, method: result.method, pid: result.pid ?? null });
            }

            // Direct executable reported a PID — high-confidence running, no scan needed
            if (result.pid) {
              const processName = game.executablePath ? extractExeName(game.executablePath) : undefined;
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
                    processName,
                    updatedAt: Date.now(),
                  },
                };
              });
              ls.inFlight = false;
              return;
            }

            // No PID reported — scan for process with simple delays (direct executable, fast launch)
            const DEBRID_SCAN_DELAYS = [2000, 3000, 5000];
            ls.launchTimeout = setTimeout(async () => {
              ls.launchTimeout = null;
              if (ls.token !== token || ls.cancelled) return;

              for (const delayMs of DEBRID_SCAN_DELAYS) {
                if (ls.token !== token || ls.cancelled) return;
                await scanForProcessAfterLaunch(computedKey, game, token, delayMs);
                if (sessionsRef.current[computedKey]?.state === "running") {
                  return; // process detected — done
                }
              }

              // No process detected — fall back to soft session
              if (ls.token === token && !ls.cancelled && sessionsRef.current[computedKey]?.state === "launching") {
                if (ENABLE_VERBOSE_LAUNCH_LOGS) {
                  console.debug("[Launch] no debrid process detected, marking soft session", { gameKey: computedKey });
                }
                setSessions((prev) => {
                  const existing = prev[computedKey];
                  if (!existing || existing.state !== "launching") return prev;
                  return {
                    ...prev,
                    [computedKey]: { ...existing, state: "running" as ActiveGameState, softSession: true, trackingConfidence: "none", updatedAt: Date.now() },
                  };
                });
                ls.inFlight = false;
              }
            }, 2000);
          } else {
            // Launch failed — set error state so UI can display message
            if (ENABLE_VERBOSE_LAUNCH_LOGS) {
              console.debug("[Launch] debrid failed", { gameKey: computedKey, error: result.error });
            }
            setSessions((prev) => {
              const existing = prev[computedKey];
              if (!existing) return prev;
              return {
                ...prev,
                [computedKey]: {
                  ...existing,
                  state: "error" as ActiveGameState,
                  errorMessage: result.error ?? "Cannot launch this Debrid game.",
                  updatedAt: Date.now(),
                },
              };
            });
            ls.inFlight = false;
          }
        } else if (game.source === "epic") {
          // Epic protocol or direct executable launch
          // Extended scan window: Epic Launcher needs time to authenticate + start game
          const EPIC_SCAN_DELAYS = [0, 3000, 5000, 10000, 15000, 20000];
          const result = await dispatchProviderLaunch(game);
          if (ls.cancelled || ls.token !== token) return;

          if (result.dispatched) {
            if (ENABLE_VERBOSE_LAUNCH_LOGS) {
              console.debug("[Launch] epic dispatched", { gameKey: computedKey, method: result.method });
            }

            // Cold-launch retry: if no process found after 10s, re-dispatch once
            let retriedColdLaunch = false;

            ls.launchTimeout = setTimeout(async () => {
              ls.launchTimeout = null;
              if (ls.token !== token || ls.cancelled) return;

              for (const delayMs of EPIC_SCAN_DELAYS) {
                if (ls.token !== token || ls.cancelled) return;
                await scanForProcessAfterLaunch(computedKey, game, token, delayMs);
                if (sessionsRef.current[computedKey]?.state === "running") {
                  return;
                }
                if (!retriedColdLaunch && delayMs >= 10000 && sessionsRef.current[computedKey]?.state === "launching") {
                  retriedColdLaunch = true;
                  if (ENABLE_VERBOSE_LAUNCH_LOGS) {
                    console.debug("[Launch] epic cold-launch retry", { gameKey: computedKey });
                  }
                  try {
                    await dispatchProviderLaunch(game);
                  } catch {
                    // Non-critical
                  }
                }
              }

              if (ls.token === token && !ls.cancelled && sessionsRef.current[computedKey]?.state === "launching") {
                if (ENABLE_VERBOSE_LAUNCH_LOGS) {
                  console.debug("[Launch] no epic process detected after extended scan", { gameKey: computedKey });
                }
                setSessions((prev) => {
                  const existing = prev[computedKey];
                  if (!existing || existing.state !== "launching") return prev;
                  return {
                    ...prev,
                    [computedKey]: {
                      ...existing,
                      state: "error" as ActiveGameState,
                      errorMessage: "Game did not start. The Epic Games Launcher may need authentication or a restart.",
                      updatedAt: Date.now(),
                    },
                  };
                });
                ls.inFlight = false;
              }
            }, 2000);
          } else {
            if (ENABLE_VERBOSE_LAUNCH_LOGS) {
              console.debug("[Launch] epic failed", { gameKey: computedKey, error: result.error });
            }
            setSessions((prev) => {
              const existing = prev[computedKey];
              if (!existing) return prev;
              return {
                ...prev,
                [computedKey]: {
                  ...existing,
                  state: "error" as ActiveGameState,
                  errorMessage: result.error ?? "Cannot launch this Epic game.",
                  updatedAt: Date.now(),
                },
              };
            });
            ls.inFlight = false;
          }
        } else if (game.source === "emulator") {
          const result = await dispatchProviderLaunch(game);
          if (ls.cancelled || ls.token !== token) return;

          if (result.dispatched) {
            if (ENABLE_VERBOSE_LAUNCH_LOGS) {
              console.debug("[Launch] emulator dispatched", { gameKey: computedKey, method: result.method, pid: result.pid });
            }

            // Direct PID tracking — launch_executable_str uses CreateProcessW and returns real PID
            if (result.pid) {
              const processName = game.executablePath ? extractExeName(game.executablePath) : undefined;
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
                    processName,
                    updatedAt: Date.now(),
                  },
                };
              });
              ls.inFlight = false;
              return;
            }

            // No PID — fall back to soft session
            ls.launchTimeout = setTimeout(() => {
              if (ls.token !== token || ls.cancelled) return;
              setSessions((prev) => {
                const existing = prev[computedKey];
                if (!existing || existing.state !== "launching") return prev;
                return {
                  ...prev,
                  [computedKey]: { ...existing, state: "running" as ActiveGameState, softSession: true, trackingConfidence: "none", updatedAt: Date.now() },
                };
              });
              ls.inFlight = false;
            }, 2000);
          } else {
            if (ENABLE_VERBOSE_LAUNCH_LOGS) {
              console.debug("[Launch] emulator failed", { gameKey: computedKey, error: result.error });
            }
            setSessions((prev) => {
              const existing = prev[computedKey];
              if (!existing) return prev;
              return {
                ...prev,
                [computedKey]: {
                  ...existing,
                  state: "error" as ActiveGameState,
                  errorMessage: result.error ?? "Cannot launch this emulator game.",
                  updatedAt: Date.now(),
                },
              };
            });
            ls.inFlight = false;
          }
        } else {
          console.warn("[Launch] cannot determine launch method", { gameKey: computedKey });
          setSessions((prev) => {
            const next = { ...prev };
            delete next[computedKey];
            return next;
          });
          ls.inFlight = false;
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
        ls.inFlight = false;
      }
    }, dispatchDelayMs);
  }, [clearLaunchTimers, scanForProcessAfterLaunch]);

  const cancelLaunch = useCallback(async (gameKey: string) => {
    const ls = launchStateRef.current;
    const currentState = sessionsRef.current[gameKey]?.state;
    if (currentState !== "launching") {
      ls.inFlight = false;
      return;
    }

    if (ls.dispatched) {
      // For Epic: protocol dispatched but game may not start — clean up, not soft running.
      // Prevents false playtime/session history when game was never actually detected.
      const sessionSource = sessionsRef.current[gameKey]?.source;
      if (sessionSource === "epic") {
        if (ENABLE_VERBOSE_LAUNCH_LOGS) {
          console.debug("[Launch] cancel requested after epic dispatch — cleaning up", { gameKey });
        }
        ls.cancelled = true;
        ls.token = null;
        clearLaunchTimers();
        setSessions((prev) => {
          const next = { ...prev };
          delete next[gameKey];
          return next;
        });
        ls.inFlight = false;
        return;
      }
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
      ls.inFlight = false;
      return;
    }

    if (ENABLE_VERBOSE_LAUNCH_LOGS) {
      console.debug("[Launch] stop requested", { gameKey, processId: sessionsRef.current[gameKey]?.pid });
    }

    ls.cancelled = true;
    ls.token = null;
    clearLaunchTimers();
    ls.inFlight = false;

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
    // Match by appId (Steam), gameKey/id (Epic/manual), or gameId (provider game id)
    for (const [key, s] of Object.entries(sessionsRef.current)) {
      if (s.appId === appId || s.gameId === appId || s.gameKey === appId || key === appId) {
        return stopSession(key);
      }
    }
    // For Epic: also try matching as providerGameId substring in the key
    for (const [key, s] of Object.entries(sessionsRef.current)) {
      if (s.source === "epic" && s.gameKey?.includes(appId)) {
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
            discoverAndRegister(key, curSession.installDir, curSession.title, "steam").catch((err) => console.warn(err));
          }

          const mediaInfo = sessionMediaRef.current[key];
          const provider = curSession.source === "steam" ? "Steam" : curSession.source === "epic" ? "Epic" : curSession.source === "debrid" ? "Debrid" : curSession.source === "local" ? "Local" : curSession.source === "manual" ? "Manual" : curSession.source === "emulator" ? "Emulator" : "Unknown";
          setOverlayEvent({
            id: `launch-${key}-${curSession.updatedAt}`,
            type: "launch",
            gameTitle: curSession.title || "Unknown Game",
            provider,
            imageUrl: mediaInfo?.imageUrl,
            heroUrl: mediaInfo?.heroUrl,
            iconUrl: mediaInfo?.iconUrl,
          });

          // Emit game-launched activity event for Activity Feed
          pushActivityEvent({
            gameId: curSession.gameId || key,
            appId: curSession.appId,
            kind: "game-launched",
            title: curSession.title || "Unknown Game",
            source: "local",
            severity: "info",
          });

          // Start playtime session
          const ptProvider = curSession.source === "steam" ? "steam" : curSession.source === "epic" ? "epic" : curSession.source === "debrid" ? "debrid" : curSession.source === "local" ? "local" : curSession.source === "manual" ? "manual" : curSession.source === "emulator" ? "emulator" : "unknown";
          startPlaySession({
            gameKey: key,
            appId: curSession.appId,
            provider: ptProvider,
            title: curSession.title || "Unknown Game",
            startedAt: Math.floor(Date.now() / 1000),
          }).then((activeSession) => {
            activePlaySessionsRef.current[key] = activeSession.sessionId;
            // startPlaySession already patched app-{appId} atomically.
            // Create canonical entry if it doesn't exist yet (first launch of a game with no prior import).
            const cached = getCachedPlaytimeStore();
            if (cached) {
              const now = Math.floor(Date.now() / 1000);
              const canonicalKey = curSession.appId ? `app-${curSession.appId}` : key;
              if (!cached.games[canonicalKey] && curSession.appId) {
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
              if (key !== canonicalKey && cached.games[key]) {
                cached.games[key].lastPlayedAt = now;
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
        const provider = prevSession.source === "steam" ? "Steam" : prevSession.source === "epic" ? "Epic" : prevSession.source === "debrid" ? "Debrid" : prevSession.source === "local" ? "Local" : prevSession.source === "manual" ? "Manual" : prevSession.source === "emulator" ? "Emulator" : "Unknown";
        setOverlayEvent({
          id: `end-${key}-${Date.now()}`,
          type: "end",
          gameTitle: prevSession.title || "Unknown Game",
          provider,
          imageUrl: mediaInfo?.imageUrl,
          heroUrl: mediaInfo?.heroUrl,
          iconUrl: mediaInfo?.iconUrl,
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
            const activitySource = prevSession.source === "steam" ? "steam" : prevSession.source === "epic" ? "epic" : prevSession.source === "debrid" ? "debrid" : prevSession.source === "local" ? "local" : prevSession.source === "manual" ? "manual" : prevSession.source === "emulator" ? "emulator" : "system";
            // Store appId matching resolvePlaytimeKey format so stats can match:
            // Steam: "app-{appId}", Manual/Debrid/Epic: gameKey (e.g. "manual:uuid", "debrid:rep-id")
            const sessionAppId = (prevSession.source === "steam" && prevSession.appId)
              ? `app-${prevSession.appId}`
              : (prevSession.gameKey || key);
            // Reuse the session ID from record_play_session_start so ON CONFLICT updates the existing row.
            // sessionId was captured at line 1773 before the ref was deleted.
            const sessionRecord: GameSession = {
              sessionId: sessionId || crypto.randomUUID(),
              gameId: sessionAppId,
              startedAt: Math.floor(prevSession.launchedAt / 1000),
              endedAt: Math.floor(Date.now() / 1000),
              durationSeconds,
              exitReason,
              source: activitySource,
            };
            // Persist session record to SQLite (fire-and-forget)
            upsertGameSession(sessionRecord).then(() => {
              console.log(`[SESSION_HISTORY] recorded appid=${prevSession.appId} duration=${durationSeconds}s id=${sessionRecord.sessionId}`);
            }).catch(() => {});
            console.log(`[SESSION_HISTORY] queued appid=${prevSession.appId} duration=${durationSeconds}s id=${sessionRecord.sessionId}`);

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
            const sessionPlatform = (await import("../services/achievementAutoSyncService")).achievementAutoSyncService.getPlatform(stoppedAppId);

            // Attempt 1: immediate read
            await attemptAchievementRefresh(stoppedAppId, sessionPlatform);

            // Phase 6: Schedule snapshot write for playtime changes
            try {
              const { notifyMediaUpdated } = await import("../services/startupSnapshotService");
              const cached = getCachedPlaytimeStore();
              const ptEntry = cached?.games[`app-${stoppedAppId}`];
              if (ptEntry) {
                console.log(`[ACTIVITY][PLAYTIME_UPDATED] appid=${stoppedAppId} external=${ptEntry.externalPlaytimeSeconds} local=${ptEntry.localPlaytimeSeconds} total=${ptEntry.totalPlaytimeSeconds} source=${ptEntry.playtimeSource}`);
              }
              // Schedule snapshot for playtime change
              notifyMediaUpdated(stoppedAppId, { source: "playtime-changed" }).catch((err) => console.warn(err));
              console.log(`[BootSnapshot][SCHEDULE] reason=playtime-changed appid=${stoppedAppId}`);
            } catch (snapErr) {
              console.warn("[PLAYTIME] snapshot schedule failed", String(snapErr));
            }

            // Retry 2: after 5 seconds
            await delay(5000);
            console.log(`[ACH][SESSION_STOP_REFRESH_RETRY] appid=${stoppedAppId} delayMs=5000`);
            await attemptAchievementRefresh(stoppedAppId, sessionPlatform).catch((err) => console.warn(err));

            // Retry 3: after 20 seconds
            await delay(20000);
            console.log(`[ACH][SESSION_STOP_REFRESH_RETRY] appid=${stoppedAppId} delayMs=20000`);
            await attemptAchievementRefresh(stoppedAppId, sessionPlatform).catch((err) => console.warn(err));
          })();
        } else if (stoppedAppId && durationSeconds < 15) {
          console.log(`[PLAYTIME][SESSION_DURATION_SKIP] appid=${stoppedAppId} seconds=${durationSeconds} threshold=15 lastPlayedKept=true`);
          // Clear session watch even for short sessions
        }
      }
    }

    prevSessionsRef.current = sessions;
  }, [sessions]);

  // Stable getter for resolved session media (reads from ref — safe, no hooks inside)
  const getSessionMedia = useCallback(
    (gameKey: string) => sessionMediaRef.current[gameKey],
    [],
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
      launchGame,
      cancelLaunch,
      findRunningSessionKey,
      stopGameByAppId,
      overlayEvent,
      clearOverlay,
      getSessionMedia,
    }),
    [sessions, getSession, getState, startLaunching, markRunning, markStopping, clearSession, updateSessionPid, stopSession, findGameProcessForSession, recordPlaytime, launchGame, cancelLaunch, findRunningSessionKey, stopGameByAppId, overlayEvent, clearOverlay, getSessionMedia]
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
