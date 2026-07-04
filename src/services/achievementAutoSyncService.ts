import { resolveSteamAchievements } from "./steamAchievementsResolver";
import { checkAchievementLibraryCacheMetadata } from "./tauri";
import { achievementStore } from "./achievementStore";
import type { GameAchievementsSummary } from "../types/gameAchievements";
import {
  ACHIEVEMENTS_AUTO_ENABLED,
  ACHIEVEMENT_AUTO_SYNC_ENABLED,
  logAutoSyncSkipOnce,
  isStoreRoute,
  logStoreSkipOnce,
} from "./achievementAutoFlags";

export type AutoSyncParams = {
  appId: string;
  steamWebApiKey?: string;
  steamId64?: string;
  accountId?: string;
  steamPath?: string;
  steamAchievementsEnabled?: boolean;
  achievementSchemaPath?: string;
};

export type AutoSyncEvent = {
  appId: string;
  summary: GameAchievementsSummary;
  reason: "librarycache-changed" | "window-focus" | "game-stopped";
};

export type AutoSyncCallback = (event: AutoSyncEvent) => void;

type FileMetadata = {
  file_size: number;
  modified_at: number;
};

type WatcherState = {
  params: AutoSyncParams;
  intervalId?: number;
  lastMetadata?: FileMetadata;
  inFlight: boolean;
};

const _shouldAutoSync = ACHIEVEMENTS_AUTO_ENABLED && ACHIEVEMENT_AUTO_SYNC_ENABLED;

class AchievementAutoSyncService {
  private watchers = new Map<string, WatcherState>();
  private subscribers = new Set<AutoSyncCallback>();
  private focusHandler: (() => void) | null = null;
  private enabled = true;
  private intervalSeconds = 10;

  subscribe(cb: AutoSyncCallback): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stopAll();
  }

  setIntervalSeconds(seconds: number): void {
    this.intervalSeconds = Math.max(5, Math.min(60, seconds));
    for (const [appId] of this.watchers) {
      this.stopWatcher(appId);
      this.startWatcher(appId);
    }
  }

  startWatching(params: AutoSyncParams): void {
    if (isStoreRoute()) { logStoreSkipOnce(); return; }
    if (!_shouldAutoSync) { logAutoSyncSkipOnce(); return; }
    if (!this.enabled) return;
    const appId = params.appId;
    if (this.watchers.has(appId)) {
      this.watchers.get(appId)!.params = params;
      return;
    }
    this.watchers.set(appId, { params, inFlight: false });
    this.startWatcher(appId);
    if (import.meta.env.DEV) {
      console.debug(`[ACH][AUTO_SYNC] watching appid=${appId}`);
    }
    this.ensureFocusListener();
  }

  stopWatching(appId: string): void {
    this.stopWatcher(appId);
    this.watchers.delete(appId);
    console.debug(`[ACH][AUTO_SYNC] stopped watching appid=${appId}`);
  }

  stopAll(): void {
    for (const appId of this.watchers.keys()) {
      this.stopWatcher(appId);
    }
    this.watchers.clear();
  }

  isWatching(appId: string): boolean {
    return this.watchers.has(appId);
  }

  getWatchedAppIds(): string[] {
    return Array.from(this.watchers.keys());
  }

  triggerRefresh(appId: string, reason: "game-stopped" | "window-focus"): void {
    const state = this.watchers.get(appId);
    if (!state) {
      console.debug(`[ACH][AUTO_SYNC] triggerRefresh skipped appid=${appId} reason=not-watched`);
      return;
    }
    if (state.inFlight) {
      console.debug(`[ACH][AUTO_SYNC] refresh skipped appid=${appId} reason=in-flight`);
      return;
    }
    this.refresh(appId, reason).catch(() => {});
  }

  destroy(): void {
    this.stopAll();
    if (this.focusHandler) {
      window.removeEventListener("focus", this.focusHandler);
      this.focusHandler = null;
    }
    this.subscribers.clear();
  }

  private startWatcher(appId: string): void {
    const state = this.watchers.get(appId)!;
    this.checkMetadata(appId).catch(() => {});

    const intervalId = window.setInterval(() => {
      if (!this.enabled) return;
      this.poll(appId).catch(() => {});
    }, this.intervalSeconds * 1000);

    state.intervalId = intervalId;
  }

  private stopWatcher(appId: string): void {
    const state = this.watchers.get(appId);
    if (state?.intervalId != null) {
      window.clearInterval(state.intervalId);
      state.intervalId = undefined;
    }
  }

  private async checkMetadata(appId: string): Promise<void> {
    const state = this.watchers.get(appId);
    if (!state) return;
    const { accountId, steamPath } = state.params;
    if (!accountId) return;

    try {
      const meta = await checkAchievementLibraryCacheMetadata({
        appId: Number(appId),
        steamAccountId: accountId,
        steamPath,
      });

      if (meta.file_found && meta.file_size != null && meta.modified_at != null) {
        state.lastMetadata = { file_size: meta.file_size, modified_at: meta.modified_at };
        console.debug(`[ACH][AUTO_SYNC] file state appid=${appId} exists=${meta.file_found} size=${meta.file_size} modifiedAt=${meta.modified_at}`);
      }
    } catch {
      // Transient error, ignore
    }
  }

  private async poll(appId: string): Promise<void> {
    const state = this.watchers.get(appId);
    if (!state || !state.params.accountId) return;
    if (state.inFlight) return;

    try {
      const meta = await checkAchievementLibraryCacheMetadata({
        appId: Number(appId),
        steamAccountId: state.params.accountId,
        steamPath: state.params.steamPath,
      });

      const prev = state.lastMetadata;
      if (!meta.file_found) {
        if (prev) state.lastMetadata = undefined;
        return;
      }
      if (meta.file_size == null || meta.modified_at == null) return;

      const changed = !prev || prev.file_size !== meta.file_size || prev.modified_at !== meta.modified_at;
      state.lastMetadata = { file_size: meta.file_size, modified_at: meta.modified_at };

      if (changed) {
        console.debug(`[ACH][AUTO_SYNC] change detected appid=${appId}`);
        await this.refresh(appId, "librarycache-changed");
      }
    } catch {
      // Transient error, ignore
    }
  }

  private async refresh(appId: string, reason: string): Promise<void> {
    const state = this.watchers.get(appId);
    if (!state) return;
    if (state.inFlight) {
      console.debug(`[ACH][AUTO_SYNC] refresh skipped appid=${appId} reason=in-flight`);
      return;
    }

    state.inFlight = true;
    console.debug(`[ACH][AUTO_SYNC] refreshing appid=${appId} reason=${reason}`);

    try {
      const { params } = state;
      const summary = await resolveSteamAchievements({
        appId,
        steamWebApiKey: params.steamWebApiKey,
        steamId64: params.steamId64,
        accountId: params.accountId,
        steamPath: params.steamPath,
        forceRefresh: true,
        steamAchievementsEnabled: params.steamAchievementsEnabled,
        achievementSchemaPath: params.achievementSchemaPath,
      });

      const unlockedCount = summary.achievements?.filter((a: any) => a.unlocked).length ?? 0;
      const newUnlocks = summary.newlyUnlocked?.length ?? 0;
      console.debug(`[ACH][AUTO_SYNC] refresh complete appid=${appId} unlocked=${unlockedCount}/${summary.total}`);
      if (newUnlocks > 0) {
        console.debug(`[ACH][AUTO_SYNC] new unlocks=${newUnlocks}`);
      }

      // Update the central store for cross-surface consistency
      console.log(`[ACH][SUMMARY_SOURCE] appid=${appId} source=auto-sync:${reason} unlocked=${summary.unlocked}/${summary.total} updatedAt=${summary.updatedAt} progressAvailable=${summary.progressAvailable}`);
      achievementStore.setSummary(appId, summary);

      for (const cb of this.subscribers) {
        try {
          cb({ appId, summary, reason: reason as AutoSyncEvent["reason"] });
        } catch {
          // Don't let one subscriber break others
        }
      }
    } catch (err) {
      console.warn(`[ACH][AUTO_SYNC] refresh failed appid=${appId} reason=${err}`);
    } finally {
      state.inFlight = false;
    }
  }

  private ensureFocusListener(): void {
    if (this.focusHandler) return;
    this.focusHandler = () => {
      if (!this.enabled) return;
      for (const appId of this.watchers.keys()) {
        this.triggerRefresh(appId, "window-focus");
      }
    };
    window.addEventListener("focus", this.focusHandler);
  }
}

export const achievementAutoSyncService = new AchievementAutoSyncService();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    achievementAutoSyncService.destroy();
  });
}
