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
  "binary-stats": 0,
  "crack": 1,
  "local-cache": 1,
  "local-cache-stale": 1,
  "librarycache": 2,
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
  /** Per-apiName display name override (from schema enrichment, e.g. Tenoke watcher) */
  nameMap?: Map<string, string>;
  /** Per-apiName description override (from KV binary / v7 cache) */
  descriptionMap?: Map<string, string>;
  /** When true, patch comes from binary-stats (authoritative). Replace per-achievement states directly — no OR merge. */
  authoritative?: boolean;
  /** Explicit source override (e.g. "crack" from processCrackIniChange). When set, used instead of inferring from authoritative. */
  source?: GameAchievementsSummary["source"];
};

export type ProgressChangeEvent = {
  apiName: string;
  name: string;
  progress: number;
  maxProgress: number;
  prevProgress?: number;
};

export type StoreUpdateCallback = (appId: string, summary: GameAchievementsSummary, platform?: string) => void;
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
  // Per-platform storage: key = "appId:platform" or "appId" for platform-unknown callers
  private summariesByAppId = new Map<string, GameAchievementsSummary>();
  private subscribers = new Set<StoreUpdateCallback>();
  private unlockCallbacks = new Set<UnlockCallback>();
  private progressChangeCallbacks = new Set<ProgressChangeCallback>();
  // Debounce: prevent watcher from overwriting during writes (keyed by composite key)
  private _lastWriteTime = new Map<string, number>();
  // Guard: prevent applyProgressPatch from overwriting while setSummary is writing (keyed by composite key)
  private _writingToDisk = new Set<string>();

  /** Build composite storage key. When platform is provided, isolation is guaranteed. */
  private compositeKey(appId: string, platform?: string): string {
    return platform ? `${appId}:${platform}` : appId;
  }

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

  getSummary(appId: string, platform?: string): GameAchievementsSummary | undefined {
    if (platform) {
      return this.summariesByAppId.get(this.compositeKey(appId, platform));
    }
    return this.summariesByAppId.get(appId);
  }

  getAllSummaries(): Map<string, GameAchievementsSummary> {
    return new Map(this.summariesByAppId);
  }

  /** Remove a store entry so the next setSummary is always accepted (used by manual refresh) */
  deleteSummary(appId: string, platform?: string): void {
    this.summariesByAppId.delete(this.compositeKey(appId, platform));
  }

  // ── Write full summary (from resolver) ──

  setSummary(appId: string, summary: GameAchievementsSummary, platform?: string, options?: { skipUnlockDetection?: boolean }): void {
    const key = this.compositeKey(appId, platform);
    // Normalize missing source / updatedAt to prevent SOURCE_PRIORITY crashes
    const safeSummary = {
      ...summary,
      source: summary.source ? summary.source : "local-cache",
      updatedAt: summary.updatedAt || Date.now(),
    };
    const existing = this.summariesByAppId.get(key);
    let finalSummary: GameAchievementsSummary;

    if (existing) {
      // ── DOWNGRADE GUARD ──
      // Reject any downgrade when existing data has progress (lock count never decreases via resolver).
      // BUT: when user explicitly chose a platform, always accept (different platform = different truth).
      const isExplicitPlatform = !!platform;
      if (!isExplicitPlatform
          && safeSummary.unlocked != null && existing.unlocked != null
          && safeSummary.unlocked < existing.unlocked
          && existing.progressAvailable) {
        console.log(`[ACH][COUNT_GUARD] appid=${appId} platform=${platform ?? "none"} REJECTED reason=count-decreased existing=${existing.unlocked}/${existing.total} source=${existing.source} incoming=${safeSummary.unlocked}/${safeSummary.total} source=${safeSummary.source}`);
        return;
      }
      // ── SOURCE QUALITY GUARD ──
      // Prevent lower-quality sources from overwriting higher-quality cache data.
      // schema-generated (API display names, descriptions, rarity) > schema-only (KV-only, token names) > unavailable.
      // This fixes a race where schema-only/unavailable writes overwrite the v7 cache
      // that generateAchievementSchema wrote with real display names from the Steam API.
      const SOURCE_QUALITY: Record<string, number> = {
        "schema-generated": 3,
        "kv+api": 3,
        "schema-only": 2,
        "binary-stats": 2,
        "crack": 2,
        "librarycache": 1,
        "unavailable": 0,
      };
      const existingQuality = SOURCE_QUALITY[existing.source] ?? 0;
      const incomingQuality = SOURCE_QUALITY[safeSummary.source ?? ""] ?? 0;
      if (existingQuality > incomingQuality) {
        console.log(`[ACH][QUALITY_GUARD] appid=${appId} platform=${platform ?? "none"} REJECTED reason=lower-quality existing="${existing.source}" (q=${existingQuality}) incoming="${safeSummary.source}" (q=${incomingQuality})`);
        return;
      }
      if (!isExplicitPlatform) {
        const accepted = isSourceNewerOrEqual(
          safeSummary.source, safeSummary.updatedAt,
          existing.source, existing.updatedAt,
        );
        if (!accepted) {
          if (DEBUG_ACH_VERBOSE) console.log(`[ACH][SUMMARY_MERGE] appid=${appId} platform=${platform ?? "none"} rejected reason=older-or-equal-source`);
          return;
        }
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
          rarityPercent: a.rarityPercent ?? existingAch?.rarityPercent,
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

    this.summariesByAppId.set(key, finalSummary);
    this.notify(appId, finalSummary, platform);

    // Detect new unlocks and fire callbacks for toasts
    // Use composite key for snapshots so platform switches don't create false "new unlocks"
    const snapshots = loadSnapshots();
    const snapshotKey = platform ? `${appId}:${platform}` : appId;
    const oldSnap = snapshots[snapshotKey] ?? snapshots[appId] ?? {}; // fallback: bare key for migration
    const prevUnlocked = Object.values(oldSnap).filter(Boolean).length;
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
    // Platinum detection: batch completes 100% of the game
    const finalTotal = finalSummary.total ?? finalSummary.achievements?.length ?? 0;
    const finalUnlocked = finalSummary.unlocked ?? finalSummary.achievements?.filter(a => a.unlocked).length ?? 0;
    if (newUnlocks.length > 0 && finalUnlocked >= finalTotal && finalTotal > 0 && prevUnlocked < finalTotal) {
      newUnlocks[newUnlocks.length - 1].isPlatinum = true;
      console.log(`[ACH][PLATINUM] appid=${appId} triggered at ${finalUnlocked}/${finalTotal} via setSummary`);
    }
    if (!options?.skipUnlockDetection && newUnlocks.length > 0) {
      console.log(`[ACH][SETSUMMARY_TOAST] appid=${appId} newUnlocks=${newUnlocks.length} names=${newUnlocks.map(u => u.name).join(",")}`);
      for (const cb of this.unlockCallbacks) {
        try { cb(appId, newUnlocks); } catch {}
      }
    }

    // Save snapshot AFTER unlock detection (so next call can compare)
    // Use composite key so platform-specific snapshots don't bleed into each other
    const snap: Record<string, boolean> = {};
    for (const ach of finalSummary.achievements ?? []) {
      snap[ach.apiName] = ach.unlocked;
    }
    snapshots[snapshotKey] = snap;
    // Also save under bare appId key so callers without platform (e.g. attemptAchievementRefresh)
    // still find the snapshot instead of treating all achievements as "new"
    if (platform && snapshotKey !== appId) {
      snapshots[appId] = snap;
    }
    saveSnapshots(snapshots);

    // CRITICAL: Write to disk so data persists when librarycache is deleted
    // Use _writingToDisk flag to prevent applyProgressPatch from overwriting
    if (!this._writingToDisk.has(key)) {
      this._writingToDisk.add(key);
      this.writeCacheInBackground(appId, finalSummary, "setSummary", platform)
        .finally(() => this._writingToDisk.delete(key));
    }
  }

  // ── Fast progress patch from librarycache ──

  applyProgressPatch(
    appId: string,
    patch: ProgressPatch,
    traceId?: string,
    platform?: string,
  ): GameAchievementsSummary | null {
    const tid = traceId ?? "no-trace";
    const key = this.compositeKey(appId, platform);

    // Debounce: skip if wrote recently (prevent overwriting fresh librarycache data)
    // BUT: never skip when the patch has a real unlock delta (new achievement unlocked)
    // OR when the patch brings display names, rarity, or descriptions the store doesn't have yet.
    const now = Date.now();
    const lastWrite = this._lastWriteTime.get(key) ?? 0;
    const debounceActive = now - lastWrite < 1000;
    if (debounceActive) {
      const currentInStore = this.summariesByAppId.get(key);
      const currentUnlocked = currentInStore?.unlocked ?? 0;
      const hasNewUnlocks = patch.unlocked > currentUnlocked;
      const hasNewNames = patch.nameMap && patch.nameMap.size > 0;
      const hasNewRarity = !!patch.rarityMap && patch.rarityMap.size > 0;
      const hasNewDescriptions = !!patch.descriptionMap && patch.descriptionMap.size > 0;
      if (!hasNewUnlocks && !hasNewNames && !hasNewRarity && !hasNewDescriptions) {
        console.debug(`[ACH][STORE_PATCH][${tid}] skipped appid=${appId} platform=${platform ?? "none"} reason=debounce (${now - lastWrite}ms since last write)`);
        return null;
      }
      // Patch has genuinely new unlocks, display names, rarity, or descriptions — process despite debounce
      console.debug(`[ACH][STORE_PATCH][${tid}] debounce-bypassed appid=${appId} platform=${platform ?? "none"} reason=${hasNewUnlocks ? "new-unlocks" : hasNewNames ? "new-names" : hasNewRarity ? "new-rarity" : "new-descriptions"} patch=${patch.unlocked} current=${currentUnlocked}`);
    }

    // Guard: skip if setSummary is currently writing to disk
    // BUT: never skip when the patch has a real unlock delta, new display names, rarity, or descriptions
    if (this._writingToDisk.has(key)) {
      const currentInStore = this.summariesByAppId.get(key);
      const currentUnlocked = currentInStore?.unlocked ?? 0;
      const hasNewUnlocks = patch.unlocked > currentUnlocked;
      const hasNewNames = patch.nameMap && patch.nameMap.size > 0;
      const hasNewRarity = !!patch.rarityMap && patch.rarityMap.size > 0;
      const hasNewDescriptions = !!patch.descriptionMap && patch.descriptionMap.size > 0;
      if (!hasNewUnlocks && !hasNewNames && !hasNewRarity && !hasNewDescriptions) {
        console.debug(`[ACH][STORE_PATCH][${tid}] skipped appid=${appId} platform=${platform ?? "none"} reason=writing-in-progress`);
        return null;
      }
      console.debug(`[ACH][STORE_PATCH][${tid}] writing-in-progress-bypassed appid=${appId} platform=${platform ?? "none"} reason=${hasNewUnlocks ? "new-unlocks" : hasNewNames ? "new-names" : hasNewRarity ? "new-rarity" : "new-descriptions"}`);
    }

    const RT = appId === "268910";
    if (RT) console.log(`[ACH][RT_STORE_ENTRY] appid=${appId} platform=${platform ?? "none"} total=${patch.total} unlocked=${patch.unlocked} mapSize=${patch.progressMap.size} summaryLoaded=${this.summariesByAppId.has(key)}`);

    // Don't downgrade — only apply if progress is available
    if (!patch.progressMap.size && patch.total === 0) {
      console.debug(`[ACH][STORE_PATCH][${tid}] skipped appid=${appId} reason=empty-patch`);
      return null;
    }

    if (DEBUG_ACH_VERBOSE) console.log(
      `[ACH][SUMMARY_SOURCE] appid=${appId} source=${patch.source ?? "unknown"} ` +
      `unlocked=${patch.unlocked}/${patch.total} progressMap=${patch.progressMap.size} trace=${tid}`
    );

    // ── Build base achievements to patch onto ──
    let current = this.summariesByAppId.get(key) ?? this.summariesByAppId.get(appId);
    let createdMinimalSummary = false;
    const summaryLoaded = !!current;
    if (RT) console.log(`[ACH][RT_STORE_BASE] appid=${appId} platform=${platform ?? "none"} hasExistingSummary=${summaryLoaded} existingUnlocked=${current?.unlocked ?? "N/A"}/${current?.total ?? "N/A"}`);

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
        this.summariesByAppId.set(key, current);
        // Don't proceed to merge — just return the minimal total summary
        console.debug(`[ACH][STORE_PATCH][${tid}] partialSummaryReturned total=${current.total} unlocked=${current.unlocked}`);
        return current;
      }

      // Build achievements from patch entries (minimal summary)
      const minimalAchievements: GameAchievement[] = [];
      for (const [apiName, progress] of patch.progressMap) {
        const rawIcon = patch.iconMap?.get(apiName);
        let resolvedName = patch.nameMap?.get(apiName);
        if (!resolvedName || resolvedName === apiName) {
          for (const [, s] of this.summariesByAppId) {
            if (s.appId === appId) {
              const found = s.achievements?.find((a) => a.apiName === apiName && a.name && a.name !== a.apiName);
              if (found) { resolvedName = found.name; break; }
            }
          }
        }
        minimalAchievements.push({
          id: apiName,
          apiName,
          name: resolvedName && resolvedName !== apiName ? resolvedName : apiName,
          description: patch.descriptionMap?.get(apiName),
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
      this.summariesByAppId.set(key, current);
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

      // Authoritative (binary-stats): REPLACE unlock state — bin is source of truth
      // Non-authoritative (librarycache): OR merge — librarycache is partial, can't un-unlock
      const unlocked = patch.authoritative ? progress.unlocked : (progress.unlocked || ach.unlocked);

      // Update name from patch.nameMap if current name is just the api_name
      const patchName = patch.nameMap?.get(ach.apiName);
      const name = (patchName && ach.name === ach.apiName) ? patchName : ach.name;
      // Update description from patch.descriptionMap if current description is missing
      const patchDescription = patch.descriptionMap?.get(ach.apiName);
      const description = patchDescription ?? ach.description;
      // Update icon from patch.iconMap if current icon is missing
      const patchIcon = patch.iconMap?.get(ach.apiName);
      const iconUrl = patchIcon?.icon ?? ach.iconUrl;
      const iconGrayUrl = patchIcon?.iconGray ?? ach.iconGrayUrl;

      return {
        ...ach,
        name,
        description,
        iconUrl,
        iconGrayUrl,
        unlocked,
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
        // Look up name: patch nameMap → existing store (any platform) → apiName
        let resolvedName = patch.nameMap?.get(apiName);
        if (!resolvedName || resolvedName === apiName) {
          // Search all summaries for this appId across platforms
          for (const [, s] of this.summariesByAppId) {
            if (s.appId === appId) {
              const found = s.achievements?.find((a) => a.apiName === apiName && a.name && a.name !== a.apiName);
              if (found) { resolvedName = found.name; break; }
            }
          }
        }
        mergedAchievements.push({
          id: apiName,
          apiName,
          name: resolvedName && resolvedName !== apiName ? resolvedName : apiName,
          description: patch.descriptionMap?.get(apiName),
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
    // Skip when authoritative — binary-stats already has exact per-achievement states
    if (!patch.authoritative && patch.unlocked === patch.total && patch.total > 0 && currentCanonicalTotal === patch.total) {
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

    const newUnlockedCount = patch.authoritative ? patch.unlocked : mappedUnlocked;
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
      source: patch.source ?? (patch.authoritative ? "binary-stats" : "librarycache"),
      achievements: mergedAchievements,
      updatedAt: Date.now(),
    };

    const patchSource = patch.source ?? (patch.authoritative ? "binary-stats" : "librarycache");
    const oldUnlocked = `${prevUnlocked}/${current.total}`;
    const newUnlocked = `${newUnlockedCount}/${total}`;
    let accepted = isSourceNewerOrEqual(patchSource, Date.now(), current.source, current.updatedAt);
    // Binary-stats from Steam official path can't downgrade crack/authoritative data.
    // Crack saves have their own complete achievement set that Steam's appcache doesn't know about.
    if (accepted && patchSource === "binary-stats" && (current.source === "crack" || current.source === "binary-stats") && newUnlockedCount < prevUnlocked) {
      accepted = false;
      console.log(`[ACH][SUMMARY_MERGE] appid=${appId} old=${current.source}:${oldUnlocked} new=${patchSource}:${newUnlocked} accepted=false reason=binary-stats-downgrade-guard`);
    }
    console.debug(`[ACH][STORE_PATCH][${tid}] before=${oldUnlocked} after=${newUnlocked} authoritative=${!!patch.authoritative}`);
    console.debug(`[ACH][STORE_PATCH][${tid}] summaryLoaded=${this.summariesByAppId.has(appId)} createdMinimalSummary=${createdMinimalSummary}`);
    if (accepted) {
      console.log(`[ACH][SUMMARY_MERGE] appid=${appId} old=${current.source}:${oldUnlocked} new=${patchSource}:${newUnlocked} accepted=true reason=patch`);
    } else {
      console.log(`[ACH][SUMMARY_MERGE] appid=${appId} old=${current.source}:${oldUnlocked} new=${patchSource}:${newUnlocked} accepted=false reason=existing-newer`);
    }

    // ── Detect new unlocks using SNAPSHOT (loaded BEFORE comparison) ──
    // Use composite key so platform switches don't create false "new unlocks"
    const snapshots = loadSnapshots();
    const patchSnapshotKey = platform ? `${appId}:${platform}` : appId;
    const oldSnapshot = snapshots[patchSnapshotKey] ?? snapshots[appId] ?? {}; // fallback: bare key for migration
    const hasSnapshot = snapshots[patchSnapshotKey] !== undefined || snapshots[appId] !== undefined;

    // If no snapshot and no previous store progress, create baseline
    // But NOT for authoritative patches (crack/gse) — they provide the exact
    // achievement state, so we should always detect unlocks even on first run.
    const isBaseline = !patch.authoritative && !hasSnapshot && (!current.progressAvailable || prevUnlocked === 0);

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
      // Skip when createdMinimalSummary — the summary was just created from this
      // same patch, so using it as "previous state" would make all unlocks appear
      // already known and suppress toast notifications.
      for (const ach of current.achievements ?? []) {
        if (!prevMap.has(ach.apiName) && !createdMinimalSummary) {
          prevMap.set(ach.apiName, ach.unlocked);
        }
      }

      // ── Detect achievement data reset for authoritative patches ──
      // If the old snapshot has more unlocks than the current patch reports,
      // the achievement data was likely reset (deleted files, new game, etc.).
      // Clear the stale snapshot and treat all current unlocks as new.
      if (patch.authoritative) {
        const snapshotUnlockedCount = Object.values(oldSnapshot).filter(v => v).length;
        if (snapshotUnlockedCount > patch.unlocked) {
          console.log(`[ACH][STORE_PATCH][${tid}] snapshot-reset appid=${appId} snapshotUnlocked=${snapshotUnlockedCount} patchUnlocked=${patch.unlocked} action=clear-stale-snapshot`);
          prevMap.clear();
          delete snapshots[patchSnapshotKey];
          if (patchSnapshotKey !== appId) {
            delete snapshots[appId];
          }
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

      // Platinum detection: batch completes 100% of the game
      if (newUnlocks.length > 0 && newUnlockedCount >= total && total > 0 && prevUnlocked < total) {
        newUnlocks[newUnlocks.length - 1].isPlatinum = true;
        console.log(`[ACH][PLATINUM] appid=${appId} triggered at ${newUnlockedCount}/${total}`);
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
    const storeCurrent = this.summariesByAppId.get(key);
    const patchAccepted = !storeCurrent || isSourceNewerOrEqual(
      patched.source, patched.updatedAt,
      storeCurrent.source, storeCurrent.updatedAt,
    );
    if (RT) console.log(`[ACH][RT_STORE_WRITE_PATCH] appid=${appId} platform=${platform ?? "none"} accepted=${patchAccepted} new=${patched.unlocked}/${patched.total} old=${storeCurrent?.unlocked ?? "N/A"}/${storeCurrent?.total ?? "N/A"}`);
    if (!patchAccepted) {
      if (RT) console.log(`[ACH][RT_STORE_SKIP] appid=${appId} platform=${platform ?? "none"} reason=existing-newer`);
      console.debug(`[ACH][STORE_PATCH][${tid}] skipped-write reason=existing-newer source=${storeCurrent?.source} updatedAt=${storeCurrent?.updatedAt}`);
      this.notify(appId, storeCurrent!, platform); // re-notify with current state
      return null;
    }
    if (DEBUG_ACH_VERBOSE) console.log(`[ACH][SYNC_TRACE] appid=${appId} platform=${platform ?? "none"} stage=store-update unlocked=${patched.unlocked}/${patched.total}`);
    console.log(`[ACH][SYNC_BATCH] appid=${appId} platform=${platform ?? "none"} patchUnlocked=${patch.unlocked} previousUnlocked=${prevUnlocked} afterUnlocked=${newUnlockedCount} delta=${newUnlockedCount - prevUnlocked}`);
    this.summariesByAppId.set(key, patched);
    console.log(`[ACH][STORE_AFTER_PATCH] appid=${appId} platform=${platform ?? "none"} unlocked=${patched.unlocked}/${patched.total}`);
    if (RT) console.log(`[ACH][RT_STORE_SET] appid=${appId} platform=${platform ?? "none"} unlocked=${patched.unlocked}/${patched.total}`);
    console.debug(`[ACH][STORE_PATCH][${tid}] subscribersNotified=true`);

    // Notify UI subscribers
    this.notify(appId, patched, platform);

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
    snapshots[patchSnapshotKey] = newAppSnap;
    // Dual-save: also write bare appId key so callers without platform
    // (e.g. attemptAchievementRefresh on game close) don't find a stale
    // boot-era snapshot and incorrectly detect all unlocks as "new".
    if (patchSnapshotKey !== appId) {
      snapshots[appId] = newAppSnap;
    }
    saveSnapshots(snapshots);
    if (RT) console.log(`[ACH][RT_SNAPSHOT] appid=${appId} entries=${Object.keys(newAppSnap).length}`);

    // ── Write cache in background (fire-and-forget, after snapshot save) ──
    if (RT) console.log(`[ACH][RT_CACHE_WRITE_START] appid=${appId} platform=${platform ?? "none"} createdMinimal=${createdMinimalSummary}`);
    console.debug(`[ACH][CACHE][${tid}] background write scheduled`);
    if (!createdMinimalSummary) {
      this.writeCacheInBackground(appId, patched, tid, platform).catch(() => {});
    }

    return patched;
  }

  // ── Background cache write ──

  private async writeCacheInBackground(
    appId: string,
    summary: GameAchievementsSummary,
    traceId?: string,
    platform?: string,
  ): Promise<void> {
    if (!ACHIEVEMENTS_AUTO_ENABLED) {
      return;
    }
    const tid = traceId ?? "no-trace";
    const key = this.compositeKey(appId, platform);
    // Debounce: skip if wrote recently (prevent watcher overwrite)
    const now = Date.now();
    const lastWrite = this._lastWriteTime.get(key) ?? 0;
    if (now - lastWrite < 500) {
      console.debug(`[ACH][CACHE][${traceId}] skipped appid=${appId} platform=${platform ?? "none"} reason=debounce`);
      return;
    }
    this._lastWriteTime.set(key, now);

    // Infer platform from source when not explicitly provided:
    // crack source → "steam" directory, everything else → "steam-official"
    // NOTE: "binary-stats" comes from Steam's own appcache .bin files (NOT crack data),
    // so it must write to steam-official, not steam.
    const effectivePlatform = platform
      ?? (summary.source === "crack" ? "steam" : "steam-official");
    try {
      const appIdNum = Number(appId);
      // Use IN-MEMORY summary as source of truth (not disk cache)
      const inMemory = this.summariesByAppId.get(key) ?? summary;

      // Build achievements from the best available data
      // First, try to read existing disk cache to preserve schema fields (stat_id, bit, name, icons)
      let diskCacheMap: Map<string, any> | null = null;
      let diskPercentages: { name: string; percent: number }[] = [];
      let diskSource: string | undefined;
      try {
        const { readAchievementCache } = await import("./tauri");
        const diskCache = await readAchievementCache(appIdNum, effectivePlatform);
        if (diskCache?.achievements?.length) {
          diskCacheMap = new Map(diskCache.achievements.map((e) => [e.api_name, e]));
        }
        if (diskCache?.achievement_percentages?.length) {
          diskPercentages = diskCache.achievement_percentages;
        }
        diskSource = diskCache?.summary?.source;
      } catch { /* disk cache read failed — proceed without merge */ }

      // ── DISK CACHE QUALITY GUARD ──
      // If existing disk cache has higher-quality source, skip this write entirely.
      // Prevents schema-only/unavailable data from overwriting schema-generated cache on disk.
      const DISK_QUALITY: Record<string, number> = {
        "schema-generated": 3, "kv+api": 3, "schema-only": 2, "binary-stats": 2, "crack": 2, "librarycache": 1, "unavailable": 0,
      };
      const diskQ = DISK_QUALITY[diskSource ?? ""] ?? 0;
      const writeQ = DISK_QUALITY[summary.source ?? ""] ?? 0;
      if (diskQ > writeQ) {
        console.debug(`[ACH][CACHE] skipped write appid=${appId} — disk="${diskSource}" (q=${diskQ}) > incoming="${summary.source}" (q=${writeQ})`);
        return;
      }

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
          rarity_percent: entry.rarityPercent ?? diskAch?.rarity_percent ?? existingAch?.rarityPercent,
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
      }, false, effectivePlatform);

      console.log(`[ACH][CACHE][${tid}] wrote appid=${appId} unlocked=${finalUnlocked}/${summary.total} source=${summary.source}`);

      // SQLite dual-write — V2 API (game_id-based)
      try {
        const {
          upsertAchievementSummaryV2,
          batchUpsertAchievementsV2,
          upsertAchievementProgressV2,
          upsertAchievementPercentagesV2,
        } = await import("./tauri");

        const gameId = `steam-${appId}`;
        const now = Math.floor(Date.now() / 1000);

        await Promise.all([
          // Summary
          upsertAchievementSummaryV2({
            gameId,
            platform: effectivePlatform,
            source: summary.source || "librarycache",
            unlocked: finalUnlocked,
            total: summary.total,
            inProgress: finalUnlocked,
            completionTime: null,
            lastUnlockAt: null,
            updatedAt: now,
          }),
          // Achievement definitions (name, icons, description — no unlock state)
          batchUpsertAchievementsV2(achievements.map(a => ({
            id: `${gameId}:${effectivePlatform}:${a.api_name}`,
            gameId,
            platform: effectivePlatform,
            apiName: a.api_name,
            name: a.name,
            description: a.description ?? null,
            iconUrl: a.icon ?? null,
            iconGray: a.icon_gray ?? null,
            hidden: false,
            globalPct: a.rarity_percent ?? null,
            updatedAt: now,
          }))),
          // Achievement progress (unlocked state — separate write)
          ...achievements.map(a =>
            upsertAchievementProgressV2({
              id: `${gameId}:${effectivePlatform}:${a.api_name}`,
              gameId,
              platform: effectivePlatform,
              apiName: a.api_name,
              unlocked: a.unlocked,
              unlockTime: a.unlock_time ?? null,
              unlockedAt: null,
              updatedAt: now,
            })
          ),
          // Percentages
          upsertAchievementPercentagesV2({
            gameId,
            entries: JSON.stringify(finalPercentages),
            updatedAt: now,
          }),
        ]);
      } catch (e) {
        console.debug(`[ACH][CACHE][${tid}] SQLite write failed (non-critical):`, e);
      }
    } catch (err) {
      console.warn(`[ACH][CACHE][${tid}] write failed:`, err);
    }
  }

  // ── Fill missing icons from disk cache ──

  async fillMissingIconsFromCache(appId: string, traceId?: string, platform?: string): Promise<void> {
    const tid = traceId ?? "no-trace";
    const key = this.compositeKey(appId, platform);
    const summary = this.summariesByAppId.get(key);
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
        console.debug(`[ACH][STORE][${tid}] filledMissingIcons appid=${appId} platform=${platform ?? "none"} filled=${filled}`);
        this.notify(appId, summary, platform);
      }
    } catch {
      // non-critical
    }
  }

  // ── Part 5: Repair existing cache entries where icon_gray points to img/<hash>.jpg
  // instead of img/<hash>_gray.jpg ──

  async repairGrayIconPaths(appId: string, _traceId?: string, platform?: string): Promise<void> {
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
        const key = this.compositeKey(appId, platform);
        const summary = this.summariesByAppId.get(key);
        if (summary) {
          for (const ach of summary.achievements) {
            const patch = patched.find((p) => p.api_name === ach.apiName);
            if (patch && patch.icon_gray_url && ach.iconGrayUrl !== patch.icon_gray_url) {
              ach.iconGrayUrl = patch.icon_gray_url;
            }
          }
          this.notify(appId, summary, platform);
        }
      }
    } catch {
      // non-critical repair
    }
  }

  // ── Internal notify ──

  private notify(appId: string, summary: GameAchievementsSummary, platform?: string): void {
    for (const cb of this.subscribers) {
      try {
        cb(appId, summary, platform);
      } catch {
        // don't break
      }
    }
  }
}

export const achievementStore = new AchievementStoreImpl();