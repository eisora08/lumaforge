import { invoke } from "@tauri-apps/api/core";
import type { GameAppInfo, GameMediaPaths } from "./tauri";
import { invalidateResolvedMediaCache, normalizeMediaPathForIndex, updateGameAppinfoMediaIfChanged, getCachedGameAppInfo, getMediaEntry } from "./gameCacheService";
import { isInteractionBusy } from "./perfCounters";

const FLUSH_IDLE_RETRY_MS = 2000; // Phase 3: retry delay when paused

const ENABLE_VERBOSE_MEDIA_QUEUE_LOGS = false;

function log(...args: unknown[]) {
  if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) {
    console.log("[MediaQueue]", ...args);
  }
}

export type MediaDownloadJob = {
  id: string;
  appId: string;
  provider: "steam" | "steamgriddb" | "manual";
  mediaType: "landscape" | "cover" | "background" | "logo" | "icon";
  url: string;
  target: "canonical";
  priority: "high" | "normal" | "low";
  forceRefresh?: boolean;
};

export type MediaDownloadResult = {
  success: boolean;
  appId: string;
  mediaType: string;
  localPath?: string;
  error?: string;
};

export type MediaDownloadBatchResult = {
  appId: string;
  results: MediaDownloadResult[];
  success: boolean;
};

export type MediaQueueStatus = {
  active: number;
  queued: number;
  maxConcurrent: number;
  activeAppIds: string[];
  queuedAppIds: string[];
};

export type MediaQueueEvent = {
  type: "enqueue" | "start" | "success" | "partial" | "failed" | "cancelled" | "drain";
  job?: MediaDownloadJob;
  result?: MediaDownloadResult;
  batchResult?: MediaDownloadBatchResult;
  queueSize?: number;
};

type QueueListener = (event: MediaQueueEvent) => void;

type InternalJob = {
  job: MediaDownloadJob;
  resolve: (result: MediaDownloadResult) => void;
  reject: (error: Error) => void;
  retries: number;
};

const MAX_CONCURRENT = 2;
const MAX_RETRIES = 1;
const RETRY_BACKOFF_MS = 1000;

const activeJobs = new Map<string, InternalJob>();
const pendingQueue: InternalJob[] = [];
const inFlightAppIds = new Set<string>();
const recentlyCompleted = new Set<string>();
const recentlyFailed = new Set<string>();
const listeners = new Set<QueueListener>();

const dedupKey = (job: MediaDownloadJob) =>
  `${job.provider}:${job.appId}:${job.mediaType}:${job.target}`;

function notify(event: MediaQueueEvent) {
  for (const listener of listeners) {
    try { listener(event); } catch { /* ignore */ }
  }
}

function mediaTypeToField(mediaType: string): keyof import("./tauri").GameMediaPaths {
  switch (mediaType) {
    case "landscape": return "landscapePath";
    case "cover": return "coverPath";
    case "background": return "backgroundPath";
    case "logo": return "logoPath";
    case "icon": return "iconPath";
    default: return "landscapePath";
  }
}

const pendingAppInfoUpdates = new Map<string, Record<string, string | null>>();
let appInfoFlushTimer: ReturnType<typeof setTimeout> | null = null;
let flushRunning = false; // Phase 1: single-flight guard
let flushGeneration = 0;  // Phase 1: generation counter for stale callback detection

// ── Phase 1+2+3: Single-flight, Map-based, interaction-paused appinfo flush ──
// - Only one flush runs at a time (flushRunning guard)
// - Processes ONE appId per idle chunk (MAX_FLUSH_CHUNK_SIZE=1)
// - Processes appIds directly from Map (no stale snapshot array)
// - Hard pauses during interaction; defers on Store active
// Phase 4: Normalizes paths before comparing to skip no-op updates
// Phase 5: Uses getCachedGameAppInfo to avoid duplicate reads
async function flushAppInfoUpdates() {
  // Phase 1: Generation guard — capture our generation at start
  const gen = ++flushGeneration;
  if (flushRunning) {
    if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][FLUSH_SCHEDULE_SKIP] reason=already-running pending=${pendingAppInfoUpdates.size}`);
    return;
  }
  flushRunning = true;
  appInfoFlushTimer = null;

  if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][FLUSH_START] pending=${pendingAppInfoUpdates.size} generation=${gen}`);

  // Phase 3: Hard pause during interaction BEFORE any work
  if (isInteractionBusy()) {
    if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][FLUSH_PAUSE] reason=interaction-busy pending=${pendingAppInfoUpdates.size}`);
    flushRunning = false;
    appInfoFlushTimer = setTimeout(() => {
      if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][FLUSH_RETRY_SCHEDULED] delayMs=2000 pending=${pendingAppInfoUpdates.size}`);
      flushAppInfoUpdates();
    }, FLUSH_IDLE_RETRY_MS);
    return;
  }

  // Phase 2: Defer on Store active (don't clear — items stay pending)
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  if (hash.startsWith("#/store")) {
    if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_INDEX][UPDATE_SKIP] reason=store-active pending=${pendingAppInfoUpdates.size} (deferred)`);
    flushRunning = false;
    appInfoFlushTimer = setTimeout(flushAppInfoUpdates, FLUSH_IDLE_RETRY_MS);
    return;
  }

  const [{ getMediaEntry, setMediaEntry }, { notifyMediaUpdated }] = await Promise.all([
    import("./gameCacheService"),
    import("./startupSnapshotService"),
  ]);

  // Phase 2: Pick ONE appId directly from Map (no stale snapshot array)
  const appId = pendingAppInfoUpdates.keys().next().value as string | undefined;

  if (!appId) {
    if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][FLUSH_DONE] processed=0 generation=${gen}`);
    flushRunning = false;
    return;
  }

  const fields = pendingAppInfoUpdates.get(appId)!;

  // Phase 3: Re-check interaction before processing this appId
  if (isInteractionBusy()) {
    if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][FLUSH_PAUSE] reason=interaction-busy after=0 pending=${pendingAppInfoUpdates.size}`);
    flushRunning = false;
    appInfoFlushTimer = setTimeout(() => {
      if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][FLUSH_RETRY_SCHEDULED] delayMs=2000 pending=${pendingAppInfoUpdates.size}`);
      flushAppInfoUpdates();
    }, FLUSH_IDLE_RETRY_MS);
    return;
  }

  // Phase 5: Use cached appinfo to avoid duplicate reads
  let existingAppInfo: GameAppInfo | null = null;
  try {
    existingAppInfo = await getCachedGameAppInfo(appId);
  } catch { /* not critical */ }

  const existingMedia = existingAppInfo?.media ?? ({} as GameMediaPaths);

  // Rebuild merged fields from pending + existing
  const merged = {
    coverPath: fields.coverPath ?? existingMedia.coverPath ?? null,
    backgroundPath: fields.backgroundPath ?? existingMedia.backgroundPath ?? null,
    logoPath: fields.logoPath ?? existingMedia.logoPath ?? null,
    iconPath: fields.iconPath ?? existingMedia.iconPath ?? null,
    landscapePath: fields.landscapePath ?? existingMedia.landscapePath ?? null,
  };

  // Phase 4: Normalize paths before comparison — handles absolute-vs-relative
  const proposedNormalized: Record<string, string | null> = {};
  const existingNormalized: Record<string, string | null> = {};
  const mediaKeys: (keyof GameMediaPaths)[] = ["coverPath", "backgroundPath", "logoPath", "iconPath", "landscapePath"];
  let hasEffectiveChange = false;
  for (const k of mediaKeys) {
    const pNorm = normalizeMediaPathForIndex((merged as any)[k]);
    const eNorm = normalizeMediaPathForIndex((existingMedia as any)[k] ?? null);
    proposedNormalized[k] = pNorm;
    existingNormalized[k] = eNorm;
    if (pNorm !== eNorm) hasEffectiveChange = true;
  }

  if (!hasEffectiveChange) {
    if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA][APPINFO_SKIP] appid=${appId} reason=already-synced-before-rust caller=flushAppInfoUpdates`);
    pendingAppInfoUpdates.delete(appId);
    // Schedule next if more pending
    if (pendingAppInfoUpdates.size > 0) {
      appInfoFlushTimer = setTimeout(flushAppInfoUpdates, 300);
    } else {
      if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][FLUSH_DONE] processed=0 skipped=1 generation=${gen}`);
    }
    flushRunning = false;
    return;
  }

  await updateGameAppinfoMediaIfChanged(
    appId,
    existingAppInfo?.name ?? null,
    merged,
    existingAppInfo?.remote ?? null,
    existingAppInfo?.mediaSources ?? null,
    "flushAppInfoUpdates",
  ).catch(() => {});
  invalidateResolvedMediaCache(appId);

  // Update MediaIndex
  const entry = getMediaEntry(appId);
  if (entry) {
    const updated = { ...entry };
    let mediaIndexChanged = 0;
    let pathActuallyChanged = 0;
    for (const [field, path] of Object.entries(fields)) {
      const relPath = path as string | null;
      const key = field.replace("Path", "") as keyof typeof updated;
      const hasKey = `has${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof typeof updated;
      const newPath = normalizeMediaPathForIndex(relPath);
      const newHas = !!newPath;
      const oldPath = normalizeMediaPathForIndex((updated as any)[field] as string | null);
      const oldHas = (updated as any)[hasKey] as boolean;
      if (oldPath === newPath && oldHas === newHas) continue;
      (updated as any)[field] = newPath;
      (updated as any)[hasKey] = newHas;
      mediaIndexChanged++;
      if (oldPath !== newPath) pathActuallyChanged++;
    }
    if (mediaIndexChanged > 0) {
      updated.updatedAt = Date.now();
      setMediaEntry(updated);
      if (pathActuallyChanged > 0) {
        if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_INDEX] update key=steam:${appId} changedFields=${mediaIndexChanged} source=local-media-repair`);
        notifyMediaUpdated(appId, { source: "local-media-repair" }).catch(() => {});
      } else {
        if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_INDEX][UPDATE_SKIP] appid=${appId} reason=snapshot-already-synced`);
      }
    } else {
      if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_INDEX][UPDATE_SKIP] appid=${appId} reason=no-effective-change`);
    }
  }

  pendingAppInfoUpdates.delete(appId);
  flushRunning = false;

  // Schedule next chunk if more appIds pending
  const remaining = pendingAppInfoUpdates.size;
  if (remaining > 0) {
    if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][FLUSH_CHUNK] processed=1 remaining=${remaining} generation=${gen}`);
    appInfoFlushTimer = setTimeout(flushAppInfoUpdates, 300);
  } else {
    if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][FLUSH_DONE] processed=1 generation=${gen}`);
  }
}

async function queueAppInfoUpdate(appId: string, field: string, path: string | null, caller = "unknown") {
  const proposedNorm = normalizeMediaPathForIndex(path);

  // Check 1: Compare against MediaIndex (synchronous, in-memory)
  const entry = getMediaEntry(appId);
  if (entry) {
    const existingIndexNorm = normalizeMediaPathForIndex((entry as any)[field] as string | null);
    if (existingIndexNorm !== null && proposedNorm === existingIndexNorm) {
      if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][ENQUEUE_SKIP] appid=${appId} field=${field} reason=already-synced-index source=${caller}`);
      return;
    }
  }

  // Check 2: Compare against cached appinfo media (async, session cache)
  try {
    const existingAppInfo = await getCachedGameAppInfo(appId);
    if (existingAppInfo?.media) {
      const existingPath = (existingAppInfo.media as any)[field] as string | null | undefined;
      const existingPathNorm = normalizeMediaPathForIndex(existingPath ?? null);
      if (proposedNorm !== null && proposedNorm === existingPathNorm) {
        if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][ENQUEUE_SKIP] appid=${appId} field=${field} reason=already-synced-appinfo source=${caller}`);
        return;
      }
    }
  } catch { /* not critical — proceed with enqueue */ }

  // Check 3: If appId already pending, only merge if this field actually differs from pending
  const existing = pendingAppInfoUpdates.get(appId);
  if (existing) {
    const pendingPath = existing[field];
    const pendingNorm = normalizeMediaPathForIndex(pendingPath ?? null);
    if (proposedNorm === pendingNorm) {
      if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][ENQUEUE_SKIP] appid=${appId} field=${field} reason=already-pending source=${caller}`);
      return;
    }
    existing[field] = path;
    pendingAppInfoUpdates.set(appId, existing);
    if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][ENQUEUE_APPINFO] appid=${appId} field=${field} source=${caller} changed=true`);
    return; // already scheduled
  }

  // New appId or first field — schedule flush
  pendingAppInfoUpdates.set(appId, { [field]: path });
  if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][ENQUEUE_APPINFO] appid=${appId} field=${field} source=${caller} changed=true`);

  if (flushRunning || appInfoFlushTimer) {
    if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][FLUSH_SCHEDULE_SKIP] reason=already-scheduled-or-running pending=${pendingAppInfoUpdates.size}`);
    return;
  }
  if (ENABLE_VERBOSE_MEDIA_QUEUE_LOGS) console.log(`[MEDIA_QUEUE][FLUSH_SCHEDULE] pending=${pendingAppInfoUpdates.size} delayMs=500 generation=${flushGeneration + 1}`);
  appInfoFlushTimer = setTimeout(flushAppInfoUpdates, 500);
}

function tryProcessNext() {
  if (activeJobs.size >= MAX_CONCURRENT) return;
  if (pendingQueue.length === 0) {
    if (activeJobs.size === 0) {
      notify({ type: "drain" });
    }
    return;
  }

  const entry = pendingQueue.shift()!;
  const key = dedupKey(entry.job);

  activeJobs.set(entry.job.id, entry);
  inFlightAppIds.add(entry.job.appId);

  notify({ type: "start", job: entry.job, queueSize: pendingQueue.length });
  log("start", key);

  performDownload(entry, key);
}

async function performDownload(entry: InternalJob, key: string) {
  const { job } = entry;

  try {
    // Wrap in try-catch to handle stale callback IDs after app reload/unmount
    const result = await invoke<string | null>("safe_download_image", {
      url: job.url,
      appId: job.appId,
      mediaType: job.mediaType,
      target: job.target,
      forceRefresh: job.forceRefresh ?? false,
    }).catch((err: any) => {
      // Tauri callback ID warnings are non-fatal after app reload
      const msg = String(err ?? "");
      if (msg.includes("Couldn't find callback id") || msg.includes("callback")) {
        log("stale callback ignored for", key);
        return null;
      }
      throw err;
    });

    if (result !== null) {
      recentlyCompleted.add(key);
      recentlyFailed.delete(key);
      log("success", key, result);
      // Update appinfo with the downloaded file path (batched debounced)
      queueAppInfoUpdate(job.appId, mediaTypeToField(job.mediaType), result, "media-download");
      notify({ type: "success", job, result: { success: true, appId: job.appId, mediaType: job.mediaType, localPath: result }, queueSize: pendingQueue.length });
      entry.resolve({ success: true, appId: job.appId, mediaType: job.mediaType, localPath: result });
    } else {
      recentlyCompleted.add(key);
      recentlyFailed.delete(key);
      log("success (no-op, likely cached)", key);
      notify({ type: "success", job, result: { success: true, appId: job.appId, mediaType: job.mediaType }, queueSize: pendingQueue.length });
      entry.resolve({ success: true, appId: job.appId, mediaType: job.mediaType });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (entry.retries < MAX_RETRIES) {
      entry.retries++;
      log("retry", key, `attempt ${entry.retries}`);
      setTimeout(() => {
        pendingQueue.unshift(entry);
        tryProcessNext();
      }, RETRY_BACKOFF_MS * entry.retries);
      return;
    }

    recentlyFailed.add(key);
    recentlyCompleted.delete(key);
    log("failed", key, message);
    notify({ type: "failed", job, result: { success: false, appId: job.appId, mediaType: job.mediaType, error: message }, queueSize: pendingQueue.length });
    entry.resolve({ success: false, appId: job.appId, mediaType: job.mediaType, error: message });
  } finally {
    activeJobs.delete(job.id);
    inFlightAppIds.delete(job.appId);
    setTimeout(() => tryProcessNext(), 0);
  }
}

export function enqueueMediaDownload(job: MediaDownloadJob): Promise<MediaDownloadResult> {
  // Block media downloads during Store navigation to prevent MediaClassify and freezes
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  if (hash.startsWith("#/store") && !job.forceRefresh) {
    log("blocked from store", job.id ?? `${job.appId}/${job.mediaType}`);
    return Promise.resolve({ success: false, appId: job.appId, mediaType: job.mediaType, error: "Blocked: Store active" });
  }

  const key = dedupKey(job);

  if (!job.forceRefresh) {
    if (recentlyCompleted.has(key)) {
      log("skip already completed", key);
      return Promise.resolve({ success: true, appId: job.appId, mediaType: job.mediaType });
    }
    if (recentlyFailed.has(key)) {
      log("skip already failed", key);
      return Promise.resolve({ success: false, appId: job.appId, mediaType: job.mediaType, error: "Previously failed" });
    }
  }

  for (const existing of activeJobs.values()) {
    if (dedupKey(existing.job) === key) {
      log("already active", key);
      return new Promise((resolve) => {
        const poll = setInterval(() => {
          if (!activeJobs.has(existing.job.id)) {
            clearInterval(poll);
            resolve({ success: recentlyCompleted.has(key), appId: job.appId, mediaType: job.mediaType });
          }
        }, 100);
      });
    }
  }

  for (const existing of pendingQueue) {
    if (dedupKey(existing.job) === key) {
      log("already queued", key);
      return new Promise((resolve) => {
        const origResolve = existing.resolve;
        existing.resolve = (r) => { origResolve(r); resolve(r); };
      });
    }
  }

  return new Promise<MediaDownloadResult>((resolve, reject) => {
    const entry: InternalJob = { job, resolve, reject, retries: 0 };

    if (job.priority === "high") {
      pendingQueue.unshift(entry);
    } else if (job.priority === "low") {
      pendingQueue.push(entry);
    } else {
      const lastHighIndex = (() => {
        for (let i = pendingQueue.length - 1; i >= 0; i--) {
          if (pendingQueue[i].job.priority === "high") return i;
        }
        return -1;
      })();
      pendingQueue.splice(lastHighIndex + 1, 0, entry);
    }

    notify({ type: "enqueue", job, queueSize: pendingQueue.length });
    log("enqueue", `${job.provider}:${job.appId}:${job.mediaType}`, `q=${pendingQueue.length}`);
    setTimeout(() => tryProcessNext(), 0);
  });
}

export async function enqueueGameMediaBatch(
  appId: string,
  jobs: MediaDownloadJob[]
): Promise<MediaDownloadBatchResult> {
  const results: MediaDownloadResult[] = [];
  for (const job of jobs) {
    try {
      const r = await enqueueMediaDownload(job);
      results.push(r);
    } catch (err) {
      results.push({ success: false, appId, mediaType: job.mediaType, error: String(err) });
    }
  }
  const batchResult: MediaDownloadBatchResult = {
    appId, results, success: results.every((r) => r.success),
  };
  notify({ type: batchResult.success ? "success" : "partial", batchResult });
  return batchResult;
}

export function cancelMediaJobsForApp(appId: string) {
  for (const [id, entry] of activeJobs) {
    if (entry.job.appId === appId) {
      activeJobs.delete(id);
      inFlightAppIds.delete(appId);
      entry.resolve({ success: false, appId, mediaType: entry.job.mediaType, error: "Cancelled" });
      notify({ type: "cancelled", job: entry.job });
    }
  }

  const remaining: InternalJob[] = [];
  for (const entry of pendingQueue) {
    if (entry.job.appId === appId) {
      entry.resolve({ success: false, appId, mediaType: entry.job.mediaType, error: "Cancelled" });
      notify({ type: "cancelled", job: entry.job });
    } else {
      remaining.push(entry);
    }
  }
  pendingQueue.length = 0;
  pendingQueue.push(...remaining);

  notify({ type: "cancelled", queueSize: pendingQueue.length });
  setTimeout(() => tryProcessNext(), 0);
}

export function getMediaQueueStatus(): MediaQueueStatus {
  return {
    active: activeJobs.size,
    queued: pendingQueue.length,
    maxConcurrent: MAX_CONCURRENT,
    activeAppIds: Array.from(new Set(Array.from(activeJobs.values()).map((e) => e.job.appId))),
    queuedAppIds: Array.from(new Set(pendingQueue.map((e) => e.job.appId))),
  };
}

export function subscribeToMediaQueue(listener: QueueListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isAppIdInFlight(appId: string): boolean {
  return inFlightAppIds.has(appId);
}

export function clearMediaQueueState() {
  recentlyCompleted.clear();
  recentlyFailed.clear();
  pendingAppInfoUpdates.clear();
  if (appInfoFlushTimer) clearTimeout(appInfoFlushTimer);
  appInfoFlushTimer = null;
  log("cleared dedup state");
}
