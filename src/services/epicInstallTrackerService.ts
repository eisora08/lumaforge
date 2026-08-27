import { checkEpicGameInstalled } from "./tauri";

export type EpicInstallStatus = "idle" | "waiting" | "detecting" | "installed" | "timeout" | "dismissed";

export type EpicInstallState = {
  appName: string;
  title?: string;
  artworkUrl?: string;
  status: EpicInstallStatus;
  elapsedMs: number;
  startedAt: number;
  installLocation?: string;
};

type EpicInstallListener = (state: EpicInstallState) => void;
type EpicInstalledHandler = (appName: string) => void;

const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 5 * 60 * 1000;
const ELAPSED_UPDATE_INTERVAL_MS = 1000;

class EpicInstallTrackerService {
  private _states = new Map<string, EpicInstallState>();
  private _pollIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private _elapsedIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private _listeners = new Map<string, Set<EpicInstallListener>>();
  private _globalListeners = new Set<(appName: string, state: EpicInstallState) => void>();
  private _installedHandlers = new Set<EpicInstalledHandler>();

  onInstalled(handler: EpicInstalledHandler): () => void {
    this._installedHandlers.add(handler);
    return () => { this._installedHandlers.delete(handler); };
  }

  subscribe(appName: string, fn: EpicInstallListener): () => void {
    if (!this._listeners.has(appName)) {
      this._listeners.set(appName, new Set());
    }
    this._listeners.get(appName)!.add(fn);
    const current = this._states.get(appName);
    if (current) {
      try { fn(current); } catch { /* ignore */ }
    }
    return () => {
      this._listeners.get(appName)?.delete(fn);
    };
  }

  onAny(fn: (appName: string, state: EpicInstallState) => void): () => void {
    this._globalListeners.add(fn);
    return () => { this._globalListeners.delete(fn); };
  }

  getState(appName: string): EpicInstallState | undefined {
    return this._states.get(appName);
  }

  isTracking(appName: string): boolean {
    return this._pollIntervals.has(appName);
  }

  async startTracking(appName: string, title?: string, artworkUrl?: string): Promise<void> {
    if (this._pollIntervals.has(appName)) {
      console.log(`[EPIC_INSTALL_TRACK] already tracking appName=${appName}`);
      return;
    }

    const now = Date.now();
    const state: EpicInstallState = {
      appName,
      title,
      artworkUrl,
      status: "waiting",
      elapsedMs: 0,
      startedAt: now,
    };
    this._states.set(appName, state);
    this._notify(appName, state);

    // Elapsed timer
    const elapsedInterval = setInterval(() => {
      const s = this._states.get(appName);
      if (!s || s.status === "installed" || s.status === "dismissed" || s.status === "timeout") return;
      s.elapsedMs = Date.now() - s.startedAt;
      this._notify(appName, s);
    }, ELAPSED_UPDATE_INTERVAL_MS);
    this._elapsedIntervals.set(appName, elapsedInterval);

    // After2s, transition to "detecting"
    setTimeout(() => {
      const s = this._states.get(appName);
      if (s && s.status === "waiting") {
        s.status = "detecting";
        this._notify(appName, s);
      }
    }, 2000);

    // Poll
    const poll = setInterval(async () => {
      const s = this._states.get(appName);
      if (!s || s.status === "installed" || s.status === "dismissed" || s.status === "timeout") {
        this._stopPolling(appName);
        return;
      }

      // Timeout check
      if (Date.now() - s.startedAt > TIMEOUT_MS) {
        s.status = "timeout";
        s.elapsedMs = TIMEOUT_MS;
        this._notify(appName, s);
        this._stopPolling(appName);
        return;
      }

      try {
        const result = await checkEpicGameInstalled(appName);
        if (result.isInstalled) {
          s.status = "installed";
          s.installLocation = result.installLocation;
          s.elapsedMs = Date.now() - s.startedAt;
          this._notify(appName, s);
          this._stopPolling(appName);
          // Notify installed handlers
          for (const handler of this._installedHandlers) {
            try { handler(appName); } catch { /* ignore */ }
          }
        }
      } catch (err) {
        console.warn(`[EPIC_INSTALL_TRACK] poll error for ${appName}:`, err);
      }
    }, POLL_INTERVAL_MS);
    this._pollIntervals.set(appName, poll);
  }

  dismiss(appName: string): void {
    const s = this._states.get(appName);
    if (s) {
      s.status = "dismissed";
      this._notify(appName, s);
    }
    this._stopPolling(appName);
  }

  stopTracking(appName: string): void {
    this._stopPolling(appName);
    this._states.delete(appName);
  }

  private _stopPolling(appName: string): void {
    const interval = this._pollIntervals.get(appName);
    if (interval) {
      clearInterval(interval);
      this._pollIntervals.delete(appName);
    }
    const elapsed = this._elapsedIntervals.get(appName);
    if (elapsed) {
      clearInterval(elapsed);
      this._elapsedIntervals.delete(appName);
    }
  }

  private _notify(appName: string, state: EpicInstallState): void {
    const listeners = this._listeners.get(appName);
    if (listeners) {
      for (const fn of listeners) {
        try { fn(state); } catch { /* ignore */ }
      }
    }
    for (const fn of this._globalListeners) {
      try { fn(appName, state); } catch { /* ignore */ }
    }
  }
}

export const epicInstallTrackerService = new EpicInstallTrackerService();
