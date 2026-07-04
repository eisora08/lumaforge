import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { achievementStore, buildProgressPatchFromLibraryCache } from "./achievementStore";
import { checkAchievementLibraryCacheMetadata, readAchievementCache, listLibraryCacheAppIds } from "./tauri";
import type { AppAchievementCache } from "./tauri";
import type { GameAchievement, GameAchievementsSummary, UnlockEvent } from "../types/gameAchievements";
import { sendAchievementNativeNotification } from "./achievementNotificationService";
import { showAchievementToast, showGroupedAchievementToast } from "../components/library/AchievementToast";
import {
  ACHIEVEMENTS_AUTO_ENABLED,
  ACHIEVEMENT_WATCHER_PROCESS_EVENTS,
  logWatcherProcessSkipOnce,
  logStoreSkipOnce,
  isStoreRoute,
} from "./achievementAutoFlags";

// ---------------------------------------------------------------------------
// Startup flags — all default to minimal work
// ---------------------------------------------------------------------------

export const ACHIEVEMENT_WATCHER_ENABLED = true;
export const ACHIEVEMENT_WATCHER_FULL_SCAN_ON_STARTUP = false;
export const ACHIEVEMENT_LIBRARYCACHE_SCAN_ON_BOOT = false;
export const ACHIEVEMENT_PROCESS_MISSING_CACHE_ON_BOOT = false;
export const DEBUG_ACH_LIBRARYCACHE = false;
export const DEBUG_ACH_WATCHER = false;

let _fullScanSkipLogged = false;

function logFullScanSkipOnce(): void {
  if (!_fullScanSkipLogged) {
    _fullScanSkipLogged = true;
    console.log("[ACH][WATCHER] full-scan skipped reason=disabled");
  }
}

// If master switch is off, override event processing
const _shouldProcessEvents = ACHIEVEMENTS_AUTO_ENABLED && ACHIEVEMENT_WATCHER_PROCESS_EVENTS;

// ---------------------------------------------------------------------------
// Settings reading helpers (no React context needed)
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "lumaforge-settings";

function readSettings(): Record<string, any> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function isNativeNotificationsEnabled(): boolean {
  return readSettings().achievementNativeNotificationsEnabled === true;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AchievementFileChangedPayload = {
  appid: number;
  source: string;
  path: string;
  modified_at: number;
  size: number;
  trace_id: string;
};

// ---------------------------------------------------------------------------
// Trace ID
// ---------------------------------------------------------------------------

let _traceCounter = 0;

function nextTraceId(): string {
  _traceCounter++;
  const ts = Date.now().toString(36).slice(-6);
  return `${ts}${_traceCounter.toString(36).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Stable file check — uses appId-based Rust stat (path-based not needed)
// ---------------------------------------------------------------------------

async function waitStableFile(
  appId: string,
  steamPath: string,
  accountId: string,
  traceId: string,
  maxAttempts = 3,
  delayMs = 250,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const s1 = await getFileSizeModified(appId, steamPath, accountId);
    if (s1 == null) {
      console.debug(`[ACH][BG][${traceId}] stableCheck attempt=${attempt} file-not-found`);
      return false;
    }
    await sleep(delayMs);
    const s2 = await getFileSizeModified(appId, steamPath, accountId);
    if (s2 == null) {
      console.debug(`[ACH][BG][${traceId}] stableCheck attempt=${attempt} file-not-found-after-wait`);
      return false;
    }
    const stable = s1.size === s2.size && s1.modified === s2.modified;
    console.debug(`[ACH][BG][${traceId}] stableCheck attempt=${attempt} size1=${s1.size} size2=${s2.size} modified1=${s1.modified} modified2=${s2.modified} stable=${stable}`);
    if (stable) return true;
  }
  return false;
}

async function getFileSizeModified(
  appId: string, steamPath: string, accountId: string,
): Promise<{ size: number; modified: number } | null> {
  if (!accountId) return null;
  try {
    const info = await checkAchievementLibraryCacheMetadata({
      appId: Number(appId),
      steamPath,
      steamAccountId: accountId,
    });
    if (!info.file_found) return null;
    if (info.file_size == null || info.modified_at == null) return null;
    return { size: info.file_size, modified: info.modified_at };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Fingerprint dedup
// ---------------------------------------------------------------------------

const lastFingerprints = new Map<string, { fingerprint: string; processed: boolean }>();

function makeFingerprint(path: string, modifiedAt: number, size: number): string {
  return `${path}:${modifiedAt}:${size}`;
}

// ---------------------------------------------------------------------------
// Snapshot helpers for baseline scan
// ---------------------------------------------------------------------------

const SNAPSHOT_KEY = "lumaforge-achievement-unlock-snapshot-v1";

type AppSnapshot = Record<string, boolean>;
type GlobalSnapshot = Record<string, AppSnapshot>;

function loadGlobalSnapshot(): GlobalSnapshot {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveGlobalSnapshot(snapshot: GlobalSnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // storage full, ignore
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class AchievementWatcherService {
  private unlisten: UnlistenFn | null = null;
  private _started = false;
  private _alreadyStartedOnce = false;
  private _steamPath = "";
  private _steamAccountId = "";
  // Debounce: set of appIds currently being processed via watcher events
  private _debouncedAppIds = new Set<string>();

  // Focus listener
  private _focusHandler: (() => void) | null = null;
  // Polling interval
  private _pollIntervalId: number | null = null;
  // Last known modified times for poll fallback
  private _lastFileMeta = new Map<string, { size: number; modified: number }>();
  // Unlock callback subscription
  private _unlockUnsub: (() => void) | null = null;
  // Pending unlocks gathered while app was unfocused
  private _pendingUnfocusUnlocks: Array<{ unlock: UnlockEvent; appId: string }> = [];
  // Toast dedup: track recently-shown (appId:apiName) keys within a 3s window
  private _toastDedupTimers = new Map<string, number>();

  private isToastRecentlyShown(appId: string, apiName: string): boolean {
    const key = `${appId}:${apiName}`;
    return this._toastDedupTimers.has(key);
  }

  private markToastShown(appId: string, apiName: string): void {
    const key = `${appId}:${apiName}`;
    this._toastDedupTimers.set(key, window.setTimeout(() => {
      this._toastDedupTimers.delete(key);
    }, 3000));
  }

  private drainPendingUnlocks(): void {
    if (this._pendingUnfocusUnlocks.length === 0) return;
    const traceId = nextTraceId();
    // Deduplicate by apiName
    const seen = new Set<string>();
    const unique: Array<{ unlock: UnlockEvent; appId: string }> = [];
    for (const item of this._pendingUnfocusUnlocks) {
      const key = `${item.appId}:${item.unlock.apiName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    const maxShow = 3;
    for (let i = 0; i < Math.min(unique.length, maxShow); i++) {
      showAchievementToast(unique[i].unlock, unique[i].appId, undefined);
      console.debug(`[ACH][NOTIFY][${traceId}] drain show apiName=${unique[i].unlock.apiName}`);
    }
    if (unique.length > maxShow) {
      showGroupedAchievementToast(unique.length - maxShow);
    }
    this._pendingUnfocusUnlocks = [];
    console.debug(`[ACH][NOTIFY][${traceId}] drained total=${unique.length} shown=${Math.min(unique.length, maxShow)}`);
  }

  get started(): boolean {
    return this._started;
  }

  async start(
    steamPath?: string,
    steamAccountId?: string,
  ): Promise<void> {
    if (!steamPath || !steamAccountId) {
      console.debug("[ACH][WATCHER] not started reason=missing-steam-root-or-account-id");
      return;
    }

    // Singleton: already started once this session — skip restart
    if (this._alreadyStartedOnce) {
      if (this._steamPath === steamPath && this._steamAccountId === steamAccountId) {
        console.log("[ACH][WATCHER] already-running skip");
        return;
      }
      // Settings changed — allow restart
      console.log("[ACH][WATCHER] restarting reason=settings-changed");
    }

    if (this._started) {
      await this.stop();
    }

    this._steamPath = steamPath;
    this._steamAccountId = steamAccountId;
    // Invalidate cached appid list when path/account changes (PART 15)
    this._cachedAppIds = null;
    this._cachedAppIdsAt = 0;

    const librarycachePath = `${steamPath}\\userdata\\${steamAccountId}\\config\\librarycache`;
    const appcacheStatsPath = `${steamPath}\\appcache\\stats`;
    console.debug(`[ACH][WATCHER] steamRoot=${steamPath}`);
    console.debug(`[ACH][WATCHER] accountId=${steamAccountId}`);
    console.debug(`[ACH][WATCHER] watchingLibrarycache=${librarycachePath}`);
    console.debug(`[ACH][WATCHER] watchingAppcacheStats=${appcacheStatsPath}`);

    // Start Rust-side watcher
    try {
      await invoke("start_achievement_watcher", {
        steamPath: steamPath ?? null,
        steamAccountId,
      });
    } catch (err) {
      console.warn(`[ACH][WATCHER] failed to start: ${err}`);
      return;
    }

    // Listen for file change events from Rust watcher
    try {
      this.unlisten = await listen<AchievementFileChangedPayload>(
        "achievement-progress-file-changed",
        (event) => {
          if (isStoreRoute()) {
            logStoreSkipOnce();
            return;
          }

          if (!_shouldProcessEvents) {
            logWatcherProcessSkipOnce();
            return;
          }

          const { appid, source, path, modified_at, size, trace_id } = event.payload;
          const traceId = trace_id || nextTraceId();
          const appIdStr = String(appid);

          if (DEBUG_ACH_WATCHER) {
            console.debug(`[ACH][BG][${traceId}] frontend event received appid=${appIdStr} source=${source} path=${path}`);
          }

          const fp = makeFingerprint(path, modified_at, size);
          const prev = lastFingerprints.get(path);
          if (prev && prev.fingerprint === fp && prev.processed) {
            if (DEBUG_ACH_WATCHER) {
              console.debug(`[ACH][BG][${traceId}] ignored reason=duplicate-fingerprint fingerprint=${fp}`);
            }
            return;
          }

          lastFingerprints.set(path, { fingerprint: fp, processed: false });

          // Update poll metadata
          this._lastFileMeta.set(path, { size, modified: modified_at });

          // Process only the changed appId — no scanning of all appIds
          if (source === "librarycache") {
            // Debounce: skip if already queued for same appId
            if (this._debouncedAppIds.has(appIdStr)) {
              if (DEBUG_ACH_WATCHER) {
                console.debug(`[ACH][WATCHER_DEDUPE] appid=${appIdStr} reason=already-queued`);
              }
              return;
            }
            this._debouncedAppIds.add(appIdStr);
            console.log(`[ACH][WATCHER_EVENT] appid=${appIdStr} source=librarycache queued=true`);
            this.processLibrarycacheChange(appIdStr, path, "watcher", traceId).then((ok) => {
              this._debouncedAppIds.delete(appIdStr);
              if (ok && lastFingerprints.has(path)) {
                lastFingerprints.set(path, { fingerprint: fp, processed: true });
              }
            });
          } else if (DEBUG_ACH_WATCHER) {
            console.debug(`[ACH][BG][${traceId}] ignored reason=non-librarycache-source source=${source}`);
          }
        },
      );
    } catch (err) {
      console.warn(`[ACH][WATCHER] failed to listen for events: ${err}`);
      await invoke("stop_achievement_watcher").catch(() => {});
      return;
    }

    // Register global unlock handler — toasts + native notifications
    this._unlockUnsub = achievementStore.onUnlock((appId, unlocks) => {
      const traceId = nextTraceId();
      const appFocused = document.hasFocus();
      const nativeEnabled = isNativeNotificationsEnabled();

      console.debug(`[ACH][NOTIFY][${traceId}] appFocused=${appFocused} nativeEnabled=${nativeEnabled} appId=${appId} unlocks=${unlocks.length}`);

      if (appFocused) {
        // Show in-app toasts when focused (dedup against GameDetails handler)
        const maxShow = 3;
        let shownCount = 0;
        for (let i = 0; i < unlocks.length && shownCount < maxShow; i++) {
          if (this.isToastRecentlyShown(appId, unlocks[i].apiName)) {
            console.debug(`[ACH][TOAST][${traceId}] skipped dedup apiName=${unlocks[i].apiName}`);
            continue;
          }
          showAchievementToast(unlocks[i], appId, this._getGameTitle(appId));
          this.markToastShown(appId, unlocks[i].apiName);
          shownCount++;
          console.debug(`[ACH][TOAST][${traceId}] show apiName=${unlocks[i].apiName} hasIconUrl=${!!unlocks[i].iconUrl} source=global-watcher`);
        }
        const remaining = unlocks.length - shownCount;
        if (remaining > 0) {
          showGroupedAchievementToast(remaining);
          console.debug(`[ACH][TOAST][${traceId}] grouped remaining=${remaining}`);
        }
      } else {
        // Unfocused: queue in-app toasts for later, don't show now
        console.debug(`[ACH][NOTIFY][${traceId}] inAppQueued=true appFocused=${appFocused}`);
        this._pendingUnfocusUnlocks.push(...unlocks.map((u) => ({ unlock: u, appId })));
      }

      // Native notification when enabled (always, regardless of focus)
      if (nativeEnabled) {
        for (const unlock of unlocks) {
          sendAchievementNativeNotification(unlock.name, appId);
          console.debug(`[ACH][NOTIFY][${traceId}] native sent apiName=${unlock.apiName}`);
        }
      }
    });

    // Window focus: drain pending unlocks and optionally rescan librarycache
    this._focusHandler = () => {
      if (!this._started) return;
      if (DEBUG_ACH_WATCHER) {
        console.debug("[ACH][WATCHER] window focus - draining pending unlocks");
      }
      this.drainPendingUnlocks();
      // Scan librarycache on focus only if enabled (disabled by default)
      if (ACHIEVEMENT_LIBRARYCACHE_SCAN_ON_BOOT) {
        if (DEBUG_ACH_WATCHER) {
          console.debug("[ACH][WATCHER] window focus - scanning librarycache");
        }
        this.scanLibraryCacheChanges();
      }
    };
    window.addEventListener("focus", this._focusHandler);

    // Polling fallback: disabled by default to avoid full librarycache scans
    if (ACHIEVEMENT_LIBRARYCACHE_SCAN_ON_BOOT) {
      this.startPollingFallback();
    } else if (DEBUG_ACH_WATCHER) {
      console.debug("[ACH][WATCHER] polling fallback skipped reason=disabled");
    }

    // Baseline scan: disabled by default — watcher reacts to file changes only
    if (ACHIEVEMENT_WATCHER_FULL_SCAN_ON_STARTUP) {
      await this.runBaselineScan();
    } else {
      logFullScanSkipOnce();
    }

    this._started = true;
    this._alreadyStartedOnce = true;
    if (DEBUG_ACH_WATCHER) {
      console.debug("[ACH][WATCHER] started background=true");
    }
  }

  async stop(): Promise<void> {
    // Remove focus handler
    if (this._focusHandler) {
      window.removeEventListener("focus", this._focusHandler);
      this._focusHandler = null;
    }

    // Stop polling
    this.stopPollingFallback();

    // Unsubscribe unlock handler
    if (this._unlockUnsub) {
      this._unlockUnsub();
      this._unlockUnsub = null;
    }

    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }
    try {
      await invoke("stop_achievement_watcher");
    } catch {
      // ignore
    }
    this._started = false;
    this._lastFileMeta.clear();
    this._pendingUnfocusUnlocks = [];
    for (const timer of this._toastDedupTimers.values()) {
      window.clearTimeout(timer);
    }
    this._toastDedupTimers.clear();
    console.debug("[ACH][WATCHER] stopped");
  }

  async getStatus(): Promise<boolean> {
    try {
      return await invoke<boolean>("get_achievement_watcher_status");
    } catch {
      return false;
    }
  }

  // ── Polling fallback ──

  private startPollingFallback(): void {
    this.stopPollingFallback();
    this._pollIntervalId = window.setInterval(() => {
      this.pollLibraryCacheChanges();
    }, 1000);
    console.debug("[ACH][WATCHER] polling fallback started interval=1000ms");
  }

  private stopPollingFallback(): void {
    if (this._pollIntervalId != null) {
      window.clearInterval(this._pollIntervalId);
      this._pollIntervalId = null;
    }
  }

  // ── Cached librarycache appid listing (PART 15) ──
  private _cachedAppIds: number[] | null = null;
  private _cachedAppIdsAt = 0;
  private readonly APPID_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private async getCachedAppIds(): Promise<number[]> {
    if (this._cachedAppIds && Date.now() - this._cachedAppIdsAt < this.APPID_CACHE_TTL) {
      return this._cachedAppIds;
    }
    const appids = await listLibraryCacheAppIds({
      steamPath: this._steamPath,
      steamAccountId: this._steamAccountId,
    });
    this._cachedAppIds = appids;
    this._cachedAppIdsAt = Date.now();
    if (ACHIEVEMENT_LIBRARYCACHE_SCAN_ON_BOOT) {
      console.log(`[ACH][WATCHER] librarycache index loaded count=${appids.length}`);
    }
    return appids;
  }

  private async pollLibraryCacheChanges(): Promise<void> {
    if (!this._steamPath || !this._steamAccountId) return;
    // Only poll appIds that have been seen before (via file events), not all 236
    // This avoids scanning the entire librarycache directory every second
    const knownAppIds = new Set<string>();
    for (const key of this._lastFileMeta.keys()) {
      if (key.startsWith("librarycache:")) {
        knownAppIds.add(key.replace("librarycache:", ""));
      }
    }
    if (knownAppIds.size === 0) return;
    try {
      for (const appIdStr of knownAppIds) {
        const meta = await getFileSizeModified(appIdStr, this._steamPath, this._steamAccountId);
        if (!meta) continue;
        const key = `librarycache:${appIdStr}`;
        const prev = this._lastFileMeta.get(key);
        if (!prev || prev.size !== meta.size || prev.modified !== meta.modified) {
          this._lastFileMeta.set(key, { size: meta.size, modified: meta.modified });
          const traceId = nextTraceId();
          if (DEBUG_ACH_WATCHER) {
            console.debug(`[ACH][POLL][${traceId}] changed appid=${appIdStr}`);
          }
          this.processLibrarycacheChange(appIdStr, `poll://${appIdStr}`, "poll", traceId);
        }
      }
    } catch {
      // transient
    }
  }

  // ── Focus-based rescan ──

  private async scanLibraryCacheChanges(): Promise<void> {
    if (!this._steamPath || !this._steamAccountId) return;
    const traceId = nextTraceId();
    if (DEBUG_ACH_WATCHER) {
      console.debug(`[ACH][FOCUS][${traceId}] scanning librarycache`);
    }
    // Only scan appIds that have been seen via file events
    const knownAppIds = new Set<string>();
    for (const key of this._lastFileMeta.keys()) {
      if (key.startsWith("librarycache:")) {
        knownAppIds.add(key.replace("librarycache:", ""));
      }
    }
    if (knownAppIds.size === 0) return;
    try {
      for (const appIdStr of knownAppIds) {
        const meta = await getFileSizeModified(appIdStr, this._steamPath, this._steamAccountId);
        if (!meta) continue;
        const key = `librarycache:${appIdStr}`;
        const prev = this._lastFileMeta.get(key);
        if (!prev || prev.size !== meta.size || prev.modified !== meta.modified) {
          this._lastFileMeta.set(key, { size: meta.size, modified: meta.modified });
          if (DEBUG_ACH_WATCHER) {
            console.debug(`[ACH][FOCUS][${traceId}] change detected appid=${appIdStr}`);
          }
          this.processLibrarycacheChange(appIdStr, `focus://${appIdStr}`, "focus", traceId);
        }
      }
    } catch {
      // transient
    }
  }

  // ── Baseline scan: seed snapshots for all existing librarycache files ──

  private async runBaselineScan(): Promise<void> {
    if (!this._steamPath || !this._steamAccountId) return;
    const traceId = nextTraceId();
    console.debug(`[ACH][WATCHER][${traceId}] baseline scan started`);

    try {
      const appids = await this.getCachedAppIds();

      let baselineCount = 0;
      const snapshot = loadGlobalSnapshot();

      for (const appid of appids) {
        const appIdStr = String(appid);

        // Only seed snapshot if it doesn't exist yet
        if (snapshot[appIdStr]) {
          continue;
        }

        try {
          const patch = await buildProgressPatchFromLibraryCache(
            appIdStr,
            this._steamPath,
            this._steamAccountId,
            traceId,
          );

          if (patch && patch.progressMap.size > 0) {
            const appSnap: AppSnapshot = {};
            for (const [apiName, progress] of patch.progressMap) {
              appSnap[apiName] = progress.unlocked;
            }
            snapshot[appIdStr] = appSnap;
            baselineCount++;
            console.debug(`[ACH][WATCHER][${traceId}] baseline appid=${appIdStr} unlocked=${patch.unlocked}`);
          }
        } catch {
          // skip individual file failures
        }

        // Also update lastFileMeta so focus/poll doesn't re-process
        const meta = await getFileSizeModified(appIdStr, this._steamPath, this._steamAccountId);
        if (meta) {
          this._lastFileMeta.set(`librarycache:${appid}`, meta);
        }
      }

      saveGlobalSnapshot(snapshot);

      console.debug(`[ACH][WATCHER][${traceId}] baseline scan complete apps=${appids.length} baselines=${baselineCount}`);
    } catch (err) {
      console.warn(`[ACH][WATCHER][${traceId}] baseline scan failed: ${err}`);
    }
  }

  // ── Game title resolution for toasts outside GameDetails ──

  private _gameTitleCache = new Map<string, string>();

  private _populateGameTitleCache(): void {
    try {
      const raw = localStorage.getItem("lumaforge-snapshot-games");
      if (raw) {
        const games = JSON.parse(raw) as Array<{ appId: string; title: string }>;
        for (const g of games) {
          this._gameTitleCache.set(g.appId, g.title);
        }
      }
    } catch {
      // non-critical
    }
  }

  private _getGameTitle(appId: string): string | undefined {
    if (this._gameTitleCache.size === 0) {
      this._populateGameTitleCache();
    }
    return this._gameTitleCache.get(appId);
  }

  // ── Dev simulate ──

  /** Expose traceId generation for dev console use */
  get nextTraceId(): string {
    return nextTraceId();
  }

  // ── processLibrarycacheChange (Part 4): parse librarycache + patch store immediately ──

  // ── Coalescing state for PART 14 ──
  private _syncRunning = false;
  private _syncPending = false;
  private _syncPendingAppIds = new Set<string>();

  /**
   * Process a librarycache file change globally.
   * Called from the Tauri watcher event, polling fallback, focus rescan, and dev simulate.
   * Does NOT require GameDetails, modal, or any mounted component.
   */
  async processLibrarycacheChange(
    appId: string,
    _path: string,
    source: string,
    traceId: string,
  ): Promise<boolean> {
    console.debug(`[ACH][BG][${traceId}] processLibrarycacheChange start appid=${appId} source=${source}`);

    // Coalescing: if already running, mark pending and return
    if (this._syncRunning) {
      this._syncPending = true;
      this._syncPendingAppIds.add(appId);
      console.log(`[SYNC] coalesced while running pending=${this._syncPendingAppIds.size}`);
      return false;
    }

    this._syncRunning = true;
    this._syncPending = false;

    try {
      // Stable file check
      const stable = await waitStableFile(appId, this._steamPath, this._steamAccountId, traceId);
      if (!stable) {
        console.debug(`[ACH][BG][${traceId}] processLibrarycacheChange skipped appid=${appId} reason=file-not-stable`);
        return false;
      }

      // Pre-load cache from disk if store doesn't have this appId yet
      if (!achievementStore.getSummary(appId)) {
        try {
          const cached = await readAchievementCache(Number(appId));
          if (cached) {
            const cachedSummary = this.cacheToSummary(appId, cached);
            console.log(`[ACH][SUMMARY_SOURCE] appid=${appId} source=cache(watcher) unlocked=${cachedSummary.unlocked}/${cachedSummary.total} updatedAt=${cachedSummary.updatedAt} progressAvailable=${cachedSummary.progressAvailable}`);
            achievementStore.setSummary(appId, cachedSummary);
            console.debug(`[ACH][BG][${traceId}] loadedCacheFallback=true appid=${appId} total=${cachedSummary.total} unlocked=${cachedSummary.unlocked}`);
          }
        } catch {
          // Cache load failed, will create minimal summary in applyProgressPatch
        }
      }

      const patch = await buildProgressPatchFromLibraryCache(
        appId,
        this._steamPath,
        this._steamAccountId,
        traceId,
      );

      if (!patch) {
        console.debug(`[ACH][BG][${traceId}] processLibrarycacheChange skipped appid=${appId} reason=patch-is-null`);
        return false;
      }

      // Log progress patch
      console.debug(
        `[ACH][FAST_PROGRESS][${traceId}] parsed total=${patch.total} achieved=${patch.unlocked} entries=${patch.progressMap.size}`,
      );

      // Log first few achieved entries
      let logged = 0;
      for (const [apiName, progress] of patch.progressMap) {
        if (progress.unlocked && logged < 3) {
          console.debug(`[ACH][FAST_PROGRESS][${traceId}] achieved apiName=${apiName} unlockTime=${progress.unlockTime ?? "null"}`);
          logged++;
        }
      }

      const result = achievementStore.applyProgressPatch(appId, patch, traceId);
      if (!result) {
        console.debug(`[ACH][BG][${traceId}] processLibrarycacheChange skipped appid=${appId} reason=applyProgressPatch-returned-null`);
        return false;
      }

      console.debug(`[ACH][BG][${traceId}] processLibrarycacheChange done appid=${appId}`);
      // Fill missing icons from disk cache in background
      achievementStore.fillMissingIconsFromCache(appId, traceId).catch(() => {});
      return true;
    } catch (err) {
      console.warn(`[ACH][BG][${traceId}] processLibrarycacheChange failed appid=${appId} reason=${err}`);
      return false;
    } finally {
      this._syncRunning = false;
      // Process coalesced follow-up
      if (this._syncPending && this._syncPendingAppIds.size > 0) {
        const pendingCount = this._syncPendingAppIds.size;
        const nextAppId = this._syncPendingAppIds.values().next().value;
        this._syncPendingAppIds.clear();
        this._syncPending = false;
        if (nextAppId) {
          console.log(`[SYNC] running pending follow-up count=${pendingCount}`);
          const nextTrace = nextTraceId();
          this.processLibrarycacheChange(nextAppId, "coalesced", source, nextTrace).catch(() => {});
        }
      }
    }
  }

  /**
   * Dev simulate command — calls processLibrarycacheChange directly.
   */
  async simulateLibrarycacheChange(appId: string): Promise<void> {
    const traceId = nextTraceId();
    console.debug(`[ACH][SIMULATE][${traceId}] started appid=${appId}`);
    const ok = await this.processLibrarycacheChange(appId, `simulated://${appId}`, "manual", traceId);
    console.debug(`[ACH][SIMULATE][${traceId}] completed patched=${ok}`);
  }

  /**
   * Manual full librarycache scan — for dev/maintenance use only.
   * Scans all librarycache files and seeds snapshots. Does NOT show toasts.
   * Not called automatically during normal startup/navigation.
   */
  async runFullScan(): Promise<{ scanned: number; baselines: number; errors: number }> {
    if (!this._steamPath || !this._steamAccountId) {
      console.log("[ACH][FULL_SCAN] skipped reason=missing-steam-root-or-account-id");
      return { scanned: 0, baselines: 0, errors: 0 };
    }
    const traceId = nextTraceId();
    console.log(`[ACH][FULL_SCAN][${traceId}] started`);
    try {
      const appids = await this.getCachedAppIds();
      let baselines = 0;
      let errors = 0;
      const snapshot = loadGlobalSnapshot();
      for (const appid of appids) {
        const appIdStr = String(appid);
        try {
          const patch = await buildProgressPatchFromLibraryCache(
            appIdStr, this._steamPath, this._steamAccountId, traceId,
          );
          if (patch && patch.progressMap.size > 0) {
            const appSnap: AppSnapshot = {};
            for (const [apiName, progress] of patch.progressMap) {
              appSnap[apiName] = progress.unlocked;
            }
            snapshot[appIdStr] = appSnap;
            baselines++;
          }
        } catch {
          errors++;
        }
        const meta = await getFileSizeModified(appIdStr, this._steamPath, this._steamAccountId);
        if (meta) {
          this._lastFileMeta.set(`librarycache:${appid}`, meta);
        }
      }
      saveGlobalSnapshot(snapshot);
      console.log(`[ACH][FULL_SCAN][${traceId}] complete apps=${appids.length} baselines=${baselines} errors=${errors}`);
      return { scanned: appids.length, baselines, errors };
    } catch (err) {
      console.warn(`[ACH][FULL_SCAN][${traceId}] failed: ${err}`);
      return { scanned: 0, baselines: 0, errors: 1 };
    }
  }

  private cacheToSummary(appId: string, cache: AppAchievementCache): GameAchievementsSummary {
    const achievements: GameAchievement[] = cache.achievements.map((entry) => ({
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

    return {
      appId,
      total: cache.summary.total,
      unlocked: cache.summary.unlocked,
      percent: cache.summary.percent,
      progressAvailable: cache.summary.progress_available,
      source: cache.summary.source as GameAchievementsSummary["source"],
      achievements,
      updatedAt: cache.summary.updated_at,
    };
  }
}

export const achievementWatcherService = new AchievementWatcherService();

// Dev console: expose commands
if (import.meta.env.DEV) {
  (window as any).__simulateLibrarycacheChange = (appId: string) => {
    achievementWatcherService.simulateLibrarycacheChange(appId);
  };
  (window as any).__rebuildAchievementCache = () => {
    return achievementWatcherService.runFullScan();
  };
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    achievementWatcherService.stop();
  });
}
