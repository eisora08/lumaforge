import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { achievementStore } from "./achievementStore";
import type { ProgressPatch } from "./achievementStore";
import { checkAchievementLibraryCacheMetadata, readAchievementCacheWithFallback, listLibraryCacheAppIds, readAchievementProgressIndex, scanSteamAppcacheAchievements } from "./tauri";
import type { AppAchievementCache, AchievementProgressEntry } from "./tauri";
import type { GameAchievement, GameAchievementsSummary, UnlockEvent } from "../types/gameAchievements";
import { sendAchievementNativeNotification, showGroupedAchievementOverlay, queueAchievementOverlay } from "./achievementNotificationService";
import { showAchievementToast, showGroupedAchievementToast } from "../components/library/AchievementToast";
import {
  ACHIEVEMENTS_AUTO_ENABLED,
  ACHIEVEMENT_WATCHER_PROCESS_EVENTS,
  ACHIEVEMENT_AUTO_SYNC_ENABLED,
  ACHIEVEMENT_READ_CACHE_ON_BOOT,
  ACHIEVEMENT_SCHEMA_MIGRATION_AUTO,
  logWatcherProcessSkipOnce,
  logStoreSkipOnce,
  isStoreRoute,
} from "./achievementAutoFlags";
import { isSystemToolApp } from "./gameCacheService";

// ---------------------------------------------------------------------------
// Realtime Achievement Scope
// ---------------------------------------------------------------------------
// Realtime updates are guaranteed for:
//   - Games launched from LumaForge (GameSessionContext tracks the active appId)
//   - Games currently visible/active in GameDetails
//   - Any appId where an in-memory canonical base exists
//
// Realtime updates are NOT guaranteed for (use Manual Refresh Achievements):
//   - Games launched externally from Steam or another launcher
//   - Games launched before LumaForge started
//   - Any scenario where LumaForge does not know the active appId
//
// The Rust watcher fires for ALL librarycache/usergamestats file changes,
// but the downgrade guard + resolver refresh (processLibrarycacheChange +
// _scheduleResolverRefresh) requires an in-memory canonical base to detect
// stale/partial reads. Without that base, the event is silently skipped.
//
// Future feature: process detection / external launch detection to expand scope.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Startup flags — all default to minimal work
// ---------------------------------------------------------------------------

export const ACHIEVEMENT_WATCHER_ENABLED = true;
export const ACHIEVEMENT_WATCHER_FULL_SCAN_ON_STARTUP = true;
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

function isToastEnabled(): boolean {
  return readSettings().achievementToastEnabled === true;
}

function isOverlayEnabled(): boolean {
  return readSettings().achievementOverlayNotificationsEnabled === true;
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
  private _startingInProgress = false;
  private _steamPath = "";
  private _steamAccountId = "";
  private _steamWebApiKey = "";
  // Debounce: set of appIds currently being processed via watcher events
  private _debouncedAppIds = new Set<string>();
  // Cooldown for usergamestats events (10s) — these fire frequently during gameplay
  private _usergamestatsCooldown = new Map<string, number>();

  // Focus listener
  private _focusHandler: (() => void) | null = null;
  // Polling interval
  private _pollIntervalId: number | null = null;
  // Last known modified times for poll fallback
  private _lastFileMeta = new Map<string, { size: number; modified: number }>();
  // Unlock callback subscription
  private _unlockUnsub: (() => void) | null = null;
  // Pending unlocks gathered while app was unfocused (in-app toast fallback only)
  private _pendingUnfocusUnlocks: Array<{ unlock: UnlockEvent; appId: string; source: string }> = [];
  // Toast dedup: track recently-shown (appId:apiName) keys within a 3s window
  private _toastDedupTimers = new Map<string, number>();
  // Content retry: re-read librarycache after delay when delta=0 (external unlocker timing)
  private _contentRetryPending = new Set<string>();
  private _contentRetryCounts = new Map<string, number>();
  private static CONTENT_RETRY_DELAY_MS = 2500;
  private static CONTENT_RETRY_MAX = 2;

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
    const toastEnabled = isToastEnabled();
    // Deduplicate by apiName, skip non-in-app sources
    const seen = new Set<string>();
    const unique: Array<{ unlock: UnlockEvent; appId: string }> = [];
    for (const item of this._pendingUnfocusUnlocks) {
      if (item.source !== "in-app" && item.source !== "in-app-fallback") {
        console.log(`[ACH][NOTIFY_DRAIN_SKIP] reason=overlay-should-not-be-queued apiName=${item.unlock.apiName} source=${item.source}`);
        continue;
      }
      const key = `${item.appId}:${item.unlock.apiName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    const maxShow = 3;
    for (let i = 0; i < Math.min(unique.length, maxShow); i++) {
      if (toastEnabled) {
        showAchievementToast(unique[i].unlock, unique[i].appId, undefined);
      }
      console.log(`[ACH][NOTIFY_DRAIN] route=in-app-drain apiName=${unique[i].unlock.apiName}`);
    }
    if (unique.length > maxShow && toastEnabled) {
      const remainingUnlocks = unique.slice(maxShow).map(u => u.unlock);
      const firstAppId = unique[0]?.appId;
      showGroupedAchievementToast(remainingUnlocks, firstAppId, undefined);
    }
    this._pendingUnfocusUnlocks = [];
    console.log(`[ACH][NOTIFY_DRAIN] drained total=${unique.length} shown=${Math.min(unique.length, maxShow)}`);
  }

  get started(): boolean {
    return this._started;
  }

  async start(
    steamPath?: string,
    steamAccountId?: string,
    steamWebApiKey?: string,
  ): Promise<void> {
    if (!steamPath || !steamAccountId) {
      console.debug("[ACH][WATCHER] not started reason=missing-steam-root-or-account-id");
      return;
    }

    // Synchronous guard: prevent a second concurrent caller (boot coordinator
    // + AchievementWatcherInit useEffect) from reaching Rust twice.  Without
    // this, both callers pass the _alreadyStartedOnce check before either
    // sets it, causing the Rust watcher to restart and immediately die because
    // the shutdown flag was still true from the previous stop().
    if (this._startingInProgress) {
      console.log("[ACH][WATCHER] already-running skip reason=starting-in-progress");
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

    this._startingInProgress = true;

    this._steamPath = steamPath;
    this._steamAccountId = steamAccountId;
    this._steamWebApiKey = steamWebApiKey ?? "";
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
      this._startingInProgress = false;
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

          console.log(`[ACH][PIPELINE] event_received appid=${appIdStr} source=${source} path=${path} shouldProcess=${_shouldProcessEvents}`);

          const fp = makeFingerprint(path, modified_at, size);
          const prev = lastFingerprints.get(path);
          if (prev && prev.fingerprint === fp && prev.processed) {
            console.log(`[ACH][PIPELINE] event_skipped appid=${appIdStr} reason=duplicate-fingerprint`);
            return;
          }

          lastFingerprints.set(path, { fingerprint: fp, processed: false });

          // Update poll metadata
          this._lastFileMeta.set(path, { size, modified: modified_at });

          // Process usergamestats (binary stats) and librarycache (Steam achievement data)
          const isAcceptedSource = source === "usergamestats" || source === "librarycache" || source === "achievement-progress";
          console.log(`[ACH][PIPELINE] source_check appid=${appIdStr} source=${source} accepted=${isAcceptedSource}`);

          // Special handling for global achievement_progress.json changes
          if (source === "achievement-progress") {
            console.log(`[ACH][PIPELINE] achievement-progress_detected path=${path}`);
            this.processAchievementProgressChange(path, traceId).catch((err) => {
              console.warn(`[ACH][PIPELINE] achievement-progress_error reason=${err}`);
            });
            if (lastFingerprints.has(path)) {
              lastFingerprints.set(path, { fingerprint: fp, processed: true });
            }
            return;
          }

          if (isAcceptedSource) {
            // Skip non-game appIds (tools, config apps, etc.)
            if (isSystemToolApp(appIdStr)) {
              console.log(`[ACH][WATCHER_FILTER] appid=${appIdStr} accepted=false reason=non-game-app-type`);
              return;
            }
            // Debounce: skip if already queued for same appId
            if (this._debouncedAppIds.has(appIdStr)) {
              console.log(`[ACH][PIPELINE] event_skipped appid=${appIdStr} reason=already-queued`);
              return;
            }
            // Cooldown: skip if processed within last 2s (for both binary stats and librarycache)
            if (source === "usergamestats" || source === "librarycache") {
              const last = this._usergamestatsCooldown.get(appIdStr);
              if (last && Date.now() - last < 2000) {
                console.log(`[ACH][PIPELINE] event_skipped appid=${appIdStr} reason=cooldown msSince=${Date.now() - last}`);
                return;
              }
              this._usergamestatsCooldown.set(appIdStr, Date.now());
            }
            if (DEBUG_ACH_WATCHER) console.log(`[ACH][WATCHER_STATE] event=before-process appid=${appIdStr} processing=false queued=${this._syncPendingAppIds.size} debouncedTotal=${this._debouncedAppIds.size}`);
            this._debouncedAppIds.add(appIdStr);
            console.log(`[ACH][PIPELINE] process_queued appid=${appIdStr} source=${source}`);
            this.processLibrarycacheChange(appIdStr, path, source, traceId).then((ok) => {
              this._debouncedAppIds.delete(appIdStr);
              console.log(`[ACH][PIPELINE] process_completed appid=${appIdStr} ok=${ok}`);
              if (DEBUG_ACH_WATCHER) console.log(`[ACH][WATCHER_STATE] event=cleanup appid=${appIdStr} processingHas=${this._syncRunning} queuedCount=${this._syncPendingAppIds.size}`);
              if (ok && lastFingerprints.has(path)) {
                lastFingerprints.set(path, { fingerprint: fp, processed: true });
              }
            }).catch((err) => {
              this._debouncedAppIds.delete(appIdStr);
              console.warn(`[ACH][WATCHER_CLEANUP_MISSING] appid=${appIdStr} reason=unhandled-rejection error=${err}`);
            });
          } else {
            console.log(`[ACH][PIPELINE] event_skipped appid=${appIdStr} reason=unaccepted-source source=${source}`);
            console.log(`[ACH][MANUAL_NEEDED_REASON] appid=${appIdStr} reason=non-librarycache-source source=${source}`);
          }
        },
      );
      console.log("[ACH][RT_LISTENER_REGISTERED]");
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
      const toastEnabled = isToastEnabled();
      const overlayEnabled = isOverlayEnabled();

      const traceSettings = `overlay=${overlayEnabled} native=${nativeEnabled} inApp=${toastEnabled} appFocused=${appFocused}`;
      console.log(`[ACH][NOTIFY_SETTINGS] ${traceSettings}`);

      // ── Overlay enabled: queue achievements one at a time ──
      if (overlayEnabled) {
        const maxShow = 3;
        console.log(`[ACH][TOAST_BATCH] appid=${appId} newUnlocks=${unlocks.length} maxShow=${maxShow} route=overlay-queue`);
        const queued: string[] = [];
        for (let i = 0; i < Math.min(unlocks.length, maxShow); i++) {
          queued.push(unlocks[i].apiName);
          queueAchievementOverlay({
            name: unlocks[i].name,
            description: unlocks[i].description,
            iconUrl: unlocks[i].iconUrl,
            iconGrayUrl: unlocks[i].iconGrayUrl,
            appId,
            rarity: unlocks[i].rarityPercent,
            gameTitle: this._getGameTitle(appId),
            isPlatinum: unlocks[i].isPlatinum,
          });
          this.markToastShown(appId, unlocks[i].apiName);
        }
        const remaining = unlocks.length - queued.length;
        console.log(`[ACH][TOAST_CAP] appid=${appId} queued=${queued.length} remaining=${remaining}`);
        if (remaining > 0) {
          showGroupedAchievementOverlay(remaining);
        }
      }

      // ── Overlay disabled: in-app toast routing ──
      if (!overlayEnabled) {
        if (appFocused) {
          const maxShow = 3;
          console.log(`[ACH][TOAST_BATCH] appid=${appId} newUnlocks=${unlocks.length} maxShow=${maxShow} route=in-app`);
          let shownCount = 0;
          for (let i = 0; i < unlocks.length && shownCount < maxShow; i++) {
            if (this.isToastRecentlyShown(appId, unlocks[i].apiName)) {
              console.debug(`[ACH][TOAST][${traceId}] skipped dedup apiName=${unlocks[i].apiName}`);
              continue;
            }
            if (toastEnabled) {
              console.log(`[ACH][NOTIFY_INAPP_ATTEMPT] appid=${appId} apiName=${unlocks[i].apiName}`);
              showAchievementToast(unlocks[i], appId, this._getGameTitle(appId));
            }
            this.markToastShown(appId, unlocks[i].apiName);
            shownCount++;
          }
          const remaining = unlocks.length - shownCount;
          console.log(`[ACH][TOAST_CAP] appid=${appId} notificationOnly=true storeUnaffected=true individualShown=${shownCount} groupedRemaining=${remaining}`);
          if (remaining > 0 && toastEnabled) {
            const remainingUnlocks = unlocks.slice(shownCount);
            showGroupedAchievementToast(remainingUnlocks, appId, this._getGameTitle(appId));
            console.log(`[ACH][NOTIFY_ROUTE] visual=in-app-grouped remaining=${remaining} native=${nativeEnabled}`);
          } else {
            const visual = toastEnabled ? "in-app" : "none";
            console.log(`[ACH][NOTIFY_ROUTE] visual=${visual} native=${nativeEnabled} count=${shownCount}`);
          }
        } else if (toastEnabled) {
          for (const u of unlocks) {
            this._pendingUnfocusUnlocks.push({ unlock: u, appId, source: "in-app" });
            console.log(`[ACH][NOTIFY_INAPP_ATTEMPT] appid=${appId} apiName=${u.apiName} queued=true`);
          }
          console.log(`[ACH][NOTIFY_ROUTE] visual=in-app-queued count=${unlocks.length} native=${nativeEnabled}`);
        } else {
          console.log(`[ACH][NOTIFY_ROUTE] visual=none native=${nativeEnabled} reason=no-visual-notifications`);
        }
      }

      // Native notification when enabled (always, regardless of focus)
      if (nativeEnabled) {
        for (const unlock of unlocks) {
          console.log(`[ACH][NOTIFY_NATIVE_ATTEMPT] appid=${appId} apiName=${unlock.apiName}`);
          sendAchievementNativeNotification(unlock.name, appId);
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
    this._startingInProgress = false;
    console.log(`[ACH][FLAGS] ACHIEVEMENTS_AUTO_ENABLED=${ACHIEVEMENTS_AUTO_ENABLED} ACHIEVEMENT_WATCHER_PROCESS_EVENTS=${ACHIEVEMENT_WATCHER_PROCESS_EVENTS} ACHIEVEMENT_AUTO_SYNC_ENABLED=${ACHIEVEMENT_AUTO_SYNC_ENABLED} ACHIEVEMENT_READ_CACHE_ON_BOOT=${ACHIEVEMENT_READ_CACHE_ON_BOOT} ACHIEVEMENT_SCHEMA_MIGRATION_AUTO=${ACHIEVEMENT_SCHEMA_MIGRATION_AUTO}`);
    if (DEBUG_ACH_WATCHER) {
      console.debug("[ACH][WATCHER] started background=true");
    }
    console.log("[ACH][WATCHER] realtime scope: active/visible/LumaForge-launched appIds only");
    console.log("[ACH][WATCHER] external-launch realtime: not yet supported — use Manual Refresh");
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
    this._contentRetryPending.clear();
    this._contentRetryCounts.clear();
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
      const seededAppIds: string[] = [];

      for (const appid of appids) {
        const appIdStr = String(appid);

        try {
          // Seed baseline from existing disk cache (no librarycache dependency)
          const cached = await readAchievementCacheWithFallback(Number(appIdStr));
          if (cached && cached.achievements && cached.achievements.length > 0) {
            const appSnap: AppSnapshot = {};
            for (const entry of cached.achievements) {
              appSnap[entry.api_name] = entry.unlocked;
            }
            snapshot[appIdStr] = appSnap;
            baselineCount++;
            seededAppIds.push(appIdStr);
            console.debug(`[ACH][WATCHER][${traceId}] baseline appid=${appIdStr} unlocked=${cached.summary?.unlocked ?? 0}`);

            // Seed the in-memory achievementStore from disk cache using full data
            // (setSummary preserves name, description, icons, stat_id, bit, progress_*)
            const summary = this.cacheToSummary(appIdStr, cached);
            achievementStore.setSummary(appIdStr, summary);
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

      // Post-scan: enqueue achievement image downloads for all seeded games
      if (seededAppIds.length > 0) {
        try {
          const { enqueueAchievementImageJobs } = await import("./backgroundJobQueue");
          enqueueAchievementImageJobs(seededAppIds, "normal");
          console.debug(`[ACH][WATCHER][${traceId}] baseline image download enqueued games=${seededAppIds.length}`);
        } catch {
          // non-critical — images will be downloaded when user opens game details
        }
      }

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

  // ── Achievement progress index cache (for diffing global achievement_progress.json) ──
  private _progressIndexCache = new Map<number, AchievementProgressEntry>();

  // ── processAchievementProgressChange: diff global progress index, dispatch per-game ──

  /**
   * Reads achievement_progress.json, diffs against the in-memory cache,
   * and triggers processLibrarycacheChange for each game whose unlocked/total changed.
   * This catches achievement unlocks detected by Steam that the librarycache watcher missed.
   */
  private async processAchievementProgressChange(
    _progressPath: string,
    traceId: string,
  ): Promise<void> {
    const steamAccountId = this._steamAccountId;
    const steamPath = this._steamPath;
    if (!steamAccountId || !steamPath) return;

    console.log(`[ACH][PROGRESS_INDEX] reading global achievement_progress.json traceId=${traceId}`);

    let entries: AchievementProgressEntry[];
    try {
      entries = await readAchievementProgressIndex({
        steamPath: steamPath || undefined,
        steamAccountId,
      });
    } catch (err) {
      console.warn(`[ACH][PROGRESS_INDEX] read_failed reason=${err}`);
      return;
    }

    console.log(`[ACH][PROGRESS_INDEX] read_complete entryCount=${entries.length} cachedCount=${this._progressIndexCache.size}`);

    const changedAppIds: string[] = [];

    for (const entry of entries) {
      const prev = this._progressIndexCache.get(entry.appId);
      if (!prev) {
        // New entry — this is a game we haven't seen before. Don't trigger
        // a full librarycache change (it would be noise on first boot).
        // Just cache it.
        this._progressIndexCache.set(entry.appId, entry);
        continue;
      }

      // Detect meaningful changes: unlocked count changed, or total changed (schema update)
      if (prev.unlocked !== entry.unlocked || prev.total !== entry.total) {
        console.log(`[ACH][PROGRESS_INDEX] changed appid=${entry.appId} prevUnlocked=${prev.unlocked} newUnlocked=${entry.unlocked} prevTotal=${prev.total} newTotal=${entry.total}`);
        changedAppIds.push(String(entry.appId));
      }

      this._progressIndexCache.set(entry.appId, entry);
    }

    if (changedAppIds.length === 0) {
      console.log(`[ACH][PROGRESS_INDEX] no_changes traceId=${traceId}`);
      return;
    }

    console.log(`[ACH][PROGRESS_INDEX] dispatching ${changedAppIds.length} changed games traceId=${traceId}`);

    // Dispatch each changed appId through the normal librarycache pipeline
    for (const appId of changedAppIds) {
      if (this._debouncedAppIds.has(appId)) {
        console.log(`[ACH][PROGRESS_INDEX] skip appid=${appId} reason=already-queued`);
        continue;
      }
      this._debouncedAppIds.add(appId);
      this.processLibrarycacheChange(appId, `progress-index://${appId}`, "achievement-progress", traceId).then((ok) => {
        this._debouncedAppIds.delete(appId);
        console.log(`[ACH][PROGRESS_INDEX] process_complete appid=${appId} ok=${ok}`);
      }).catch((err) => {
        this._debouncedAppIds.delete(appId);
        console.warn(`[ACH][PROGRESS_INDEX] process_error appid=${appId} reason=${err}`);
      });
    }
  }

  // ── processLibrarycacheChange (Part 4): parse librarycache + patch store immediately ──

  // ── Coalescing state for PART 14 ──
  private _syncRunning = false;
  private _syncPendingAppIds = new Set<string>();

  /**
   * Process a librarycache file change for a specific appId.
   * Called from the Tauri watcher event, polling fallback, focus rescan, and dev simulate.
   *
   * Realtime scope: active/visible/LumaForge-launched appIds where an
   * in-memory canonical base exists. Externally launched games without
   * an in-memory base are skipped — use Manual Refresh Achievements.
   *
   * Does NOT require GameDetails, modal, or any mounted component.
   */
  async processLibrarycacheChange(
    appId: string,
    _path: string,
    source: string,
    traceId: string,
  ): Promise<boolean> {
    if (DEBUG_ACH_WATCHER) console.log(`[ACH][SYNC_TRACE] appid=${appId} stage=process-start`);
    console.log(`[ACH][PIPELINE] process_start appid=${appId} source=${source}`);
    if (DEBUG_ACH_WATCHER) console.log(`[ACH][WATCHER_STATE] event=global appidsProcessing=${this._syncRunning ? 1 : 0} queuedAppIds=${this._syncPendingAppIds.size}`);

    // Coalescing: if already running, mark pending and return
    if (this._syncRunning) {
      this._syncPendingAppIds.add(appId);
      console.log(`[ACH][PIPELINE] process_coalesced appid=${appId} pending=${this._syncPendingAppIds.size}`);
      if (DEBUG_ACH_WATCHER) console.log(`[ACH][WATCHER_STATE] event=coalesced appid=${appId} totalQueued=${this._syncPendingAppIds.size}`);
      return false;
    }

    this._syncRunning = true;

    try {
      // Stable file check
      const stable = await waitStableFile(appId, this._steamPath, this._steamAccountId, traceId);
      console.log(`[ACH][PIPELINE] stable_check appid=${appId} stable=${stable}`);
      if (!stable) {
        console.log(`[ACH][PIPELINE] process_skipped appid=${appId} reason=file-not-stable`);
        return false;
      }

      // Pre-load canonical base from disk cache
      const hasMem = !!achievementStore.getSummary(appId);
      console.log(`[ACH][PIPELINE] canonical_check appid=${appId} hasInMemory=${hasMem}`);
      if (!hasMem) {
        let loaded = false;
        try {
          const cached = await readAchievementCacheWithFallback(Number(appId));
          console.log(`[ACH][PIPELINE] canonical_disk appid=${appId} found=${!!cached}`);
          if (cached) {
            const cachedSummary = this.cacheToSummary(appId, cached);
            if (DEBUG_ACH_WATCHER) console.log(`[ACH][SUMMARY_SOURCE] appid=${appId} source=cache(watcher) unlocked=${cachedSummary.unlocked}/${cachedSummary.total} updatedAt=${cachedSummary.updatedAt} progressAvailable=${cachedSummary.progressAvailable}`);
            achievementStore.setSummary(appId, cachedSummary);
            loaded = true;
            console.log(`[ACH][PIPELINE] canonical_loaded appid=${appId} total=${cachedSummary.total} unlocked=${cachedSummary.unlocked}`);
          }
        } catch (e) {
          console.log(`[ACH][PIPELINE] canonical_disk_err appid=${appId} error=${e}`);
        }

        if (!loaded) {
          console.log(`[ACH][PIPELINE] canonical_skip appid=${appId} reason=no-disk-cache continuing-with-patch`);
        }
      }

      // If usergamestats-triggered, read schema binary + binary stats directly.
      // Same model as reference app (Achievements-1.2.2):
      // - Schema binary: stat_id, bit, name, icon per achievement
      // - Binary stats: bitmask (data_u32) + timestamps (AchievementTimes)
      // - Unlock detection: ((data_u32 >>> bit) & 1) === 1
      // - Timestamps: stat.times[bit] for unlock time
      // NO librarycache dependency — reads binary files directly.
      let effectivePatch: ProgressPatch | null = null;
      if (source === "usergamestats" || source === "librarycache") {
        console.log(`[ACH][PIPELINE] usergamestats_direct appid=${appId} reading-schema+binary-stats`);
        try {
          // Step 1: Read schema binary for achievement metadata (stat_id + bit)
          let schemaEntries: { api_name: string; stat_id?: number; bit?: number; progress_stat_id?: number; progress_min?: number; progress_max?: number; name?: string; icon?: string; description?: string }[] = [];
          try {
            const scanResult = await scanSteamAppcacheAchievements({
              steamPath: this._steamPath,
              steamAccountId: this._steamAccountId,
              appId: Number(appId),
            });
            if (scanResult.schema_file_found && scanResult.parsed_schema.length > 0) {
              schemaEntries = scanResult.parsed_schema;
              console.log(`[ACH][PIPELINE] usergamestats_direct appid=${appId} schema-entries=${schemaEntries.length}`);
            }
          } catch (e) {
            console.log(`[ACH][PIPELINE] usergamestats_direct appid=${appId} schema-binary-failed: ${e}`);
          }

          // Step 2: Read binary stats — bitmask + timestamps (same as reference app)
          let statsMap = new Map<number, number>(); // stat_id → data_u32 bitmask
          let timestampMap = new Map<string, number>(); // "statId:bit" → unlock timestamp
          try {
            const { parseUserGameStatsRaw } = await import("./tauri");
            const statsResult = await parseUserGameStatsRaw({
              steamPath: this._steamPath,
              steamAccountId: this._steamAccountId,
              appId: Number(appId),
            });
            if (statsResult.stat_pairs.length > 0) {
              for (const pair of statsResult.stat_pairs) {
                statsMap.set(pair.stat_id, pair.value);
                if (pair.unlock_times) {
                  for (const [bit, ts] of Object.entries(pair.unlock_times)) {
                    timestampMap.set(`${pair.stat_id}:${bit}`, ts);
                  }
                }
              }
              console.log(`[ACH][PIPELINE] usergamestats_direct appid=${appId} stats=${statsMap.size} timestamps=${timestampMap.size}`);
            }
          } catch (e) {
            console.log(`[ACH][PIPELINE] usergamestats_direct appid=${appId} stats-failed: ${e}`);
          }

          // Step 3: Bitmask extraction — same as reference app
          // Reference: earned = ((data_u32 >>> bit) & 1) === 1
          if (schemaEntries.length > 0 && statsMap.size > 0) {
            const progressMap = new Map<string, { unlocked: boolean; unlockTime?: number; progress?: number; maxProgress?: number }>();
            let unlocked = 0;

            for (const entry of schemaEntries) {
              if (entry.stat_id == null || entry.bit == null) continue;
              const statValue = statsMap.get(entry.stat_id) ?? 0;
              const isUnlocked = ((statValue >>> entry.bit) & 1) === 1;
              const timestamp = timestampMap.get(`${entry.stat_id}:${entry.bit}`);
              if (isUnlocked) unlocked++;
              progressMap.set(entry.api_name, {
                unlocked: isUnlocked,
                unlockTime: timestamp,
              });
            }

            effectivePatch = {
              appid: appId,
              total: schemaEntries.length,
              unlocked,
              progressMap,
              authoritative: true,
            };
            console.log(`[ACH][PIPELINE] usergamestats_direct appid=${appId} total=${effectivePatch.total} unlocked=${unlocked} source=binary-stats authoritative=true`);
          } else if (schemaEntries.length > 0) {
            const progressMap = new Map<string, { unlocked: boolean }>();
            for (const entry of schemaEntries) {
              progressMap.set(entry.api_name, { unlocked: false });
            }
            effectivePatch = {
              appid: appId,
              total: schemaEntries.length,
              unlocked: 0,
              progressMap,
            };
            console.log(`[ACH][PIPELINE] usergamestats_direct appid=${appId} total=${schemaEntries.length} unlocked=0 source=schema-only`);
          } else {
            console.log(`[ACH][PIPELINE] usergamestats_direct appid=${appId} no-schema-entries`);
          }
        } catch (e) {
          console.warn(`[ACH][PIPELINE] usergamestats_direct appid=${appId} error=${e}`);
        }
      }

      // No librarycache fallback — binary stats is the only fast-path source.
      // Schedule resolver refresh to get authoritative data when binary stats unavailable.
      if (!effectivePatch) {
        console.log(`[ACH][PIPELINE] no-binary-stats appid=${appId} scheduling-resolver-refresh`);
        this._scheduleResolverRefresh(appId, traceId).catch(() => {});
        return false;
      }

      // Downgrade guard: reject stale librarycache data that is lower than current known count
      // EXCEPTION: usergamestats (binary appcache) is authoritative — always accept its data
      const currentSummary = achievementStore.getSummary(appId);
      const isAuthoritativeSource = source === "usergamestats";
      if (currentSummary && effectivePatch.unlocked < (currentSummary.unlocked ?? 0) && !isAuthoritativeSource) {
        console.log(`[ACH][SYNC_SKIP] appid=${appId} reason=stale-librarycache current=${currentSummary.unlocked ?? "?"}/${currentSummary.total} patch=${effectivePatch.unlocked}/${effectivePatch.total}`);
        console.log(`[ACH][PIPELINE] process_skipped appid=${appId} reason=stale-librarycache current=${currentSummary.unlocked ?? "?"}/${currentSummary.total} patch=${effectivePatch.unlocked}/${effectivePatch.total}`);
        console.log(`[ACH][MANUAL_NEEDED_REASON] appid=${appId} reason=stale-librarycache current=${currentSummary.unlocked}/${currentSummary.total} patch=${effectivePatch.unlocked}/${effectivePatch.total}`);
        // Schedule resolver refresh as fallback to get authoritative data
        this._scheduleResolverRefresh(appId, traceId).catch(() => {});
        return false;
      }

      // Log progress patch
      console.debug(
        `[ACH][FAST_PROGRESS][${traceId}] parsed total=${effectivePatch.total} achieved=${effectivePatch.unlocked} entries=${effectivePatch.progressMap.size}`,
      );

      // Log first few achieved entries
      let logged = 0;
      for (const [apiName, progress] of effectivePatch.progressMap) {
        if (progress.unlocked && logged < 3) {
          console.debug(`[ACH][FAST_PROGRESS][${traceId}] achieved apiName=${apiName} unlockTime=${progress.unlockTime ?? "null"}`);
          logged++;
        }
      }

      const previousUnlocked = currentSummary?.unlocked ?? 0;
      const result = achievementStore.applyProgressPatch(appId, effectivePatch, traceId);
      if (DEBUG_ACH_WATCHER) console.log(`[ACH][SYNC_TRACE] appid=${appId} stage=apply-result result=${!!result}`);
      console.log(`[ACH][PIPELINE] apply_result appid=${appId} result=${!!result}`);
      if (!result) {
        console.log(`[ACH][PIPELINE] process_skipped appid=${appId} reason=applyProgressPatch-returned-null`);
        return false;
      }

      // Content retry: when librarycache file changed but content still shows old count
      // (external unlocker timing — metadata updates before achievement data is written)
      const delta = effectivePatch.unlocked - previousUnlocked;
      const isRetrySource = source === "content-retry";
      const isWatcherEvent = source === "librarycache" || source === "watcher";
      if (delta === 0 && isWatcherEvent && !isRetrySource && effectivePatch.progressMap.size > 0) {
        console.log(`[ACH][CONTENT_RETRY] appid=${appId} delta=0 patch=${effectivePatch.unlocked} previous=${previousUnlocked} source=${source} scheduling-retry`);
        this._scheduleContentRetry(appId, _path, traceId);
      } else if (delta > 0) {
        // Clear retry state on successful unlock (no more retries needed)
        this._contentRetryCounts.delete(appId);
        console.log(`[ACH][CONTENT_RETRY] appid=${appId} delta=+${delta} retry-state-cleared`);
      }

      console.log(`[ACH][PIPELINE] process_done appid=${appId} source=${source}`);
      // Fill missing icons from disk cache in background
      achievementStore.fillMissingIconsFromCache(appId, traceId).catch(() => {});
      // Mark the startup snapshot dirty so achievementSummary stays current across refreshes
      import("./startupSnapshotService")
        .then(({ notifyMediaUpdated }) => notifyMediaUpdated(appId, { source: "achievement-progress" }))
        .catch(() => {});
      return true;
    } catch (err) {
      console.warn(`[ACH][PIPELINE] process_failed appid=${appId} error=${err}`);
      return false;
    } finally {
      this._syncRunning = false;
      if (DEBUG_ACH_WATCHER) console.log(`[ACH][WATCHER_STATE] event=after-process appid=${appId} processing=${this._syncRunning} queued=${this._syncPendingAppIds.size}`);
      // Process coalesced follow-up — preserve remaining appIds for next finally
      if (this._syncPendingAppIds.size > 0) {
        const pendingCount = this._syncPendingAppIds.size;
        const nextAppId = this._syncPendingAppIds.values().next().value!;
        this._syncPendingAppIds.delete(nextAppId);
        if (nextAppId) {
          console.log(`[ACH][PIPELINE] process_followup appid=${nextAppId} totalPending=${pendingCount - 1}`);
          const nextTrace = nextTraceId();
          this.processLibrarycacheChange(nextAppId, "coalesced", source, nextTrace).catch((err) => {
            console.warn(`[ACH][WATCHER_STUCK] appid=${nextAppId} reason=followup-failed error=${err}`);
          });
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

  // ── Content retry: re-read librarycache after delay when delta=0 ──

  private _scheduleContentRetry(appId: string, path: string, traceId: string): void {
    const retryCount = this._contentRetryCounts.get(appId) ?? 0;
    if (retryCount >= AchievementWatcherService.CONTENT_RETRY_MAX) {
      console.log(`[ACH][CONTENT_RETRY] appid=${appId} skipped reason=max-retries-reached count=${retryCount}`);
      this._contentRetryCounts.delete(appId);
      return;
    }
    if (this._contentRetryPending.has(appId)) {
      console.log(`[ACH][CONTENT_RETRY] appid=${appId} skipped reason=already-pending`);
      return;
    }
    this._contentRetryPending.add(appId);
    this._contentRetryCounts.set(appId, retryCount + 1);
    const delay = AchievementWatcherService.CONTENT_RETRY_DELAY_MS;
    console.log(`[ACH][CONTENT_RETRY] appid=${appId} scheduled delay=${delay}ms retry=${retryCount + 1}/${AchievementWatcherService.CONTENT_RETRY_MAX}`);
    window.setTimeout(() => {
      this._contentRetryPending.delete(appId);
      this.processLibrarycacheChange(appId, path, "content-retry", traceId).catch((err) => {
        console.warn(`[ACH][CONTENT_RETRY] appid=${appId} error=${err}`);
      });
    }, delay);
  }

  // ── Resolver refresh fallback for stale/partial librarycache data ──

  private _pendingResolverAppIds = new Set<string>();

  private async _scheduleResolverRefresh(appId: string, _traceId: string): Promise<void> {
    if (this._pendingResolverAppIds.has(appId)) {
      console.debug(`[ACH][RT_RESOLVER_SKIP] appid=${appId} reason=already-pending`);
      return;
    }
    this._pendingResolverAppIds.add(appId);

    try {
      // Wait 3s for librarycache to stabilize before using resolver
      await sleep(500);

      const { resolveSteamAchievements } = await import("./steamAchievementsResolver");
      const summary = await resolveSteamAchievements({
        appId: Number(appId),
        steamPath: this._steamPath,
        accountId: this._steamAccountId,
        steamWebApiKey: this._steamWebApiKey,
      });

      if (!summary || !summary.achievements) {
        console.log(`[ACH][RT_RESOLVER_FAILED] appid=${appId} reason=no-summary`);
        return;
      }

      // Build ProgressPatch from resolver summary — applyProgressPatch detects unlocks + fires toasts
      const patch: ProgressPatch = {
        appid: appId,
        total: summary.total,
        unlocked: summary.unlocked ?? 0,
        progressMap: new Map(summary.achievements.map(a => [a.apiName, {
          unlocked: a.unlocked,
          unlockTime: a.unlockTime,
          progress: a.progress,
          maxProgress: a.maxProgress,
        }])),
      };

      console.log(`[ACH][RT_RESOLVER_REFRESH] appid=${appId} total=${patch.total} unlocked=${patch.unlocked}`);
      achievementStore.applyProgressPatch(appId, patch, _traceId);

      // Enqueue image downloads for this game immediately after schema resolution
      try {
        const { enqueueAchievementImageJobs } = await import("./backgroundJobQueue");
        enqueueAchievementImageJobs([appId], "normal");
        console.log(`[ACH][RT_RESOLVER_IMG_ENQUEUE] appid=${appId} queued`);
      } catch { /* non-critical */ }

      // Mark the startup snapshot dirty
      import("./startupSnapshotService")
        .then(({ notifyMediaUpdated }) => notifyMediaUpdated(appId, { source: "achievement-progress" }))
        .catch(() => {});
    } catch (err) {
      console.warn(`[ACH][RT_RESOLVER_FAILED] appid=${appId} reason=${err}`);
    } finally {
      this._pendingResolverAppIds.delete(appId);
    }
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
          // Seed from existing disk cache (no librarycache dependency)
          const cached = await readAchievementCacheWithFallback(Number(appIdStr));
          if (cached && cached.achievements && cached.achievements.length > 0) {
            const appSnap: AppSnapshot = {};
            for (const entry of cached.achievements) {
              appSnap[entry.api_name] = entry.unlocked;
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
      progressStatId: entry.progress_stat_id,
      progressMin: entry.progress_min,
      progressMax: entry.progress_max,
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
