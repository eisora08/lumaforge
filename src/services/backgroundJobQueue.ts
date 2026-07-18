// ---------------------------------------------------------------------------
// Centralized background job queue with deduplication, priorities, and status
// ---------------------------------------------------------------------------

import { countJobQueued } from "./perfCounters";

export type JobType =
  | "repair-game-media"
  | "generate-achievement-schema"
  | "ensure-achievement-images"
  | "validate-portable-paths";

// Tiered priority system: P0 = highest, P6 = lowest
export type JobTier =
  | "P0-user-action"       // Manual Refresh Artwork, Download/Install, Uninstall
  | "P1-visible-page"      // Current GameDetails media repair, current page data
  | "P2-visible-image"     // Visible viewport images, lazy card thumbnails
  | "P3-snapshot-write"    // Debounced snapshot updates, dirty appId writes
  | "P4-background-repair" // Non-visible media repair, deferred maintenance
  | "P5-achievement"       // Schema parse, image checks, migration
  | "P6-cleanup";          // Old cache cleanup, path migration, legacy data

// Legacy priority — kept for backward compat with existing queue
export type JobPriority = "high" | "normal" | "low";

export function tierToPriority(tier: JobTier): JobPriority {
  switch (tier) {
    case "P0-user-action": return "high";
    case "P1-visible-page": return "high";
    case "P2-visible-image": return "high";
    case "P3-snapshot-write": return "normal";
    case "P4-background-repair": return "normal";
    case "P5-achievement": return "low";
    case "P6-cleanup": return "low";
  }
}

export function tierLabel(tier: JobTier): string {
  return tier.replace(/^P\d-/, "");
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export type BackgroundJob = {
  id: string;
  type: JobType;
  provider: string;
  appId?: string;
  priority: JobPriority;
  tier?: JobTier;
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

/** Dedup key for media repair: media:<provider>:<appId>:<role> */
export function mediaRepairKey(provider: string, appId: string, role: string): string {
  return `media:${provider}:${appId}:${role}`;
}

/** Dedup key for GameDetails batch: details-media:<provider>:<appId>:<sortedRoles> */
export function gameDetailsRepairKey(provider: string, appId: string, roles: string[]): string {
  return `details-media:${provider}:${appId}:${[...roles].sort().join(",")}`;
}

// ---------------------------------------------------------------------------
// Singleton job queue
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 3;
const COMPLETED_TTL_MS = 30_000;
const JOB_WATCHDOG_TIMEOUT_MS = 60_000; // 60s — force-fail stuck jobs

let queue: BackgroundJob[] = [];
let activeJobs: Map<string, BackgroundJob> = new Map();
let recentlyCompleted: Map<string, number> = new Map();
let recentlyFailed: Map<string, { time: number; error: string }> = new Map();
let listeners: Set<JobListener> = new Set();
let drainTimeout: ReturnType<typeof setTimeout> | null = null;
let paused = false;

// ── Idle scheduler state (Phase 2) ──
let _routeShellReady = false;
let _bootCompleted = false;
let _idleAcknowledged = false;
let _lastNavigationChange = 0;
let _idleReadyLogged = false;

function isIdleReady(): boolean {
  if (!_routeShellReady || !_bootCompleted) return false;
  const noNav5s = Date.now() - _lastNavigationChange > 5000;
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  const storeInactive = !hash.startsWith("#/store");
  const noActiveDl = activeJobs.size < MAX_CONCURRENT;
  return noNav5s && storeInactive && noActiveDl && _routeShellReady && _bootCompleted;
}

function checkIdleReady(): void {
  const ready = isIdleReady();
  if (ready && !_idleAcknowledged) {
    _idleAcknowledged = true;
    console.log("[IDLE][READY] condition met — idle processing acknowledged");
  } else if (ready && !_idleReadyLogged) {
    _idleReadyLogged = true;
    console.log("[IDLE][READY] condition met");
  }
  if (!ready) {
    const reasons: string[] = [];
    if (!_routeShellReady) reasons.push("route-shell-not-ready");
    if (!_bootCompleted) reasons.push("boot-not-complete");
    if (Date.now() - _lastNavigationChange <= 5000) reasons.push("recent-navigation");
    if (typeof window !== "undefined" && window.location.hash.startsWith("#/store")) reasons.push("store-active");
    if (activeJobs.size >= MAX_CONCURRENT) reasons.push("max-concurrent-active");
    if (reasons.length > 0) {
      console.log(`[IDLE][DEFER] reasons=${reasons.join(",")}`);
    }
  }
}

export const backgroundJobQueue = {
  // -----------------------------------------------------------------------
  // Enqueue a job
  // -----------------------------------------------------------------------
  enqueue(type: JobType, provider: string, options?: {
    appId?: string;
    priority?: JobPriority;
    tier?: JobTier;
  }): string {
    const key = stableKey(type, provider, options?.appId);
    const tier = options?.tier;
    const priority = options?.priority ?? (tier ? tierToPriority(tier) : "normal");

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
      tier,
      status: "queued",
      createdAt: Date.now(),
    };

    queue.push(job);
    sortQueue();
    notifyListeners(job);
    console.log(`[JOB] queued key=${key} tier=${tier ?? priority} priority=${priority}`);
    countJobQueued();

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

  // -----------------------------------------------------------------------
  // Idle scheduler
  // -----------------------------------------------------------------------
  setRouteShellReady(v: boolean): void {
    _routeShellReady = v;
    checkIdleReady();
  },

  setBootCompleted(v: boolean): void {
    _bootCompleted = v;
    checkIdleReady();
  },

  setNavigationChanged(): void {
    _lastNavigationChange = Date.now();
    _idleAcknowledged = false;
    _idleReadyLogged = false;
  },

  isIdleReady(): boolean {
    return isIdleReady();
  },

  getIdleStatus(): { routeShellReady: boolean; bootCompleted: boolean; idleAcknowledged: boolean; lastNavigationChange: number } {
    return { routeShellReady: _routeShellReady, bootCompleted: _bootCompleted, idleAcknowledged: _idleAcknowledged, lastNavigationChange: _lastNavigationChange };
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
    // Only log drain complete when there are active jobs or recently completed (not on idle polls)
    if (activeJobs.size > 0 || recentlyCompleted.size > 0) {
      console.log(`[JOB] drain complete — queued=${queue.length} running=${activeJobs.size} recent=${recentlyCompleted.size}`);
    }
    return;
  }

  // ── Idle tier deferral (P4-P6 only run when idle ready) ──
  // Check the first job; if it's P4-P6 and we're not idle, defer it
  if (queue.length > 0) {
    const nextJob = queue[0];
    if (nextJob.tier && ["P4-background-repair", "P5-achievement", "P6-cleanup"].includes(nextJob.tier)) {
      if (!isIdleReady()) {
        // Don't block the entire queue — just leave P4-P6 queued and let P0-P3 run
        // Move it to the end of the queue (or leave it) and try next
        const deferredTier = nextJob.tier;
        // Only log deferral once per idle cycle (not every 50ms)
        if (!_idleAcknowledged) {
          const reasons: string[] = [];
          if (!_routeShellReady) reasons.push("route-shell-not-ready");
          if (!_bootCompleted) reasons.push("boot-not-complete");
          if (Date.now() - _lastNavigationChange <= 5000) reasons.push("recent-navigation");
          if (typeof window !== "undefined" && window.location.hash.startsWith("#/store")) reasons.push("store-active");
          if (reasons.length > 0) {
            console.log(`[IDLE][DEFER] tier=${deferredTier} reasons=${reasons.join(",")}`);
          }
        }
        // Skip the front job to process lower tiers underneath
        const front = queue.shift();
        if (front) queue.push(front);
        // If all remaining jobs are also P4+, drain is done for now
        if (queue.every((j) => j.tier && ["P4-background-repair", "P5-achievement", "P6-cleanup"].includes(j.tier))) {
          console.log(`[IDLE][DONE] queued=${queue.length} running=${activeJobs.size} — all remaining jobs are idle-tier, deferring`);
          scheduleDrain();
          return;
        }
      }
    }
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

  // Check if Store is active BEFORE marking job running — defer instead of running
  if (STORE_BLOCKED_JOB_TYPES.has(job.type)) {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.startsWith("#/store")) {
      // Re-enqueue with "queued" status (don't reuse the same object with "running")
      const alreadyQueued = queue.some((j) => j.id === job.id && j.status === "queued");
      if (alreadyQueued) {
        console.log(`[JOB][DEFER_SKIP] key=${job.id} reason=already-queued`);
      } else {
        job.status = "queued";
        queue.push(job);
        console.log(`[JOB][DEFER] key=${job.id} reason=store-active retryMs=2000`);
      }
      scheduleDrain();
      return;
    }
  }

  job.status = "running";
  job.startedAt = now;
  activeJobs.set(job.id, job);
  notifyListeners(job);
  if (job.tier && ["P4-background-repair", "P5-achievement", "P6-cleanup"].includes(job.tier)) {
    console.log(`[IDLE][RUN] key=${job.id} tier=${job.tier}`);
  } else {
    console.log(`[JOB] started key=${job.id}`);
  }

  try {
    // Watchdog: force-fail if executeJob hangs for > 60s
    await Promise.race([
      executeJob(job),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`watchdog timeout after ${JOB_WATCHDOG_TIMEOUT_MS}ms`)), JOB_WATCHDOG_TIMEOUT_MS)
      ),
    ]);
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

// ── Block certain job types when user is browsing Store ──
const STORE_BLOCKED_JOB_TYPES = new Set([
  "repair-game-media",
  "generate-achievement-schema",
  "ensure-achievement-images",
]);

async function executeJob(job: BackgroundJob): Promise<void> {
  switch (job.type) {
    case "repair-game-media":
      return executeRepairGameMedia(job);
    case "generate-achievement-schema":
      return executeGenerateAchievementSchema(job);
    case "ensure-achievement-images":
      return executeEnsureAchievementImages(job);
    case "validate-portable-paths":
      return executeValidatePortablePaths(job);
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function executeRepairGameMedia(job: BackgroundJob): Promise<void> {
  if (!job.appId) throw new Error("appId required for repair-game-media");
  const { loadGameAppInfoWithMediaFallback, CANONICAL_GAME_MEDIA_ROLES, isSystemToolApp, resolveGameDetailsArtwork } = await import("./gameCacheService");
  const { resolveGameMediaPaths } = await import("./tauri");
  const { resolveGameMetadata } = await import("./gameMetadataResolver");

  // Skip system/tool apps (Steamworks Redistributables, Proton, etc.)
  if (isSystemToolApp(job.appId)) {
    console.log(`[MEDIA][AUTO_REPAIR_SKIP] appid=${job.appId} reason=system-tool`);
    return;
  }

  // Step 1: Check which roles are actually missing on disk
  const diskPaths = await resolveGameMediaPaths(job.appId).catch(() => null);
  const missingRoles = CANONICAL_GAME_MEDIA_ROLES.filter((role) => {
    const pathKey = `${role.key}Path` as keyof typeof diskPaths;
    return !diskPaths?.[pathKey];
  });
  if (missingRoles.length === 0) {
    console.log(`[MEDIA][REPAIR_SKIP] appid=${job.appId} reason=complete`);
    return;
  }

  const appInfo = await loadGameAppInfoWithMediaFallback(job.appId, {
    allowRepair: true,
    repairSource: "local-media-repair",
  });

  if (!appInfo) throw new Error(`No appinfo for appId=${job.appId}`);

  // Resolve Steam metadata for correct role candidate selection
  let resolvedMeta: Record<string, any> | null = null;
  const appIdNum = Number(job.appId);
  if (appIdNum && !isNaN(appIdNum)) {
    try {
      const metaMap = await resolveGameMetadata([appIdNum]);
      const m = metaMap[appIdNum];
      if (m?.resolved) resolvedMeta = m as unknown as Record<string, any>;
    } catch { /* non-critical */ }
  }

  // Use resolveGameDetailsArtwork (→ resolveMediaByPriority) instead of the
  // old resolveGameMedia which had incorrect role mapping.
  const bundle = resolveGameDetailsArtwork(
    job.appId,
    appInfo?.media ?? null,
    (resolvedMeta ?? null) as any,
    resolvedMeta?.capsule_image as string | null | undefined,
    null,
  );

  const { enqueueMediaDownload } = await import("./mediaDownloadQueue");
  const downloadPromises: Promise<void>[] = [];
  let skipped = 0;

  for (const role of missingRoles) {
    const asset = (bundle as any)[role.key] as { url?: string; source?: string } | undefined;
    const url = asset?.url;
    const httpUrl = (url && typeof url === "string" && url.startsWith("http")) ? url : null;

    if (httpUrl) {
      downloadPromises.push(
        enqueueMediaDownload({
          id: `repair-${job.appId}-${role.type}`,
          appId: job.appId,
          provider: "steam",
          mediaType: role.type as any,
          url: httpUrl,
          target: "canonical",
          priority: "low",
        }).then(() => {}),
      );
    } else {
      const sourceUrl = appInfo.mediaSources ? (appInfo.mediaSources as Record<string, string | null>)[role.key] : null;
      if (sourceUrl) {
        downloadPromises.push(
          enqueueMediaDownload({
            id: `repair-${job.appId}-${role.type}`,
            appId: job.appId,
            provider: "steam",
            mediaType: role.type as any,
            url: sourceUrl,
            target: "canonical",
            priority: "low",
          }).then(() => {}),
        );
      } else {
        skipped++;
      }
    }
  }

  const results = await Promise.allSettled(downloadPromises);
  const queued = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  console.log(`[MEDIA][REPAIR_DONE] appid=${job.appId} missing=${missingRoles.length} queued=${queued} skipped=${skipped} failed=${failed}`);
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
  const { ACHIEVEMENT_SCHEMA_MIGRATION_AUTO } = await import("./achievementStore");
  if (!ACHIEVEMENT_SCHEMA_MIGRATION_AUTO) {
    return;
  }
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


