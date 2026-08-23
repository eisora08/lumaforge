import type { LibraryGame } from "../types/libraryGame";
import { loadStartupSnapshot, saveStartupSnapshot, buildStartupSnapshotFromCurrentState } from "./startupSnapshotService";
import { getBootSnapshot } from "./appBootCoordinator";
import { resolveGameMediaPathsBatch } from "./tauri";
import { enqueueMediaDownload } from "./mediaDownloadQueue";

const ENABLE_VERBOSE_BOOT_LOGS = false;

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;
const VALIDATION_DELAY_MS = 5000;
const BACKGROUND_FILL_MAX_GAMES = 5;
const BACKGROUND_FILL_IDLE_DELAY_MS = 15000;
const BACKGROUND_FILL_BATCH_SIZE = 5;

let validatorStarted = false;
let backgroundFillEnabled = false;
let backgroundFillPaused = false;
let backgroundFillTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Pause background fill while user navigates.
 */
export function pauseBackgroundFill(): void {
  backgroundFillPaused = true;
  if (backgroundFillTimer) {
    clearTimeout(backgroundFillTimer);
    backgroundFillTimer = null;
  }
}

/**
 * Resume background fill after navigation settles.
 */
export function resumeBackgroundFill(): void {
  backgroundFillPaused = false;
}

/**
 * Schedule background media validation after boot.
 * Validates that existing media paths still exist on disk.
 * Background fill is NOT auto-scheduled on startup.
 */
export function scheduleBackgroundValidation(
  games: LibraryGame[],
  appInfoMap: Record<string, any>,
): void {
  if (validatorStarted) return;
  validatorStarted = true;

  setTimeout(async () => {
    const snapshot = getBootSnapshot();
    if (!snapshot) return;

    const staleThreshold = 24 * 60 * 60;
    const now = Math.floor(Date.now() / 1000);
    const isStale = (now - snapshot.updatedAt) > staleThreshold;

    if (isStale && ENABLE_VERBOSE_BOOT_LOGS) {
      console.log("[BootSnapshot] stale, refreshing in background");
    }

    const snapshotGames = snapshot.library.games;
    let validated = 0;

    for (let i = 0; i < snapshotGames.length; i += BATCH_SIZE) {
      const batch = snapshotGames.slice(i, i + BATCH_SIZE);
      const batchAppIds = batch.filter((sg) => {
        return !!(sg.media.landscapePath || sg.media.coverPath || sg.media.backgroundPath || sg.media.logoPath || sg.media.iconPath);
      }).map((sg) => sg.appId).filter(Boolean) as string[];

      if (batchAppIds.length > 0) {
        const diskPathsMap = await resolveGameMediaPathsBatch(batchAppIds);
        for (const sg of batch) {
          const diskPaths = diskPathsMap[sg.appId];
          if (diskPaths) {
            const pathsStillValid = !!(diskPaths.landscapePath || diskPaths.coverPath);
            if (!pathsStillValid && ENABLE_VERBOSE_BOOT_LOGS) {
              console.log(`[BootSnapshot] media missing for ${sg.appId}: ${sg.title}`);
            }
          }
        }
      }

      validated += batch.length;

      if (i + BATCH_SIZE < snapshotGames.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    if (isStale) {
      try {
        const currentSnapshot = await loadStartupSnapshot();
        if (currentSnapshot) {
          const updatedSnapshot = await buildStartupSnapshotFromCurrentState(games, appInfoMap, null);
          await saveStartupSnapshot(updatedSnapshot);
          if (ENABLE_VERBOSE_BOOT_LOGS) {
            console.log("[BootSnapshot] refreshed stale snapshot");
          }
        }
      } catch {
        if (ENABLE_VERBOSE_BOOT_LOGS) {
          console.warn("[BootSnapshot] failed to refresh stale snapshot");
        }
      }
    }
  }, VALIDATION_DELAY_MS);

  // Do NOT auto-schedule background fill on startup.
  // Background fill is opt-in, runs only after idle with max 5 games.
}

/**
 * Enable background fill — called manually when user opts in.
 * Processes max 5 games that need media, after idle period.
 * Pauses while user navigates, resumes after navigation settles.
 */
export function enableBackgroundFill(games: LibraryGame[]): void {
  if (backgroundFillEnabled) return;
  backgroundFillEnabled = true;

  scheduleIdleFill(games);
}

function scheduleIdleFill(games: LibraryGame[]): void {
  if (backgroundFillTimer) clearTimeout(backgroundFillTimer);

  backgroundFillTimer = setTimeout(async () => {
    if (backgroundFillPaused) {
      scheduleIdleFill(games);
      return;
    }

    const snapshot = getBootSnapshot();
    if (!snapshot) return;

    const candidates = snapshot.library.games.filter((g) => {
      if (g.mediaStatus === "ready") return false;
      return true;
    }).slice(0, BACKGROUND_FILL_MAX_GAMES);

    if (candidates.length === 0) return;

    if (ENABLE_VERBOSE_BOOT_LOGS) {
      console.log(`[BackgroundFill] processing ${candidates.length} games`);
    }

    for (let i = 0; i < candidates.length; i += BACKGROUND_FILL_BATCH_SIZE) {
      if (backgroundFillPaused) {
        scheduleIdleFill(games);
        return;
      }

      const batch = candidates.slice(i, i + BACKGROUND_FILL_BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (sg) => {
          const game = games.find((g) => g.appId === sg.appId);
          if (!game) return;

          const meta = game.metadata;
          const landscapeUrl = meta?.capsule_image_v5 || meta?.capsule_image || meta?.header_image || meta?.background_image || game.imageUrl;
          if (landscapeUrl && !sg.media.landscapePath) {
            await enqueueMediaDownload({
              id: `bgfill-${sg.appId}-landscape`,
              appId: sg.appId,
              provider: "steam",
              mediaType: "landscape",
              url: landscapeUrl,
              target: "canonical",
              priority: "low",
            }).catch((err) => console.warn(err));
          }

          const coverUrl = meta?.capsule_image || meta?.capsule_image_v5 || meta?.header_image;
          if (coverUrl && !sg.media.coverPath) {
            await enqueueMediaDownload({
              id: `bgfill-${sg.appId}-cover`,
              appId: sg.appId,
              provider: "steam",
              mediaType: "cover",
              url: coverUrl,
              target: "canonical",
              priority: "low",
            }).catch((err) => console.warn(err));
          }
        })
      );

      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }, BACKGROUND_FILL_IDLE_DELAY_MS);
}

export function resetBackgroundValidator(): void {
  validatorStarted = false;
  backgroundFillEnabled = false;
  backgroundFillPaused = false;
  if (backgroundFillTimer) {
    clearTimeout(backgroundFillTimer);
    backgroundFillTimer = null;
  }
}
