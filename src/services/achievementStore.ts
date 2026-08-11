import type {
  GameAchievement,
  GameAchievementsSummary,
  UnlockEvent,
} from "../types/gameAchievements";
import { writeAchievementCache } from "./tauri";
import { ACHIEVEMENTS_AUTO_ENABLED } from "./achievementAutoFlags";

// ---------------------------------------------------------------------------
// Emergency stabilization flags
// ---------------------------------------------------------------------------

export const ACHIEVEMENT_SCHEMA_MIGRATION_AUTO = false;
export const DEBUG_ACH_MIGRATION = false;
export const DEBUG_ACH_VERBOSE = false;
let _migrationSkipLogged = false;

function logMigrationSkipOnce(): void {
  if (!_migrationSkipLogged) {
    _migrationSkipLogged = true;
    console.log("[ACH][SCHEMA_MIGRATE_SKIP] reason=auto-disabled");
  }
}

// ---------------------------------------------------------------------------
// Source priority — lower number = higher priority (takes precedence)
// ---------------------------------------------------------------------------

export const SOURCE_PRIORITY: Record<string, number> = {
  "librarycache": 0,
  "local-cache": 1,
  "local-cache-stale": 1,
  "binary-stats": 2,
  "steam-web-api": 3,
  "steam-web-api-stale": 4,
  "steam-appcache": 5,
  "steam-appcache-stale": 6,
  "schema-generated": 7,
  "librarycache-stale": 8,
  "schema-only": 9,
  "setup-required": 10,
  "disabled": 11,
  "unavailable": 12,
};

export function isSourceNewerOrEqual(
  incomingSource: string,
  incomingTime: number | undefined,
  existingSource: string | undefined,
  existingTime: number | undefined,
): boolean {
  const inPri = SOURCE_PRIORITY[incomingSource] ?? 99;
  const exPri = SOURCE_PRIORITY[existingSource ?? ""] ?? 99;

  // Higher-priority source always wins (lower number = higher priority)
  if (inPri < exPri) return true;
  if (inPri > exPri) return false;

  // Same priority: newer timestamp wins
  if (incomingTime != null && existingTime != null) {
    return incomingTime >= existingTime;
  }

  // If only one has a timestamp, that one wins
  if (incomingTime != null) return true;
  if (existingTime != null) return false;

  // Neither has timestamp — incoming replaces existing
  return true;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProgressPatch = {
  appid: string;
  total: number;
  unlocked: number;
  progressMap: Map<string, { unlocked: boolean; unlockTime?: number; progress?: number; maxProgress?: number }>;
  rarityMap?: Map<string, number>;
  /** Per-apiName raw icon path from librarycache (str_image), e.g. "img/hash.jpg" */
  iconMap?: Map<string, { icon?: string; iconGray?: string }>;
};

export type ProgressChangeEvent = {
  apiName: string;
  name: string;
  progress: number;
  maxProgress: number;
  prevProgress?: number;
};

export type StoreUpdateCallback = (appId: string, summary: GameAchievementsSummary) => void;
export type UnlockCallback = (appId: string, unlocks: UnlockEvent[], gameTitle?: string) => void;
export type ProgressChangeCallback = (appId: string, changes: ProgressChangeEvent[]) => void;

// ---------------------------------------------------------------------------
// Unlock snapshot persistence
// ---------------------------------------------------------------------------

const SNAPSHOT_KEY = "lumaforge-achievement-unlock-snapshot-v1";

function loadSnapshots(): Record<string, Record<string, boolean>> {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSnapshots(snapshots: Record<string, Record<string, boolean>>): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots));
  } catch {
    // storage full, ignore
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class AchievementStoreImpl {
  private summariesByAppId = new Map<string, GameAchievementsSummary>();
  private subscribers = new Set<StoreUpdateCallback>();
  private unlockCallbacks = new Set<UnlockCallback>();
  private progressChangeCallbacks = new Set<ProgressChangeCallback>();
  // Debounce: prevent watcher from overwriting during writes
  private _lastWriteTime = new Map<string, number>();
  // Guard: prevent applyProgressPatch from overwriting while setSummary is writing
  private _writingToDisk = new Set<string>();

  // ── Subscriptions ──

  subscribe(cb: StoreUpdateCallback): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  onUnlock(cb: UnlockCallback): () => void {
    this.unlockCallbacks.add(cb);
    return () => {
      this.unlockCallbacks.delete(cb);
    };
  }

  onProgressChange(cb: ProgressChangeCallback): () => void {
    this.progressChangeCallbacks.add(cb);
    return () => {
      this.progressChangeCallbacks.delete(cb);
    };
  }

  // ── Read ──

  getSummary(appId: string): GameAchievementsSummary | undefined {
    return this.summariesByAppId.get(appId);
  }

  getAllSummaries(): Map<string, GameAchievementsSummary> {
    return new Map(this.summariesByAppId);
  }

  /** Remove a store entry so the next setSummary is always accepted (used by manual refresh) */
  deleteSummary(appId: string): void {
    this.summariesByAppId.delete(appId);
  }

  // ── Write full summary (from resolver) ──

  setSummary(appId: string, summary: GameAchievementsSummary): void {
    // Normalize missing source / updatedAt to prevent SOURCE_PRIORITY crashes
    const safeSummary = {
      ...summary,
      source: summary.source ? summary.source : "local-cache",
      updatedAt: summary.updatedAt || Date.now(),
    };
    const existing = this.summariesByAppId.get(appId);
    let finalSummary: GameAchievementsSummary;

    if (existing) {
      // Reject librarycache downgrade over binary-stats (librarycache can be stale)
      if (safeSummary.unlocked != null && existing.unlocked != null
          && safeSummary.unlocked < existing.unlocked
          && safeSummary.source === "librarycache" && existing.source === "binary-stats") {
        console.debug(`[ACH][SUMMARY_MERGE] appid=${appId} rejected reason=librarycache-stale-overwrites-binary-stats existing=${existing.unlocked}/${existing.total} incoming=${safeSummary.unlocked}/${safeSummary.total}`);
        return;
      }
      const accepted = isSourceNewerOrEqual(
        safeSummary.source, safeSummary.updatedAt,
        existing.source, existing.updatedAt,
      );
      if (!accepted) {
        if (DEBUG_ACH_VERBOSE) console.log(`[ACH][SUMMARY_MERGE] appid=${appId} rejected reason=older-or-equal-source`);
        return;
      }
      // Trust the incoming source — use its unlock states directly
      // (prevents stale data from perpetuating via never-downgrade OR merge)
      const mergedAchievements = safeSummary.achievements.map(a => {
        const existingAch = existing.achievements?.find(e => e.apiName === a.apiName);
        return {
          ...a,
          // Use incoming unlock state — if existing has schema fields the new source doesn't, preserve those
          name: a.name && a.name !== a.apiName ? a.name : (existingAch?.name ?? a.name),
          description: a.description ?? existingAch?.description,
          iconUrl: a.iconUrl ?? existingAch?.iconUrl,
          iconGrayUrl: a.iconGrayUrl ?? existingAch?.iconGrayUrl,
          statId: a.statId ?? existingAch?.statId,
          bit: a.bit ?? existingAch?.bit,
          progressStatId: a.progressStatId ?? existingAch?.progressStatId,
          progressMin: a.progressMin ?? existingAch?.progressMin,
          progressMax: a.progressMax ?? existingAch?.progressMax,
          // Unlock status: trust incoming source
          unlocked: a.unlocked,
          unlockTime: a.unlockTime ?? existingAch?.unlockTime,
          progress: a.progress ?? existingAch?.progress,
          maxProgress: a.maxProgress ?? existingAch?.maxProgress,
        };
      });
      // Use incoming unlock count — trust the latest source
      const mergedUnlocked = safeSummary.unlocked ?? 0;
      finalSummary = {
        ...safeSummary,
        achievements: mergedAchievements,
        unlocked: mergedUnlocked,
        percent: safeSummary.total > 0 ? Math.round((mergedUnlocked / safeSummary.total) * 100) : 0,
      };
    } else {
      finalSummary = safeSummary;
    }

    this.summariesByAppId.set(appId, finalSummary);
    this.notify(appId, finalSummary);

    // Detect new unlocks and fire callbacks for toasts
    const snapshots = loadSnapshots();
    const oldSnap = snapshots[appId] ?? {};
    const newUnlocks: UnlockEvent[] = [];
    for (const ach of finalSummary.achievements ?? []) {
      if (ach.unlocked && !oldSnap[ach.apiName]) {
        newUnlocks.push({
          apiName: ach.apiName,
          name: ach.name,
          description: ach.description,
          iconUrl: ach.iconUrl,
          iconGrayUrl: ach.iconGrayUrl,
          unlockTime: ach.unlockTime,
          rarityPercent: ach.rarityPercent,
        });
      }
    }
    if (newUnlocks.length > 0) {
      console.log(`[ACH][SETSUMMARY_TOAST] appid=${appId} newUnlocks=${newUnlocks.length} names=${newUnlocks.map(u => u.name).join(",")}`);
      for (const cb of this.unlockCallbacks) {
        try { cb(appId, newUnlocks); } catch {}
      }
    }

    // Save snapshot AFTER unlock detection (so next call can compare)
    const snap: Record<string, boolean> = {};
    for (const ach of finalSummary.achievements ?? []) {
      snap[ach.apiName] = ach.unlocked;
    }
    snapshots[appId] = snap;
    saveSnapshots(snapshots);

    // CRITICAL: Write to disk so data persists when librarycache is deleted
    // Use _writingToDisk flag to prevent applyProgressPatch from overwriting
    if (!this._writingToDisk.has(appId)) {
      this._writingToDisk.add(appId);
      this.writeCacheInBackground(appId, finalSummary, "setSummary")
        .finally(() => this._writingToDisk.delete(appId));
    }
  }

  // ── Fast progress patch from librarycache ──

  applyProgressPatch(
    appId: string,
    patch: ProgressPatch,
    traceId?: string,
  ): GameAchievementsSummary | null {
    const tid = traceId ?? "no-trace";

    // Debounce: skip if wrote recently (prevent overwriting fresh librarycache data)
    // BUT: never skip when the patch has a real unlock delta (new achievement unlocked)
    const now = Date.now();
    const lastWrite = this._lastWriteTime.get(appId) ?? 0;
    const debounceActive = now - lastWrite < 1000;
    if (debounceActive) {
      const currentInStore = this.summariesByAppId.get(appId);
      const currentUnlocked = currentInStore?.unlocked ?? 0;
      const hasNewUnlocks = patch.unlocked > currentUnlocked;
      if (!hasNewUnlocks) {
        console.debug(`[ACH][STORE_PATCH][${tid}] skipped appid=${appId} reason=debounce (${now - lastWrite}ms since last write)`);
        return null;
      }
      // Patch has genuinely new unlocks — process despite debounce
      console.debug(`[ACH][STORE_PATCH][${tid}] debounce-bypassed appid=${appId} reason=new-unlocks patch=${patch.unlocked} current=${currentUnlocked}`);
    }

    // Guard: skip if setSummary is currently writing to disk
    // BUT: never skip when the patch has a real unlock delta
    if (this._writingToDisk.has(appId)) {
      const currentInStore = this.summariesByAppId.get(appId);
      const currentUnlocked = currentInStore?.unlocked ?? 0;
      const hasNewUnlocks = patch.unlocked > currentUnlocked;
      if (!hasNewUnlocks) {
        console.debug(`[ACH][STORE_PATCH][${tid}] skipped appid=${appId} reason=writing-in-progress`);
        return null;
      }
      console.debug(`[ACH][STORE_PATCH][${tid}] writing-in-progress-bypassed appid=${appId} reason=new-unlocks`);
    }

    const RT = appId === "268910";
    if (RT) console.log(`[ACH][RT_STORE_ENTRY] appid=${appId} total=${patch.total} unlocked=${patch.unlocked} mapSize=${patch.progressMap.size} summaryLoaded=${this.summariesByAppId.has(appId)}`);

    // Don't downgrade — only apply if progress is available
    if (!patch.progressMap.size && patch.total === 0) {
      console.debug(`[ACH][STORE_PATCH][${tid}] skipped appid=${appId} reason=empty-patch`);
      return null;
    }

    if (DEBUG_ACH_VERBOSE) console.log(
      `[ACH][SUMMARY_SOURCE] appid=${appId} source=librarycache(patch) ` +
      `unlocked=${patch.unlocked}/${patch.total} progressMap=${patch.progressMap.size} trace=${tid}`
    );

    // ── Build base achievements to patch onto ──
    let current = this.summariesByAppId.get(appId);
    let createdMinimalSummary = false;
    const summaryLoaded = !!current;
    if (RT) console.log(`[ACH][RT_STORE_BASE] appid=${appId} hasExistingSummary=${summaryLoaded} existingUnlocked=${current?.unlocked ?? "N/A"}/${current?.total ?? "N/A"}`);

    console.debug(`[ACH][STORE_PATCH][${tid}] summaryLoaded=${summaryLoaded}`);

    // ── If no existing summary, try cache or build minimal ──
    if (!current) {
      // Check if patch only has a subset of achievements (partial librarycache)
      // Use nTotal/nAchieved for summary, but don't create a partial achievement list.
      // The resolver will fill in the full list later.
      const isPartial = patch.progressMap.size > 0 && patch.total > 0 && (patch.progressMap.size / patch.total) < 0.5;
      if (isPartial) {
        console.debug(`[ACH][STORE_PATCH][${tid}] skipped-minimal-summary reason=partial-librarycache progressMap=${patch.progressMap.size} total=${patch.total}`);
        // Create a minimal summary with correct counts but no incomplete achievements list
        current = {
          appId,
          total: patch.progressMap.size > 0 ? patch.progressMap.size : patch.total,
          unlocked: patch.unlocked,
          percent: patch.total > 0 ? Math.round((patch.unlocked / patch.total) * 100) : 0,
          progressAvailable: true,
          source: "librarycache",
          achievements: [],
          updatedAt: Date.now(),
        };
        this.summariesByAppId.set(appId, current);
        // Don't proceed to merge — just return the minimal total summary
        console.debug(`[ACH][STORE_PATCH][${tid}] partialSummaryReturned total=${current.total} unlocked=${current.unlocked}`);
        return current;
      }

      // Build achievements from patch entries (minimal summary)
      const minimalAchievements: GameAchievement[] = [];
      for (const [apiName, progress] of patch.progressMap) {
        const rawIcon = patch.iconMap?.get(apiName);
        minimalAchievements.push({
          id: apiName,
          apiName,
          name: apiName,
          unlocked: progress.unlocked,
          unlockTime: progress.unlockTime,
          rarityPercent: patch.rarityMap?.get(apiName),
          iconUrl: rawIcon?.icon,
          iconGrayUrl: rawIcon?.iconGray,
        });
      }
      createdMinimalSummary = true;
      current = {
        appId,
        total: patch.total,
        unlocked: patch.unlocked,
        percent: patch.total > 0 ? Math.round((patch.unlocked / patch.total) * 100) : 0,
        progressAvailable: true,
        source: "librarycache",
        achievements: minimalAchievements,
        updatedAt: Date.now(),
      };
      this.summariesByAppId.set(appId, current);
      console.debug(`[ACH][STORE_PATCH][${tid}] createdMinimalSummary=true total=${patch.total} entries=${minimalAchievements.length}`);
    }

    // If current has progress but patch says no progress, keep current
    if (current.progressAvailable && (!patch.progressMap.size || patch.total === 0)) {
      if (RT) console.log(`[ACH][RT_STORE_SKIP] appid=${appId} reason=no-downgrade`);
      console.debug(`[ACH][STORE_PATCH][${tid}] skipped appid=${appId} reason=no-downgrade`);
      return null;
    }

    const prevUnlocked = current.achievements?.filter((a) => a.unlocked).length ?? 0;

    const currentCanonicalTotal = current.achievements?.length ?? 0;
    if (DEBUG_ACH_VERBOSE) console.log(`[ACH][PATCH_MAP] appid=${appId} canonicalTotal=${currentCanonicalTotal} librarycacheNTotal=${patch.total} librarycacheNAchieved=${patch.unlocked} mappedUnlocked=${0}`);

    // Merge progress into existing achievements + detect progress changes
    const progressChanges: ProgressChangeEvent[] = [];
    const mergedAchievements: GameAchievement[] = (current.achievements ?? []).map((ach) => {
      const progress = patch.progressMap.get(ach.apiName);
      if (!progress) return ach;

      // Detect progress change on locked achievements
      if (!progress.unlocked && progress.progress != null && progress.maxProgress != null && progress.maxProgress > 0) {
        const prevProgress = ach.progress;
        if (prevProgress == null || prevProgress !== progress.progress || (ach.maxProgress ?? 0) !== progress.maxProgress) {
          progressChanges.push({
            apiName: ach.apiName,
            name: ach.name,
            progress: progress.progress,
            maxProgress: progress.maxProgress,
            prevProgress,
          });
        }
      }

      return {
        ...ach,
        unlocked: progress.unlocked || ach.unlocked,
        unlockTime: progress.unlockTime ?? ach.unlockTime,
        rarityPercent: patch.rarityMap?.get(ach.apiName) ?? ach.rarityPercent,
        progress: progress.progress ?? ach.progress,
        maxProgress: progress.maxProgress ?? ach.maxProgress,
      };
    });

    // Merge rarity for any entries not in current achievements
    if (patch.rarityMap) {
      for (const [apiName, rarity] of patch.rarityMap) {
        const existing = mergedAchievements.find((a) => a.apiName === apiName);
        if (existing && existing.rarityPercent == null) {
          existing.rarityPercent = rarity;
        }
      }
    }

    // Add any patch entries not already in mergedAchievements
    for (const [apiName, progress] of patch.progressMap) {
      if (!mergedAchievements.find((a) => a.apiName === apiName)) {
        const rawIcon = patch.iconMap?.get(apiName);
        mergedAchievements.push({
          id: apiName,
          apiName,
          name: apiName,
          unlocked: progress.unlocked,
          unlockTime: progress.unlockTime,
          rarityPercent: patch.rarityMap?.get(apiName),
          iconUrl: rawIcon?.icon,
          iconGrayUrl: rawIcon?.iconGray,
        });
      }
    }

    // Full completion: librarycache says all achievements unlocked
    // Mark ALL canonical achievements unlocked regardless of progressMap coverage
    if (patch.unlocked === patch.total && patch.total > 0 && currentCanonicalTotal === patch.total) {
      console.log(`[ACH][FULL_COMPLETION] appid=${appId} nTotal=${patch.total} nAchieved=${patch.unlocked} canonicalTotal=${currentCanonicalTotal} action=mark-all-unlocked`);
      for (const ach of mergedAchievements) {
        ach.unlocked = true;
      }
    }

    const mapCoverage = currentCanonicalTotal > 0 ? patch.progressMap.size / currentCanonicalTotal : 0;
    const mappedUnlocked = mergedAchievements.filter((a) => a.unlocked).length;
    if (DEBUG_ACH_VERBOSE) console.log(`[ACH][PATCH_MAP] appid=${appId} canonicalTotal=${currentCanonicalTotal} librarycacheNTotal=${patch.total} librarycacheNAchieved=${patch.unlocked} mappedUnlocked=${mappedUnlocked} coverage=${(mapCoverage * 100).toFixed(0)}%`);
    const missingCount = currentCanonicalTotal - patch.progressMap.size;
    if (missingCount > 0 && mappedUnlocked < patch.unlocked) {
      if (DEBUG_ACH_VERBOSE) console.log(`[ACH][PATCH_MAP_MISSING] appid=${appId} missingCount=${missingCount} reason=partial-map-mismatch`);
    }

    const newUnlockedCount = mappedUnlocked;
    // Prefer existing total from schema (loaded by resolver from appcache/stats binary).
    // Librarycache patch total is unreliable — nTotal includes DLC/test achievements,
    // and progressMap.size may be partial (librarycache arrays only have recently-changed entries).
    // The schema is the authoritative source for "how many achievements does this game have".
    const total = current.total > 0 ? current.total : patch.total;
    const percent = total > 0 ? Math.round((newUnlockedCount / total) * 100) : 0;

    const patched: GameAchievementsSummary = {
      appId,
      total,
      unlocked: newUnlockedCount,
      percent,
      progressAvailable: true,
      source: "librarycache",
      achievements: mergedAchievements,
      updatedAt: Date.now(),
    };

    const oldUnlocked = `${prevUnlocked}/${current.total}`;
    const newUnlocked = `${newUnlockedCount}/${total}`;
    const accepted = isSourceNewerOrEqual("librarycache", Date.now(), current.source, current.updatedAt);
    console.debug(`[ACH][STORE_PATCH][${tid}] before=${oldUnlocked} after=${newUnlocked}`);
    console.debug(`[ACH][STORE_PATCH][${tid}] summaryLoaded=${this.summariesByAppId.has(appId)} createdMinimalSummary=${createdMinimalSummary}`);
    if (accepted) {
      console.log(`[ACH][SUMMARY_MERGE] appid=${appId} old=${current.source}:${oldUnlocked} new=librarycache:${newUnlocked} accepted=true reason=librarycache-patch`);
    } else {
      console.log(`[ACH][SUMMARY_MERGE] appid=${appId} old=${current.source}:${oldUnlocked} new=librarycache:${newUnlocked} accepted=false reason=existing-newer`);
    }

    // ── Detect new unlocks using SNAPSHOT (loaded BEFORE comparison) ──
    const snapshots = loadSnapshots();
    const oldSnapshot = snapshots[appId] ?? {};
    const hasSnapshot = snapshots[appId] !== undefined;

    // If no snapshot and no previous store progress, create baseline
    const isBaseline = !hasSnapshot && (!current.progressAvailable || prevUnlocked === 0);

    let newUnlocks: UnlockEvent[] = [];

    if (isBaseline) {
      console.debug(`[ACH][TOAST][${tid}] previousSource=none previousUnlocked=${prevUnlocked} currentUnlocked=${newUnlockedCount} newUnlocks=0`);
    } else {
      // Compare old snapshot vs new state
      const prevMap = new Map<string, boolean>();
      for (const [apiName, wasUnlocked] of Object.entries(oldSnapshot)) {
        prevMap.set(apiName, wasUnlocked);
      }
      // Also fill in from current store for any entries not in snapshot
      for (const ach of current.achievements ?? []) {
        if (!prevMap.has(ach.apiName)) {
          prevMap.set(ach.apiName, ach.unlocked);
        }
      }

      for (const ach of mergedAchievements) {
        const wasUnlocked = prevMap.get(ach.apiName) ?? false;
        if (!wasUnlocked && ach.unlocked) {
          newUnlocks.push({
            apiName: ach.apiName,
            name: ach.name,
            description: ach.description,
            iconUrl: ach.iconUrl,
            iconGrayUrl: ach.iconGrayUrl,
            unlockTime: ach.unlockTime,
            rarityPercent: ach.rarityPercent,
          });
        }
      }

      const previousSource = hasSnapshot ? "snapshot" : "store";
      console.debug(`[ACH][TOAST][${tid}] previousSource=${previousSource} previousUnlocked=${prevUnlocked} currentUnlocked=${newUnlockedCount} newUnlocks=${newUnlocks.length}`);
      if (newUnlocks.length > 0) {
        console.log(`[ACH][SYNC_BATCH_ENTRIES] appid=${appId} unlockedApiNames=${newUnlocks.map(u => u.apiName).join(",")}`);
      }
    }

    // Set newlyUnlocked so UI toasts can fire
    patched.newlyUnlocked = newUnlocks;

    // ── Patch store (AFTER unlock detection, BEFORE snapshot save) ──
    // Check freshness against current store value (may have been updated by another source)
    const storeCurrent = this.summariesByAppId.get(appId);
    const patchAccepted = !storeCurrent || isSourceNewerOrEqual(
      patched.source, patched.updatedAt,
      storeCurrent.source, storeCurrent.updatedAt,
    );
    if (RT) console.log(`[ACH][RT_STORE_WRITE_PATCH] appid=${appId} accepted=${patchAccepted} new=${patched.unlocked}/${patched.total} old=${storeCurrent?.unlocked ?? "N/A"}/${storeCurrent?.total ?? "N/A"}`);
    if (!patchAccepted) {
      if (RT) console.log(`[ACH][RT_STORE_SKIP] appid=${appId} reason=existing-newer`);
      console.debug(`[ACH][STORE_PATCH][${tid}] skipped-write reason=existing-newer source=${storeCurrent?.source} updatedAt=${storeCurrent?.updatedAt}`);
      this.notify(appId, storeCurrent!); // re-notify with current state
      return null;
    }
    if (DEBUG_ACH_VERBOSE) console.log(`[ACH][SYNC_TRACE] appid=${appId} stage=store-update unlocked=${patched.unlocked}/${patched.total}`);
    console.log(`[ACH][SYNC_BATCH] appid=${appId} patchUnlocked=${patch.unlocked} previousUnlocked=${prevUnlocked} afterUnlocked=${newUnlockedCount} delta=${newUnlockedCount - prevUnlocked}`);
    this.summariesByAppId.set(appId, patched);
    console.log(`[ACH][STORE_AFTER_PATCH] appid=${appId} unlocked=${patched.unlocked}/${patched.total}`);
    if (RT) console.log(`[ACH][RT_STORE_SET] appid=${appId} unlocked=${patched.unlocked}/${patched.total}`);
    console.debug(`[ACH][STORE_PATCH][${tid}] subscribersNotified=true`);

    // Notify UI subscribers
    this.notify(appId, patched);

    // ── Fire unlock callbacks (toast, native notification) ──
    if (newUnlocks.length > 0) {
      if (RT) console.log(`[ACH][RT_TOAST] appid=${appId} count=${newUnlocks.length} first=${newUnlocks[0]?.apiName ?? "?"}`);
      console.debug(`[ACH][TOAST][${tid}] newUnlocks=${newUnlocks.length}`);
      for (const cb of this.unlockCallbacks) {
        try {
          cb(appId, newUnlocks);
        } catch {
          // don't break
        }
      }
    }

    // ── Fire progress change callbacks ──
    if (progressChanges.length > 0) {
      console.debug(`[ACH][PROGRESS_CHANGE] appid=${appId} changes=${progressChanges.length}`);
      for (const cb of this.progressChangeCallbacks) {
        try {
          cb(appId, progressChanges);
        } catch {
          // don't break
        }
      }
    }

    // ── Save snapshot AFTER patch + notification ──
    const newAppSnap: Record<string, boolean> = {};
    for (const ach of mergedAchievements) {
      newAppSnap[ach.apiName] = ach.unlocked;
    }
    snapshots[appId] = newAppSnap;
    saveSnapshots(snapshots);
    if (RT) console.log(`[ACH][RT_SNAPSHOT] appid=${appId} entries=${Object.keys(newAppSnap).length}`);

    // ── Write cache in background (fire-and-forget, after snapshot save) ──
    if (RT) console.log(`[ACH][RT_CACHE_WRITE_START] appid=${appId} createdMinimal=${createdMinimalSummary}`);
    console.debug(`[ACH][CACHE][${tid}] background write scheduled`);
    if (!createdMinimalSummary) {
      this.writeCacheInBackground(appId, patched, tid).catch(() => {});
    }

    return patched;
  }

  // ── Background cache write ──

  private async writeCacheInBackground(
    appId: string,
    summary: GameAchievementsSummary,
    traceId?: string,
  ): Promise<void> {
    if (!ACHIEVEMENTS_AUTO_ENABLED) {
      return;
    }
    // Debounce: skip if wrote recently (prevent watcher overwrite)
    const now = Date.now();
    const lastWrite = this._lastWriteTime.get(appId) ?? 0;
    if (now - lastWrite < 500) {
      console.debug(`[ACH][CACHE][${traceId}] skipped appid=${appId} reason=debounce`);
      return;
    }
    this._lastWriteTime.set(appId, now);

    const tid = traceId ?? "no-trace";
    try {
      const appIdNum = Number(appId);
      // Use IN-MEMORY summary as source of truth (not disk cache)
      const inMemory = this.summariesByAppId.get(appId) ?? summary;

      // Build achievements from the best available data
      // First, try to read existing disk cache to preserve schema fields (stat_id, bit, name, icons)
      let diskCacheMap: Map<string, any> | null = null;
      let diskPercentages: { name: string; percent: number }[] = [];
      try {
        const { readAchievementCache } = await import("./tauri");
        const diskCache = await readAchievementCache(appIdNum);
        if (diskCache?.achievements?.length) {
          diskCacheMap = new Map(diskCache.achievements.map((e) => [e.api_name, e]));
        }
        if (diskCache?.achievement_percentages?.length) {
          diskPercentages = diskCache.achievement_percentages;
        }
      } catch { /* disk cache read failed — proceed without merge */ }

      const achievements = summary.achievements.map(entry => {
        const existingAch = inMemory.achievements?.find((a) => a.apiName === entry.apiName);
        const diskAch = diskCacheMap?.get(entry.apiName);
        return {
          id: entry.apiName,
          api_name: entry.apiName,
          // Preserve schema fields from disk/in-memory when the entry is minimal
          name: entry.name && entry.name !== entry.apiName
            ? entry.name
            : (diskAch?.name ?? existingAch?.name ?? entry.name),
          description: entry.description ?? diskAch?.description ?? existingAch?.description,
          icon: entry.iconUrl ?? diskAch?.icon ?? diskAch?.icon_url ?? existingAch?.iconUrl,
          icon_gray: entry.iconGrayUrl ?? diskAch?.icon_gray ?? diskAch?.icon_gray_url ?? existingAch?.iconGrayUrl,
          // Trust incoming unlock state — never downgrade from stale disk cache
          unlocked: entry.unlocked,
          unlock_time: entry.unlockTime ? Math.floor(entry.unlockTime / 1000) : existingAch?.unlockTime ?? entry.unlockTime,
          rarity_percent: entry.rarityPercent,
          // Preserve schema fields from disk when entry is missing them
          stat_id: entry.statId ?? diskAch?.stat_id ?? existingAch?.statId,
          bit: entry.bit ?? diskAch?.bit ?? existingAch?.bit,
          progress_stat_id: entry.progressStatId ?? diskAch?.progress_stat_id ?? existingAch?.progressStatId ?? entry.statId,
          progress_min: entry.progressMin ?? diskAch?.progress_min ?? existingAch?.progressMin,
          progress_max: entry.progressMax ?? diskAch?.progress_max ?? existingAch?.progressMax,
        };
      });

      // Trust the incoming unlock count — never inflate from stale sources
      const finalUnlocked = summary.unlocked ?? 0;

      // Preserve existing percentages from disk, or derive from rarityPercent in achievements
      const finalPercentages = diskPercentages.length > 0
        ? diskPercentages
        : achievements
            .filter((a) => a.rarity_percent != null)
            .map((a) => ({ name: a.api_name, percent: Number(a.rarity_percent) }))
            .filter((e) => Number.isFinite(e.percent));

      await writeAchievementCache(appIdNum, {
        summary: {
          app_id: appId,
          total: summary.total,
          unlocked: finalUnlocked,
          percent: summary.total > 0 ? Math.round((finalUnlocked / summary.total) * 100) : 0,
          progress_available: true,
          source: summary.source || "librarycache",
          updated_at: now,
          cache_version: 7,
        },
        achievements,
        achievement_percentages: finalPercentages,
      }, false);

      console.log(`[ACH][CACHE][${tid}] wrote appid=${appId} unlocked=${finalUnlocked}/${summary.total} source=${summary.source}`);

      // SQLite dual-write
      try {
        const { upsertAchievementSummary, batchUpsertAchievementEntries } = await import("./tauri");
        await Promise.all([
          upsertAchievementSummary({
            appId,
            unlocked: finalUnlocked,
            total: summary.total,
            inProgress: finalUnlocked,
            completionTime: null,
            lastUnlockAt: null,
            updatedAt: now,
          }),
          batchUpsertAchievementEntries(achievements.map(a => ({
            appId,
            apiName: a.api_name,
            name: a.name,
            description: a.description ?? null,
            iconUrl: a.icon ?? null,
            iconGrayUrl: a.icon_gray ?? null,
            hidden: false,
            unlocked: a.unlocked,
            unlockTime: a.unlock_time ?? null,
            globalPct: a.rarity_percent ?? null,
            updatedAt: now,
          }))),
        ]);
      } catch (e) {
        console.debug(`[ACH][CACHE][${tid}] SQLite write failed (non-critical):`, e);
      }
    } catch (err) {
      console.warn(`[ACH][CACHE][${tid}] write failed:`, err);
    }
  }

  // ── Fill missing icons from disk cache ──

  async fillMissingIconsFromCache(appId: string, traceId?: string): Promise<void> {
    const tid = traceId ?? "no-trace";
    const summary = this.summariesByAppId.get(appId);
    if (!summary) return;

    const missing = summary.achievements.filter((a) => !a.iconUrl);
    if (missing.length === 0) return;

    try {
      const { readAchievementCache } = await import("./tauri");
      const cached = await readAchievementCache(Number(appId));
      if (!cached) return;

      let filled = 0;
      for (const ach of summary.achievements) {
        if (ach.iconUrl) continue;
        const cachedEntry = cached.achievements.find((e) => e.api_name === ach.apiName);
        if (cachedEntry) {
          const iconUrl = cachedEntry.icon ?? cachedEntry.icon_url;
          const iconGrayUrl = cachedEntry.icon_gray ?? cachedEntry.icon_gray_url;
          if (iconUrl) {
            ach.iconUrl = iconUrl;
            ach.iconGrayUrl = iconGrayUrl;
            filled++;
          }
        }
      }

      if (filled > 0) {
        console.debug(`[ACH][STORE][${tid}] filledMissingIcons appid=${appId} filled=${filled}`);
        this.notify(appId, summary);
      }
    } catch {
      // non-critical
    }
  }

  // ── Part 5: Repair existing cache entries where icon_gray points to img/<hash>.jpg
  // instead of img/<hash>_gray.jpg ──

  async repairGrayIconPaths(appId: string, _traceId?: string): Promise<void> {
    if (!ACHIEVEMENT_SCHEMA_MIGRATION_AUTO) {
      logMigrationSkipOnce();
      return;
    }
    try {
      const { readAchievementCache, writeAchievementCache } = await import("./tauri");
      const cached = await readAchievementCache(Number(appId));
      if (!cached) return;

      let repaired = 0;
      const patched = cached.achievements.map((entry) => {
        const gray = entry.icon_gray_url ?? entry.icon_gray;
        if (!gray) return entry;
        if (gray.startsWith("img/") && !gray.endsWith("_gray.jpg")) {
          const newGray = gray.replace(/\.jpg$/i, "_gray.jpg");
          console.debug(`[ACH][SCHEMA_REPAIR_GRAY] appid=${appId} apiName=${entry.api_name} old=${gray} new=${newGray}`);
          repaired++;
          return { ...entry, icon_gray_url: newGray };
        }
        return entry;
      });

      if (repaired > 0) {
        await writeAchievementCache(Number(appId), {
          achievements: patched,
          achievement_percentages: cached.achievement_percentages,
          summary: cached.summary,
        }, true);
        console.debug(`[ACH][SCHEMA_REPAIR_GRAY] appid=${appId} repaired=${repaired} entries`);
        // Also update in-memory summary if present
        const summary = this.summariesByAppId.get(appId);
        if (summary) {
          for (const ach of summary.achievements) {
            const patch = patched.find((p) => p.api_name === ach.apiName);
            if (patch && patch.icon_gray_url && ach.iconGrayUrl !== patch.icon_gray_url) {
              ach.iconGrayUrl = patch.icon_gray_url;
            }
          }
          this.notify(appId, summary);
        }
      }
    } catch {
      // non-critical repair
    }
  }

  // ── Internal notify ──

  private notify(appId: string, summary: GameAchievementsSummary): void {
    for (const cb of this.subscribers) {
      try {
        cb(appId, summary);
      } catch {
        // don't break
      }
    }
  }
}

export const achievementStore = new AchievementStoreImpl();