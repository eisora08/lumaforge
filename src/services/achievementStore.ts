import type {
  GameAchievement,
  GameAchievementsSummary,
  UnlockEvent,
} from "../types/gameAchievements";
import { parseLibraryCacheAchievements, writeAchievementCache, readAchievementCache } from "./tauri";
import { ACHIEVEMENTS_AUTO_ENABLED } from "./achievementAutoFlags";

// ---------------------------------------------------------------------------
// Emergency stabilization flags
// ---------------------------------------------------------------------------

export const ACHIEVEMENT_SCHEMA_MIGRATION_AUTO = false;
export const ACHIEVEMENT_IMAGE_MIGRATION_AUTO = false;
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
  "steam-web-api": 2,
  "steam-web-api-stale": 3,
  "steam-appcache": 4,
  "steam-appcache-stale": 5,
  "librarycache-stale": 6,
  "schema-only": 7,
  "setup-required": 8,
  "disabled": 9,
  "unavailable": 10,
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
  progressMap: Map<string, { unlocked: boolean; unlockTime?: number }>;
  rarityMap?: Map<string, number>;
  /** Per-apiName raw icon path from librarycache (str_image), e.g. "img/hash.jpg" */
  iconMap?: Map<string, { icon?: string; iconGray?: string }>;
};

export type StoreUpdateCallback = (appId: string, summary: GameAchievementsSummary) => void;
export type UnlockCallback = (appId: string, unlocks: UnlockEvent[], gameTitle?: string) => void;

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
    if (existing) {
      const accepted = isSourceNewerOrEqual(
        safeSummary.source, safeSummary.updatedAt,
        existing.source, existing.updatedAt,
      );
      if (DEBUG_ACH_VERBOSE) console.log(
        `[ACH][SUMMARY_SOURCE] appid=${appId} source=${safeSummary.source} ` +
        `unlocked=${safeSummary.unlocked}/${safeSummary.total} updatedAt=${safeSummary.updatedAt} ` +
        `progressAvailable=${safeSummary.progressAvailable} accepted=${accepted} ` +
        `existingSource=${existing.source} existingUnlocked=${existing.unlocked}/${existing.total} existingUpdatedAt=${existing.updatedAt}`
      );
      if (!accepted) {
        if (DEBUG_ACH_VERBOSE) console.log(`[ACH][SUMMARY_MERGE] appid=${appId} rejected reason=older-or-equal-source`);
        return;
      }
      if (accepted && existing.source !== safeSummary.source) {
        if (DEBUG_ACH_VERBOSE) console.log(`[ACH][SUMMARY_MERGE] appid=${appId} old=${existing.source}:${existing.unlocked}/${existing.total} new=${safeSummary.source}:${safeSummary.unlocked}/${safeSummary.total} accepted=true reason=newer-source`);
      }
    } else {
      if (DEBUG_ACH_VERBOSE) console.log(
        `[ACH][SUMMARY_SOURCE] appid=${appId} source=${safeSummary.source} ` +
        `unlocked=${safeSummary.unlocked}/${safeSummary.total} updatedAt=${safeSummary.updatedAt} ` +
        `progressAvailable=${safeSummary.progressAvailable} accepted=true reason=first-summary`
      );
    }
    this.summariesByAppId.set(appId, safeSummary);
    this.notify(appId, safeSummary);
  }

  // ── Fast progress patch from librarycache ──

  applyProgressPatch(
    appId: string,
    patch: ProgressPatch,
    traceId?: string,
  ): GameAchievementsSummary | null {
    const tid = traceId ?? "no-trace";
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
          total: patch.total,
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

    // Merge progress into existing achievements
    const mergedAchievements: GameAchievement[] = (current.achievements ?? []).map((ach) => {
      const progress = patch.progressMap.get(ach.apiName);
      if (!progress) return ach;
      return {
        ...ach,
        unlocked: progress.unlocked || ach.unlocked,
        unlockTime: progress.unlockTime ?? ach.unlockTime,
        rarityPercent: patch.rarityMap?.get(ach.apiName) ?? ach.rarityPercent,
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
    const total = Math.max(patch.total, current.total);
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
    const tid = traceId ?? "no-trace";
    try {
      const appIdNum = Number(appId);
      const existing = await readAchievementCache(appIdNum);
      if (existing) {
        const patchedAchievements = existing.achievements.map((entry) => {
          const ach = summary.achievements?.find((a) => a.apiName === entry.api_name);
          if (ach) {
            return {
              ...entry,
              unlocked: ach.unlocked,
              unlock_time: ach.unlockTime ? Math.floor(ach.unlockTime / 1000) : entry.unlock_time,
            };
          }
          return entry;
        });

        await writeAchievementCache(appIdNum, {
          summary: {
            ...existing.summary,
            unlocked: summary.unlocked ?? existing.summary.unlocked,
            total: summary.total ?? existing.summary.total,
            percent: summary.percent ?? existing.summary.percent,
            progress_available: true,
            source: "librarycache",
            updated_at: Date.now(),
          },
          achievements: patchedAchievements,
          achievement_percentages: existing.achievement_percentages,
        }, false);
      }
      console.debug(`[ACH][CACHE][${tid}] background write complete`);
    } catch {
      // background write failure is non-critical
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

// ---------------------------------------------------------------------------
// Fast progress patch helper — parse librarycache and build patch
// ---------------------------------------------------------------------------

export async function buildProgressPatchFromLibraryCache(
  appId: string,
  steamPath?: string,
  accountId?: string,
  traceId?: string,
): Promise<ProgressPatch | null> {
  const tid = traceId ?? "no-trace";
  if (!accountId) return null;

  try {
    const libResult = await parseLibraryCacheAchievements({
      appId: Number(appId),
      steamAccountId: accountId,
      steamPath,
    });

    if (!libResult.progress_available || !libResult.n_total || libResult.n_total <= 0) {
      return null;
    }

    const progressMap = new Map<string, { unlocked: boolean; unlockTime?: number }>();
    const rarityMap = new Map<string, number>();
    const iconMap = new Map<string, { icon?: string; iconGray?: string }>();

    for (const entry of libResult.entries) {
      const apiName = entry.str_id ?? "";
      if (!apiName) continue;

      const unlocked = entry.b_achieved === true;
      const rawUnlockTime = entry.rt_unlocked ?? 0;
      const unlockTime =
        rawUnlockTime > 0 && rawUnlockTime < 1000000000000
          ? rawUnlockTime * 1000
          : rawUnlockTime > 0
            ? rawUnlockTime
            : undefined;

      progressMap.set(apiName, { unlocked, unlockTime });

      if (entry.fl_achieved != null) {
        rarityMap.set(apiName, entry.fl_achieved);
      }

      if (entry.str_image) {
        iconMap.set(apiName, { icon: entry.str_image });
      }
    }

    console.debug(
      `[ACH][FAST_PROGRESS][${tid}] parsed total=${libResult.n_total} achieved=${libResult.n_achieved} entries=${libResult.entries.length} icons=${iconMap.size}`,
    );

    return {
      appid: appId,
      total: libResult.n_total,
      unlocked: libResult.n_achieved ?? 0,
      progressMap,
      rarityMap,
      iconMap: iconMap.size > 0 ? iconMap : undefined,
    };
  } catch (err) {
    console.warn(`[ACH][FAST_PROGRESS][${tid}] parse failed appid=${appId} reason=${err}`);
    return null;
  }
}