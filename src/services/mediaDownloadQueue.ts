import { invoke } from "@tauri-apps/api/core";
import { updateGameAppinfoMedia } from "./tauri";
import { invalidateResolvedMediaCache } from "./gameCacheService";

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

function flushAppInfoUpdates() {
  appInfoFlushTimer = null;
  for (const [appId, fields] of pendingAppInfoUpdates) {
    const media: Record<string, string | null> = {
      coverPath: fields.coverPath ?? null,
      backgroundPath: fields.backgroundPath ?? null,
      logoPath: fields.logoPath ?? null,
      iconPath: fields.iconPath ?? null,
      landscapePath: fields.landscapePath ?? null,
    };
    updateGameAppinfoMedia(appId, null, media as any, null).catch(() => {});
    // Invalidate in-memory cache so UI picks up new paths
    invalidateResolvedMediaCache(appId);
  }
  pendingAppInfoUpdates.clear();
}

function queueAppInfoUpdate(appId: string, field: string, path: string | null) {
  const existing = pendingAppInfoUpdates.get(appId) ?? {};
  existing[field] = path;
  pendingAppInfoUpdates.set(appId, existing);
  if (appInfoFlushTimer) clearTimeout(appInfoFlushTimer);
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
      queueAppInfoUpdate(job.appId, mediaTypeToField(job.mediaType), result);
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
