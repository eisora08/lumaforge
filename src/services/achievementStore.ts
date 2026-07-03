import type {
  GameAchievement,
  GameAchievementsSummary,
  UnlockEvent,
} from "../types/gameAchievements";
import { parseLibraryCacheAchievements, writeAchievementCache, readAchievementCache } from "./tauri";

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

  // ── Write full summary (from resolver) ──

  setSummary(appId: string, summary: GameAchievementsSummary): void {
    this.summariesByAppId.set(appId, summary);
    this.notify(appId, summary);
  }

  // ── Fast progress patch from librarycache ──

  applyProgressPatch(
    appId: string,
    patch: ProgressPatch,
    traceId?: string,
  ): GameAchievementsSummary | null {
    const tid = traceId ?? "no-trace";

    // Don't downgrade — only apply if progress is available
    if (!patch.progressMap.size && patch.total === 0) {
      console.debug(`[ACH][STORE_PATCH][${tid}] skipped appid=${appId} reason=empty-patch`);
      return null;
    }

    // ── Build base achievements to patch onto ──
    let current = this.summariesByAppId.get(appId);
    let createdMinimalSummary = false;
    const summaryLoaded = !!current;

    console.debug(`[ACH][STORE_PATCH][${tid}] summaryLoaded=${summaryLoaded}`);

    // ── If no existing summary, try cache or build minimal ──
    if (!current) {
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
      console.debug(`[ACH][STORE_PATCH][${tid}] skipped appid=${appId} reason=no-downgrade`);
      return null;
    }

    const prevUnlocked = current.achievements?.filter((a) => a.unlocked).length ?? 0;

    // Merge progress into existing achievements
    const mergedAchievements: GameAchievement[] = (current.achievements ?? []).map((ach) => {
      const progress = patch.progressMap.get(ach.apiName);
      if (!progress) return ach;
      return {
        ...ach,
        unlocked: progress.unlocked,
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

    const newUnlockedCount = mergedAchievements.filter((a) => a.unlocked).length;
    const total = patch.total > 0 ? patch.total : current.total;
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

    console.debug(`[ACH][STORE_PATCH][${tid}] before=${prevUnlocked}/${current.total} after=${newUnlockedCount}/${total}`);
    console.debug(`[ACH][STORE_PATCH][${tid}] summaryLoaded=${this.summariesByAppId.has(appId)} createdMinimalSummary=${createdMinimalSummary}`);

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
    }

    // Set newlyUnlocked so UI toasts can fire
    patched.newlyUnlocked = newUnlocks;

    // ── Patch store (AFTER unlock detection, BEFORE snapshot save) ──
    this.summariesByAppId.set(appId, patched);
    console.debug(`[ACH][STORE_PATCH][${tid}] subscribersNotified=true`);

    // Notify UI subscribers
    this.notify(appId, patched);

    // ── Fire unlock callbacks (toast, native notification) ──
    if (newUnlocks.length > 0) {
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

    // ── Write cache in background (fire-and-forget, after snapshot save) ──
    console.debug(`[ACH][CACHE][${tid}] background write scheduled`);
    this.writeCacheInBackground(appId, patched, tid).catch(() => {});

    return patched;
  }

  // ── Background cache write ──

  private async writeCacheInBackground(
    appId: string,
    summary: GameAchievementsSummary,
    traceId?: string,
  ): Promise<void> {
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
        });
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
        });
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
