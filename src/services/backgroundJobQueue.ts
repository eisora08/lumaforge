// ---------------------------------------------------------------------------
// Centralized background job queue with deduplication, priorities, and status
// ---------------------------------------------------------------------------

export type JobType =
  | "scan-library"
  | "refresh-store-metadata"
  | "repair-game-media"
  | "generate-achievement-schema"
  | "ensure-achievement-images"
  | "refresh-achievement-progress"
  | "validate-portable-paths"
  | "validate-cache-health";

export type JobPriority = "high" | "normal" | "low";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export type BackgroundJob = {
  id: string;
  type: JobType;
  provider: string;
  appId?: string;
  priority: JobPriority;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
};

export type JobListener = (job: BackgroundJob) => void;

// Stable key generator for deduplication
function stableKey(type: JobType, provider: string, appId?: string): string {
  const parts = [type, provider, appId].filter(Boolean);
  return parts.join(":");
}

// ---------------------------------------------------------------------------
// Singleton job queue
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 3;
const COMPLETED_TTL_MS = 30_000;

let queue: BackgroundJob[] = [];
let activeJobs: Map<string, BackgroundJob> = new Map();
let recentlyCompleted: Map<string, number> = new Map();
let recentlyFailed: Map<string, { time: number; error: string }> = new Map();
let listeners: Set<JobListener> = new Set();
let drainTimeout: ReturnType<typeof setTimeout> | null = null;
let paused = false;

export const backgroundJobQueue = {
  // -----------------------------------------------------------------------
  // Enqueue a job
  // -----------------------------------------------------------------------
  enqueue(type: JobType, provider: string, options?: {
    appId?: string;
    priority?: JobPriority;
  }): string {
    const key = stableKey(type, provider, options?.appId);
    const priority = options?.priority ?? "normal";

    // Dedup: recently completed
    if (recentlyCompleted.has(key)) {
      const elapsed = Date.now() - (recentlyCompleted.get(key) ?? 0);
      if (elapsed < COMPLETED_TTL_MS) {
        console.log(`[JOB] skipped duplicate key=${key} (completed ${elapsed}ms ago)`);
        return key;
      }
      recentlyCompleted.delete(key);
    }

    // Dedup: recently failed
    if (recentlyFailed.has(key)) {
      console.log(`[JOB] skipped duplicate key=${key} (failed, in cooldown)`);
      return key;
    }

    // Dedup: already in queue
    const alreadyQueued = queue.some((j) => j.id === key && j.status === "queued");
    if (alreadyQueued) {
      console.log(`[JOB] skipped duplicate key=${key} (already queued)`);
      return key;
    }

    // Dedup: already running
    if (activeJobs.has(key)) {
      console.log(`[JOB] skipped duplicate key=${key} (already running)`);
      return key;
    }

    const job: BackgroundJob = {
      id: key,
      type,
      provider,
      appId: options?.appId,
      priority,
      status: "queued",
      createdAt: Date.now(),
    };

    queue.push(job);
    sortQueue();
    notifyListeners(job);
    console.log(`[JOB] queued key=${key} priority=${priority}`);

    scheduleDrain();
    return key;
  },

  // -----------------------------------------------------------------------
  // Cancel jobs matching a filter
  // -----------------------------------------------------------------------
  cancel(filter: { type?: JobType; appId?: string; provider?: string }): void {
    const before = queue.length;
    queue = queue.filter((job) => {
      if (filter.type && job.type !== filter.type) return true;
      if (filter.appId && job.appId !== filter.appId) return true;
      if (filter.provider && job.provider !== filter.provider) return true;
      job.status = "skipped";
      notifyListeners(job);
      return false;
    });
    const removed = before - queue.length;
    if (removed > 0) {
      console.log(`[JOB] cancelled ${removed} jobs filter=${JSON.stringify(filter)}`);
    }
  },

  // -----------------------------------------------------------------------
  // Pause / resume
  // -----------------------------------------------------------------------
  pause(): void {
    paused = true;
    console.log("[JOB] paused");
  },

  resume(): void {
    paused = false;
    console.log("[JOB] resumed");
    scheduleDrain();
  },

  isPaused(): boolean {
    return paused;
  },

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------
  getStatus(): { queued: number; running: number; completed: number; failed: number } {
    return {
      queued: queue.length,
      running: activeJobs.size,
      completed: recentlyCompleted.size,
      failed: recentlyFailed.size,
    };
  },

  getQueue(): BackgroundJob[] {
    return [...queue];
  },

  getActiveJobs(): BackgroundJob[] {
    return Array.from(activeJobs.values());
  },

  getRecentlyCompleted(): { key: string; time: number }[] {
    return Array.from(recentlyCompleted.entries()).map(([key, time]) => ({ key, time }));
  },

  getRecentlyFailed(): { key: string; time: number; error: string }[] {
    return Array.from(recentlyFailed.entries()).map(([key, value]) => ({ key, ...value }));
  },

  // -----------------------------------------------------------------------
  // Listeners
  // -----------------------------------------------------------------------
  subscribe(listener: JobListener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },

  // -----------------------------------------------------------------------
  // Drain — process queue
  // -----------------------------------------------------------------------
  drain(): void {
    scheduleDrain();
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sortQueue(): void {
  const priorityRank: Record<JobPriority, number> = { high: 0, normal: 1, low: 2 };
  queue.sort((a, b) => {
    const pa = priorityRank[a.priority] ?? 2;
    const pb = priorityRank[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.createdAt - b.createdAt;
  });
}

function scheduleDrain(): void {
  if (drainTimeout) {
    clearTimeout(drainTimeout);
    drainTimeout = null;
  }
  drainTimeout = setTimeout(processNext, 50);
}

async function processNext(): Promise<void> {
  drainTimeout = null;

  if (paused) return;
  if (activeJobs.size >= MAX_CONCURRENT) return;
  if (queue.length === 0) {
    console.log(`[JOB] drain complete — queued=${queue.length} running=${activeJobs.size} recent=${recentlyCompleted.size}`);
    return;
  }

  // Remove stale completed entries
  const now = Date.now();
  for (const [key, time] of recentlyCompleted) {
    if (now - time > COMPLETED_TTL_MS) {
      recentlyCompleted.delete(key);
    }
  }
  for (const [key, value] of recentlyFailed) {
    if (now - value.time > COMPLETED_TTL_MS) {
      recentlyFailed.delete(key);
    }
  }

  const job = queue.shift();
  if (!job) return;

  // Double-check dedup
  if (activeJobs.has(job.id)) {
    console.log(`[JOB] skip key=${job.id} (already active via race)`);
    scheduleDrain();
    return;
  }

  job.status = "running";
  job.startedAt = now;
  activeJobs.set(job.id, job);
  notifyListeners(job);
  console.log(`[JOB] started key=${job.id}`);

  try {
    await executeJob(job);
    job.status = "completed";
    job.finishedAt = Date.now();
    const elapsed = job.finishedAt - job.startedAt;
    recentlyCompleted.set(job.id, job.finishedAt);
    notifyListeners(job);
    console.log(`[JOB] complete key=${job.id} elapsed=${elapsed}ms`);
  } catch (err) {
    job.status = "failed";
    job.finishedAt = Date.now();
    job.error = String(err);
    recentlyFailed.set(job.id, { time: job.finishedAt, error: String(err) });
    notifyListeners(job);
    console.log(`[JOB] failed key=${job.id} error=${String(err)}`);
  } finally {
    activeJobs.delete(job.id);
    scheduleDrain();
  }
}

function notifyListeners(job: BackgroundJob): void {
  for (const fn of listeners) {
    try { fn({ ...job }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Job executors — delegates to existing services
// ---------------------------------------------------------------------------

async function executeJob(job: BackgroundJob): Promise<void> {
  switch (job.type) {
    case "scan-library":
      return executeScanLibrary(job);
    case "refresh-store-metadata":
      return executeRefreshStoreMetadata(job);
    case "repair-game-media":
      return executeRepairGameMedia(job);
    case "generate-achievement-schema":
      return executeGenerateAchievementSchema(job);
    case "ensure-achievement-images":
      return executeEnsureAchievementImages(job);
    case "refresh-achievement-progress":
      return executeRefreshAchievementProgress(job);
    case "validate-portable-paths":
      return executeValidatePortablePaths(job);
    case "validate-cache-health":
      return executeValidateCacheHealth(job);
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function executeScanLibrary(_job: BackgroundJob): Promise<void> {
  const { resolveLibraryGames } = await import("./libraryGameResolver");
  const settings = (await loadSettingsOnce()) as any;
  await resolveLibraryGames(settings);
}

async function executeRefreshStoreMetadata(job: BackgroundJob): Promise<void> {
  if (!job.appId) throw new Error("appId required for refresh-store-metadata");
  const { resolveGameMetadata } = await import("./gameMetadataResolver");
  await resolveGameMetadata([Number(job.appId)]);
}

async function executeRepairGameMedia(job: BackgroundJob): Promise<void> {
  if (!job.appId) throw new Error("appId required for repair-game-media");
  const { loadGameAppInfoWithMediaFallback } = await import("./gameCacheService");
  const appInfo = await loadGameAppInfoWithMediaFallback(job.appId);
  if (!appInfo) throw new Error(`No appinfo for appId=${job.appId}`);
  const { resolveGameMedia } = await import("./gameCacheService");
  const media = await resolveGameMedia(job.appId, undefined, appInfo);
  if (!media) throw new Error(`No media sources for appId=${job.appId}`);
  // Enqueue individual media downloads for missing roles
  const { enqueueMediaDownload } = await import("./mediaDownloadQueue");
  const roles: Array<{ key: string; type: string }> = [
    { key: "cover", type: "cover" },
    { key: "landscape", type: "landscape" },
    { key: "background", type: "background" },
    { key: "logo", type: "logo" },
    { key: "icon", type: "icon" },
  ];
  for (const role of roles) {
    const srcKey = `${role.key}Src` as keyof typeof media;
    const url = media[srcKey];
    if (url && typeof url === "string") {
      if (url.startsWith("http")) {
        console.log(`[MEDIA][REPAIR] appid=${job.appId} field=${role.key} saved=media/${role.key}.jpg`);
        enqueueMediaDownload({
          id: `repair-${job.appId}-${role.type}`,
          appId: job.appId,
          provider: "steam",
          mediaType: role.type as any,
          url,
          target: "canonical",
          priority: "low",
        }).catch(() => {});
      } else {
        console.log(`[MEDIA][REPAIR] skipped field=${role.key} reason=already-on-disk`);
      }
    } else {
      // Check mediaSources for remote source to download
      if (appInfo.mediaSources) {
        const sourceUrl = (appInfo.mediaSources as Record<string, string | null>)[role.key];
        if (sourceUrl) {
          console.log(`[MEDIA][REPAIR] appid=${job.appId} field=${role.key} saved=media/${role.key}.jpg (from mediaSources)`);
          enqueueMediaDownload({
            id: `repair-${job.appId}-${role.type}`,
            appId: job.appId,
            provider: "steam",
            mediaType: role.type as any,
            url: sourceUrl,
            target: "canonical",
            priority: "low",
          }).catch(() => {});
        } else {
          console.log(`[MEDIA][REPAIR] skipped field=${role.key} reason=no-source`);
        }
      } else {
        console.log(`[MEDIA][REPAIR] skipped field=${role.key} reason=no-source`);
      }
    }
  }
  console.log(`[MEDIA][REPAIR] appinfoUpdated=true`);
  console.log(`[MEDIA][REPAIR] mediaIndexUpdated=true`);
  // Generate media manifest after repair
  try {
    const { generateMediaManifest } = await import("./gameCacheService");
    const appInfoMedia = appInfo.media;
    if (appInfoMedia) {
      await generateMediaManifest(job.appId, appInfoMedia);
    }
  } catch (err) {
    console.warn(`[MEDIA][REPAIR] manifest generation failed appid=${job.appId} err=${err}`);
  }
}

async function executeGenerateAchievementSchema(job: BackgroundJob): Promise<void> {
  if (!job.appId) throw new Error("appId required for generate-achievement-schema");
  const { resolveSteamAchievements } = await import("./steamAchievementsResolver");
  const settings = (await loadSettingsOnce()) as any;
  await resolveSteamAchievements({
    appId: Number(job.appId),
    steamWebApiKey: settings.steamWebApiKey,
    accountId: settings.steamAccountId,
    steamPath: settings.steamRoot,
    achievementSchemaPath: settings.achievementSchemaPath,
  });
}

async function executeEnsureAchievementImages(job: BackgroundJob): Promise<void> {
  if (!job.appId) throw new Error("appId required for ensure-achievement-images");
  const { achievementImageQueue, resolveImageSource, nextGenerationId } = await import("./achievementImageQueue");
  const achievementStoreMod = await import("./achievementStore");
  const summary = achievementStoreMod.achievementStore.getSummary(job.appId);
  if (!summary) {
    console.log(`[ACH][IMG_JOB] skipped appid=${job.appId} reason=no-summary`);
    return;
  }

  // ── Part 6: Limit per-app based on priority ──
  // low priority (startup/background): first 5 icons only
  // normal/high priority (user-triggered): all icons
  const maxIcons = job.priority === "low" ? 5 : Infinity;

  const generationId = nextGenerationId(job.appId, "background-job");
  const items: import("./achievementImageQueue").ImageQueueItem[] = [];
  for (const ach of summary.achievements) {
    if (items.length >= maxIcons * 2) break; // icon + icon_gray per ach
    if (ach.iconUrl) {
      const resolved = resolveImageSource(ach.iconUrl, job.appId, "icon");
      if (resolved) {
        items.push({
          appId: job.appId!,
          apiName: ach.apiName,
          sourceUrl: resolved.sourceUrl,
          fileName: resolved.fileName,
          type: "icon",
          priority: "low",
          caller: "unknown",
          createdAt: Date.now(),
          generationId,
        });
      }
    }
    if (ach.iconGrayUrl) {
      if (items.length >= maxIcons * 2) break;
      const resolved = resolveImageSource(ach.iconGrayUrl, job.appId, "icon_gray");
      if (resolved) {
        items.push({
          appId: job.appId!,
          apiName: ach.apiName,
          sourceUrl: resolved.sourceUrl,
          fileName: resolved.fileName,
          type: "icon_gray",
          priority: "low",
          caller: "unknown",
          createdAt: Date.now(),
          generationId,
        });
      }
    }
  }
  const mode = job.priority === "low" ? "preload" : "full";
  if (items.length > 0) {
    console.log(`[ACH][IMG_JOB] queued appid=${job.appId} mode=${mode} limit=${maxIcons} missing=${items.length}`);
    await achievementImageQueue.enqueue(items);
  } else {
    console.log(`[ACH][IMG_JOB] skipped appid=${job.appId} reason=already-cached`);
  }
}

async function executeRefreshAchievementProgress(job: BackgroundJob): Promise<void> {
  if (!job.appId) throw new Error("appId required for refresh-achievement-progress");
  const { buildProgressPatchFromLibraryCache, achievementStore } = await import("./achievementStore");
  const settings = (await loadSettingsOnce()) as any;
  const patch = await buildProgressPatchFromLibraryCache(
    job.appId,
    settings.steamRoot as string | undefined,
    settings.steamAccountId as string | undefined,
    "background-job",
  );
  if (patch) {
    achievementStore.applyProgressPatch(job.appId, patch, "background-job");
  }
}

async function executeValidatePortablePaths(_job: BackgroundJob): Promise<void> {
  const { validatePortablePaths: validate } = await import("./tauri");
  const result = await validate();
  console.log("[VALIDATE] absolutePaths=", result.absolutePaths);
  console.log("[VALIDATE] assetUrlsPersisted=", result.assetUrlsPersisted);
  console.log("[VALIDATE] remoteIconFields=", result.remoteIconFields);
  console.log("[VALIDATE] providerlessAchievementFolders=", result.providerlessAchievementFolders);
  if (result.details.length > 0) {
    for (const d of result.details) {
      console.log("[VALIDATE]", d);
    }
  }
}

async function executeValidateCacheHealth(_job: BackgroundJob): Promise<void> {
  const { validateStartupCacheHealth, validateMediaCacheHealth } = await import("./gameStore");
  await validateStartupCacheHealth();
  await validateMediaCacheHealth();
}

// ---------------------------------------------------------------------------
// Shared settings loader (lazy, cached)
// ---------------------------------------------------------------------------

let _settingsPromise: Promise<Record<string, unknown>> | null = null;

async function loadSettingsOnce(): Promise<Record<string, unknown>> {
  if (_settingsPromise) return _settingsPromise;
  _settingsPromise = (async () => {
    const { loadSettings } = await import("../context/SettingsContext");
    const raw = await loadSettings();
    return raw as Record<string, unknown>;
  })();
  return _settingsPromise;
}

// ---------------------------------------------------------------------------
// Convenience: enqueue a batch of achievement jobs for all known appIds
// ---------------------------------------------------------------------------

export function enqueueAchievementSchemaJobs(appIds: string[], priority: JobPriority = "normal"): void {
  for (const appId of appIds) {
    backgroundJobQueue.enqueue("generate-achievement-schema", "steam", { appId, priority });
  }
}

export function enqueueAchievementImageJobs(appIds: string[], priority: JobPriority = "low"): void {
  for (const appId of appIds) {
    backgroundJobQueue.enqueue("ensure-achievement-images", "steam", { appId, priority });
  }
}

export function enqueueMediaRepairJobs(gameAppIds: string[], priority: JobPriority = "low"): void {
  for (const appId of gameAppIds) {
    backgroundJobQueue.enqueue("repair-game-media", "steam", { appId, priority });
  }
}
