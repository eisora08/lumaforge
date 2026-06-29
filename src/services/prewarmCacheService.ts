import { enqueueMediaDownload, clearMediaQueueState } from "./mediaDownloadQueue";
import { loadGameAppInfoWithMediaFallback } from "./gameCacheService";
import { getLibraryAppInfo } from "./libraryLocalCacheService";
import type { LibraryGame } from "../types/libraryGame";
import type { SteamAppMetadata } from "../types/gameMetadata";

type PrewarmMode = "fast" | "balanced" | "full";

type PrewarmOptions = {
  mode?: PrewarmMode;
  limit?: number;
  onlyInstalled?: boolean;
  onlyMissing?: boolean;
};

type PrewarmProgress = {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  currentAppId?: string;
  status: "idle" | "running" | "completed" | "cancelled";
};

type PrewarmListener = (progress: PrewarmProgress) => void;

const listeners = new Set<PrewarmListener>();
let currentProgress: PrewarmProgress = { total: 0, completed: 0, skipped: 0, failed: 0, status: "idle" };
let cancelledFlag = false;

export function subscribeToPrewarm(listener: PrewarmListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify() {
  for (const listener of listeners) {
    try { listener({ ...currentProgress }); } catch { /* ignore */ }
  }
}

export function isPrewarmRunning(): boolean {
  return currentProgress.status === "running";
}

export function getPrewarmProgress(): PrewarmProgress {
  return { ...currentProgress };
}

function mediaTypeForMode(mode: PrewarmMode): Array<"landscape" | "cover" | "background" | "logo" | "icon"> {
  switch (mode) {
    case "fast": return ["landscape"];
    case "balanced": return ["landscape", "cover", "background"];
    case "full": return ["landscape", "cover", "background", "logo", "icon"];
  }
}

async function resolveStoreUrls(appId: string, game: LibraryGame): Promise<Record<string, string | undefined>> {
  const urls: Record<string, string | undefined> = {};
  const meta: Partial<SteamAppMetadata> = game.metadata || {};

  // Store header is the primary landscape source
  if (meta.header_image) urls.landscape = meta.header_image;
  else if (meta.capsule_image_v5) urls.landscape = meta.capsule_image_v5;
  else if (meta.capsule_image) urls.landscape = meta.capsule_image;
  else if (game.imageUrl) urls.landscape = game.imageUrl;

  // Cover from capsule
  if (meta.capsule_image) urls.cover = meta.capsule_image;
  else if (meta.capsule_image_v5) urls.cover = meta.capsule_image_v5;
  else if (meta.header_image) urls.cover = meta.header_image;

  // Background from store metadata
  if (meta.background_image) urls.background = meta.background_image;
  else if (meta.library_hero_image) urls.background = meta.library_hero_image;
  else if (meta.header_image) urls.background = meta.header_image;

  // Also try to get URLs from library appinfo (store metadata saved earlier)
  if (!urls.landscape) {
    try {
      const appInfoEntry = await getLibraryAppInfo(appId);
      if (appInfoEntry?.header_image) urls.landscape = appInfoEntry.header_image;
    } catch { /* ignore */ }
  }

  return urls;
}

/**
 * prewarmGamesMediaCache — controlled cache prewarm for library games.
 *
 * Does NOT run automatically on app startup.
 * Does NOT trigger SteamGridDB — only uses Steam Store URLs.
 * Queue-limited (max 2 concurrent via enqueueMediaDownload).
 * Can be cancelled via cancelPrewarm().
 * Shows progress via subscribeToPrewarm().
 *
 * Modes:
 *   fast:      cache landscape only
 *   balanced:  cache landscape + cover + background (for current layout)
 *   full:      cache all 5 roles (still queue-limited)
 */
export async function prewarmGamesMediaCache(
  games: LibraryGame[],
  options: PrewarmOptions = {},
): Promise<void> {
  const mode = options.mode ?? "fast";
  const limit = options.limit ?? 0;
  const onlyInstalled = options.onlyInstalled ?? false;
  const onlyMissing = options.onlyMissing ?? false;

  if (currentProgress.status === "running") {
    console.warn("[Prewarm] already running");
    return;
  }

  cancelledFlag = false;
  const mediaTypes = mediaTypeForMode(mode);

  // Clear dedup state so prewarm downloads are not skipped by prior completed/failed sets
  clearMediaQueueState();

  let candidates = games.filter((g) => g.appId);

  if (onlyInstalled) {
    candidates = candidates.filter((g) => g.isPlayable || g.steamInstalled);
  }

  if (limit > 0) {
    candidates = candidates.slice(0, limit);
  }

  currentProgress = { total: candidates.length, completed: 0, skipped: 0, failed: 0, status: "running" };
  notify();

  for (const game of candidates) {
    if (cancelledFlag) {
      currentProgress = { ...currentProgress, status: "cancelled" };
      notify();
      return;
    }

    const appId = game.appId!;
    currentProgress = { ...currentProgress, currentAppId: appId };
    notify();

    try {
      // Load canonical appinfo (creates game folder if missing, populates appinfo.json)
      const appInfo = await loadGameAppInfoWithMediaFallback(appId);
      if (!appInfo) {
        currentProgress = { ...currentProgress, skipped: currentProgress.skipped + 1 };
        notify();
        continue;
      }

      // Determine which media roles need caching
      const needsCache = mediaTypes.filter((mt) => {
        if (!onlyMissing) return true;
        switch (mt) {
          case "landscape": return !appInfo.media?.landscapePath;
          case "cover": return !appInfo.media?.coverPath;
          case "background": return !appInfo.media?.backgroundPath;
          case "logo": return !appInfo.media?.logoPath;
          case "icon": return !appInfo.media?.iconPath;
          default: return true;
        }
      });

      if (needsCache.length === 0) {
        currentProgress = { ...currentProgress, skipped: currentProgress.skipped + 1 };
        notify();
        continue;
      }

      // Resolve URLs from store metadata
      const urls = await resolveStoreUrls(appId, game);

      for (const mediaType of needsCache) {
        if (cancelledFlag) break;

        const url = urls[mediaType];
        if (!url) continue;

        await enqueueMediaDownload({
          id: `prewarm-${appId}-${mediaType}`,
          appId,
          provider: "steam",
          mediaType,
          url,
          target: "canonical",
          priority: "low",
        });
      }

      currentProgress = { ...currentProgress, completed: currentProgress.completed + 1 };
      notify();
    } catch {
      currentProgress = { ...currentProgress, failed: currentProgress.failed + 1 };
      notify();
    }
  }

  if (!cancelledFlag) {
    currentProgress = { ...currentProgress, status: "completed" };
  }
  notify();
}

export function cancelPrewarm(): void {
  cancelledFlag = true;
  if (currentProgress.status === "running") {
    clearMediaQueueState();
    currentProgress = { ...currentProgress, status: "cancelled" };
    notify();
  }
}

export function resetPrewarmState(): void {
  cancelledFlag = false;
  currentProgress = { total: 0, completed: 0, skipped: 0, failed: 0, status: "idle" };
  notify();
}
