import { checkSteamGameInstalled, type DownloadProgress } from "./tauri";

export type InstallStatus = "idle" | "opening-steam" | "waiting" | "installing" | "installed" | "timeout" | "dismissed";

export type InstallState = {
  appId: string;
  title?: string;
  artworkUrl?: string;
  status: InstallStatus;
  elapsedMs: number;
  startedAt: number;
  downloadProgress: DownloadProgress | null;
  sizeOnDisk?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
};

type InstallListener = (state: InstallState) => void;
type InstalledHandler = (appId: string) => void;

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 5 * 60 * 1000;
const ELAPSED_UPDATE_INTERVAL_MS = 1000;

class InstallTrackerService {
  private _states = new Map<string, InstallState>();
  private _pollIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private _elapsedIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private _listeners = new Map<string, Set<InstallListener>>();
  private _globalListeners = new Set<(appId: string, state: InstallState) => void>();
  private _installedHandlers = new Set<InstalledHandler>();
  // Track previous poll bytes + timestamp for speed/ETA calculation
  private _lastBytes = new Map<string, { bytesDownloaded: number; ts: number }>();

  onInstalled(handler: InstalledHandler): () => void {
    this._installedHandlers.add(handler);
    return () => { this._installedHandlers.delete(handler); };
  }

  subscribe(appId: string, fn: InstallListener): () => void {
    if (!this._listeners.has(appId)) {
      this._listeners.set(appId, new Set());
    }
    this._listeners.get(appId)!.add(fn);
    // Immediately call back with current state if any
    const current = this._states.get(appId);
    if (current) {
      try { fn(current); } catch { /* ignore */ }
    }
    return () => {
      this._listeners.get(appId)?.delete(fn);
    };
  }

  onAny(fn: (appId: string, state: InstallState) => void): () => void {
    this._globalListeners.add(fn);
    return () => { this._globalListeners.delete(fn); };
  }

  getState(appId: string): InstallState | undefined {
    return this._states.get(appId);
  }

  async startTracking(appId: string, steamRoot?: string | null, title?: string, artworkUrl?: string): Promise<void> {
    if (this._pollIntervals.has(appId)) {
      console.log(`[INSTALL_TRACK] already tracking appid=${appId}`);
      return;
    }

    const _steamRoot = steamRoot ?? null;

    const now = Date.now();
    const state: InstallState = {
      appId,
      title,
      artworkUrl,
      status: "opening-steam",
      elapsedMs: 0,
      startedAt: now,
      downloadProgress: null,
    };
    console.log(`[DOWNLOAD_JOB_META] appid=${appId} title="${title ?? appId}" artworkSource=${artworkUrl ? "provided" : "fallback"}`);
    this._states.set(appId, state);
    this._notify(appId);

    // Caller already opened steam://install/<appid> — we only track progress
    console.log(`[INSTALL_TRACK] tracking started for appid=${appId}`);

    // Move to waiting state after a short delay
    setTimeout(() => {
      const current = this._states.get(appId);
      if (current && current.status === "opening-steam") {
        this._updateState(appId, { status: "waiting" });
      }
    }, 2000);

    // Update elapsed time every second
    const elapsedInterval = setInterval(() => {
      const current = this._states.get(appId);
      if (!current || current.status === "installed" || current.status === "dismissed" || current.status === "timeout") {
        return;
      }
      this._updateState(appId, { elapsedMs: Date.now() - current.startedAt });
    }, ELAPSED_UPDATE_INTERVAL_MS);
    this._elapsedIntervals.set(appId, elapsedInterval);

    // Poll for install completion
    const poll = async () => {
      const current = this._states.get(appId);
      if (!current || current.status === "installed" || current.status === "dismissed" || current.status === "timeout") {
        return;
      }

      // Timeout only applies to waiting phase (Steam hasn't started downloading)
      // Once installing is detected, we keep polling until completion regardless of elapsed time
      if (current.status !== "installing") {
        const elapsed = Date.now() - current.startedAt;
        if (elapsed > TIMEOUT_MS) {
          console.log(`[INSTALL_TRACK] timeout appid=${appId} elapsed=${elapsed}ms`);
          this._updateState(appId, { status: "timeout" });
          this._stopTracking(appId);
          return;
        }
      }

      try {
        const result = await checkSteamGameInstalled(
          Number(appId),
          _steamRoot,
        );

        const progressChanged =
          JSON.stringify(current.downloadProgress) !== JSON.stringify(result.downloadProgress);

        // Speed/ETA estimation from byte delta
        let speedBytesPerSec: number | undefined;
        let etaSeconds: number | undefined;
        if (result.downloadProgress && result.downloadProgress.bytesToDownload > 0) {
          const prev = this._lastBytes.get(appId);
          const nowBytes = result.downloadProgress.bytesDownloaded;
          if (prev && nowBytes > prev.bytesDownloaded) {
            const deltaT = (Date.now() - prev.ts) / 1000;
            if (deltaT > 0) {
              speedBytesPerSec = Math.round((nowBytes - prev.bytesDownloaded) / deltaT);
              const remaining = result.downloadProgress.bytesToDownload - nowBytes;
              if (speedBytesPerSec > 0 && remaining > 0) {
                etaSeconds = Math.round(remaining / speedBytesPerSec);
              }
            }
          }
          this._lastBytes.set(appId, { bytesDownloaded: nowBytes, ts: Date.now() });
        }

        if (progressChanged && result.downloadProgress) {
          console.log(
            `[INSTALL_TRACK] progress appid=${appId} ${Math.round(result.downloadProgress.percent)}% ` +
            `(${result.downloadProgress.bytesDownloaded}/${result.downloadProgress.bytesToDownload})`
          );
        }

        if (result.isCompleted) {
          console.log(`[INSTALL_TRACK] appid=${appId} phase=complete-confirmed reason=strict-check stateFlags=${result.stateFlags} sizeOnDisk=${result.sizeOnDisk}`);
          this._updateState(appId, {
            status: "installed",
            elapsedMs: Date.now() - current.startedAt,
            sizeOnDisk: result.sizeOnDisk ?? undefined,
            downloadProgress: result.downloadProgress,
            speedBytesPerSec,
            etaSeconds: 0,
          });
          this._lastBytes.delete(appId);
          this._stopTracking(appId);
        } else if (result.isInstalled) {
          if (current.status !== "installing") {
            console.log(`[INSTALL_TRACK] appid=${appId} phase=still-installing reason=manifest-detected-but-not-complete stateFlags=${result.stateFlags}`);
          }
          this._updateState(appId, {
            status: "installing",
            downloadProgress: result.downloadProgress,
            speedBytesPerSec,
            etaSeconds,
          });
        } else if (result.downloadProgress || result.stateFlags != null) {
          // Manifest exists but isInstalled=false — transitional state (e.g. preallocating)
          console.log(`[INSTALL_TRACK] appid=${appId} phase=still-installing reason=manifest-only stateFlags=${result.stateFlags}`);
          this._updateState(appId, {
            status: "installing",
            downloadProgress: result.downloadProgress,
            speedBytesPerSec,
            etaSeconds,
          });
        } else {
          this._lastBytes.delete(appId);
          const updates: Partial<InstallState> = { downloadProgress: null, speedBytesPerSec: undefined, etaSeconds: undefined };
          if (current.status !== "waiting") {
            updates.status = "waiting";
          }
          this._updateState(appId, updates);
        }
      } catch (err) {
        console.error(`[INSTALL_TRACK] poll error appid=${appId}:`, err);
      }
    };

    // Start polling
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    this._pollIntervals.set(appId, interval);
  }

  dismiss(appId: string): void {
    const current = this._states.get(appId);
    if (current && (current.status === "timeout" || current.status === "installing" || current.status === "waiting" || current.status === "opening-steam")) {
      this._updateState(appId, { status: "dismissed" });
    }
    this._stopTracking(appId);
  }

  private _stopTracking(appId: string): void {
    const pollInterval = this._pollIntervals.get(appId);
    if (pollInterval) {
      clearInterval(pollInterval);
      this._pollIntervals.delete(appId);
    }
    const elapsedInterval = this._elapsedIntervals.get(appId);
    if (elapsedInterval) {
      clearInterval(elapsedInterval);
      this._elapsedIntervals.delete(appId);
    }
    this._lastBytes.delete(appId);
  }

  private _updateState(appId: string, partial: Partial<InstallState>): void {
    const current = this._states.get(appId);
    if (!current) return;
    const next = { ...current, ...partial };
    this._states.set(appId, next);
    this._notify(appId);
  }

  private _notify(appId: string): void {
    const state = this._states.get(appId);
    if (!state) return;
    const listeners = this._listeners.get(appId);
    if (listeners) {
      for (const fn of listeners) {
        try { fn(state); } catch { /* ignore */ }
      }
    }
    for (const fn of this._globalListeners) {
      try { fn(appId, state); } catch { /* ignore */ }
    }
    if (state.status === "installed") {
      for (const fn of this._installedHandlers) {
        try { fn(appId); } catch { /* ignore */ }
      }
    }
  }
}

export const installTrackerService = new InstallTrackerService();
