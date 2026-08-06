import { enqueueMediaDownload, clearMediaQueueState } from "./mediaDownloadQueue";
import { loadGameAppInfoWithMediaFallback } from "./gameCacheService";
import { notifyMediaUpdated } from "./startupSnapshotService";
import { resolveGameMediaPaths } from "./tauri";
import type { LibraryGame } from "../types/libraryGame";
import type { SteamAppMetadata } from "../types/gameMetadata";

type PrewarmMode = "fast" | "balanced" | "full";

type PrewarmOptions = {
  mode?: PrewarmMode;
  onlyMissing?: boolean;
  limit?: number;
  concurrency?: number;
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

const ENABLE_VERBOSE_PREWARM_LOGS = false;

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

  if (meta.header_image) urls.landscape = meta.header_image;
  else if (meta.capsule_image_v5) urls.landscape = meta.capsule_image_v5;
  else if (meta.capsule_image) urls.landscape = meta.capsule_image;
  else if (game.imageUrl) urls.landscape = game.imageUrl;

  if (meta.capsule_image) urls.cover = meta.capsule_image;
  else if (meta.capsule_image_v5) urls.cover = meta.capsule_image_v5;
  else if (meta.header_image) urls.cover = meta.header_image;

  if (meta.background_image) urls.background = meta.background_image;
  else if (meta.library_hero_image) urls.background = meta.library_hero_image;
  else if (meta.header_image) urls.background = meta.header_image;

  if (!urls.landscape) {
    try {
      const canonicalInfo = await loadGameAppInfoWithMediaFallback(appId);
      if (canonicalInfo?.media?.landscapePath) urls.landscape = canonicalInfo.media.landscapePath;
      else if (canonicalInfo?.remote?.header_image) urls.landscape = canonicalInfo.remote.header_image;
    } catch { /* ignore */ }
  }

  return urls;
}

async function checkMediaExistsOnDisk(appId: string, mediaType: string): Promise<boolean> {
  try {
    const diskPaths = await resolveGameMediaPaths(appId);
    if (!diskPaths) return false;
    switch (mediaType) {
      case "landscape": return !!diskPaths.landscapePath;
      case "cover": return !!diskPaths.coverPath;
      case "background": return !!diskPaths.backgroundPath;
      case "logo": return !!diskPaths.logoPath;
      case "icon": return !!diskPaths.iconPath;
      default: return false;
    }
  } catch {
    return false;
  }
}

export async function prewarmGamesMediaCache(
  games: LibraryGame[],
  options: PrewarmOptions = {},
): Promise<void> {
  const mode = options.mode ?? "fast";
  const limit = options.limit ?? 0;
  const onlyMissing = options.onlyMissing ?? false;

  if (currentProgress.status === "running") {
    console.warn("[Prewarm] already running");
    return;
  }

  cancelledFlag = false;
  const mediaTypes = mediaTypeForMode(mode);

  clearMediaQueueState();

  let candidates = games.filter((g) => g.appId);

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
      const appInfo = await loadGameAppInfoWithMediaFallback(appId);
      if (!appInfo) {
        if (ENABLE_VERBOSE_PREWARM_LOGS) {
          console.log(`[Prewarm] skipped ${appId}: no appinfo`);
        }
        currentProgress = { ...currentProgress, skipped: currentProgress.skipped + 1 };
        notify();
        continue;
      }

      const needsCache: Array<"landscape" | "cover" | "background" | "logo" | "icon"> = [];
      for (const mt of mediaTypes) {
        let alreadyExists = false;

        if (onlyMissing) {
          switch (mt) {
            case "landscape":
              alreadyExists = !!(appInfo.media?.landscapePath);
              break;
            case "cover":
              alreadyExists = !!(appInfo.media?.coverPath);
              break;
            case "background":
              alreadyExists = !!(appInfo.media?.backgroundPath);
              break;
            case "logo":
              alreadyExists = !!(appInfo.media?.logoPath);
              break;
            case "icon":
              alreadyExists = !!(appInfo.media?.iconPath);
              break;
          }

          if (!alreadyExists) {
            const existsOnDisk = await checkMediaExistsOnDisk(appId, mt);
            if (existsOnDisk) {
              alreadyExists = true;
            }
          }
        }

        if (!alreadyExists) {
          needsCache.push(mt);
        }
      }

      if (needsCache.length === 0) {
        if (ENABLE_VERBOSE_PREWARM_LOGS) {
          console.log(`[Prewarm] skipped ${appId}: all media already exists`);
        }
        currentProgress = { ...currentProgress, skipped: currentProgress.skipped + 1 };
        notify();
        continue;
      }

      const urls = await resolveStoreUrls(appId, game);

      const downloadPromises = [];
      for (const mediaType of needsCache) {
        if (cancelledFlag) break;

        const url = urls[mediaType];
        if (!url) {
          if (ENABLE_VERBOSE_PREWARM_LOGS) {
            console.log(`[Prewarm] ${appId} ${mediaType}: no URL available`);
          }
          continue;
        }

        downloadPromises.push(
          enqueueMediaDownload({
            id: `prewarm-${appId}-${mediaType}`,
            appId,
            provider: "steam",
            mediaType,
            url,
            target: "canonical",
            priority: "low",
          }).catch(() => ({ success: false, appId, mediaType, error: "enqueue failed" }))
        );
      }

      await Promise.all(downloadPromises);

      // Notify snapshot service so startup-snapshot.json picks up new paths
      await notifyMediaUpdated(appId).catch(() => {});

      if (ENABLE_VERBOSE_PREWARM_LOGS) {
        console.log(`[Prewarm] completed ${appId}: ${needsCache.length} role(s)`);
      }

      currentProgress = { ...currentProgress, completed: currentProgress.completed + 1 };
      notify();
    } catch (err) {
      if (ENABLE_VERBOSE_PREWARM_LOGS) {
        console.warn(`[Prewarm] failed ${game.appId}:`, err);
      }
      currentProgress = { ...currentProgress, failed: currentProgress.failed + 1 };
      notify();
    }
  }

  const finalStatus = cancelledFlag ? "cancelled" : "completed";
  if (currentProgress.status !== "cancelled") {
    currentProgress = { ...currentProgress, status: finalStatus };
  }
  console.log(`[Prewarm] ${finalStatus} — completed: ${currentProgress.completed}, skipped: ${currentProgress.skipped}, failed: ${currentProgress.failed}`);
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
