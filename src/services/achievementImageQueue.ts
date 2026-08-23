import { convertFileSrc } from "@tauri-apps/api/core";
import { downloadAchievementImage } from "./tauri";
import { ACHIEVEMENT_IMAGE_MIGRATION_AUTO } from "./achievementAutoFlags";
export { ACHIEVEMENT_IMAGE_MIGRATION_AUTO };
export const DEBUG_ACH_MIGRATION = false;
export const DEBUG_ACH_IMAGE_QUEUE = false;
let _imgMigrationSkipLogged = false;

// ── Session dedup for resolved images (Phase 2 + 7) ──
// Prevents redundant resolveImageSource calls per appId+type+hash within a session.
const _sessionResolvedHashes = new Set<string>();

function extractImageIdentity(value: string): string | null {
  if (!value) return null;
  const hashMatch = value.match(/([a-f0-9]{40})/i);
  if (hashMatch) return hashMatch[1].toLowerCase();
  const fileMatch = value.match(/\/([^/]+)\.jpg$/);
  if (fileMatch) return fileMatch[1].replace(/_gray$/, "").toLowerCase();
  // Handle pure img/<hash>[_gray].jpg paths
  const imgMatch = value.match(/^img\/([^.]+)/);
  if (imgMatch) return imgMatch[1].replace(/_gray$/, "").toLowerCase();
  return null;
}

export function isImageResolved(appId: string, value: string | null | undefined, type: ImageType): boolean {
  if (!value) return false;
  const identity = extractImageIdentity(value);
  if (!identity) return false;
  return _sessionResolvedHashes.has(`${appId}:${type}:${identity}`);
}

export function markImageResolved(appId: string, value: string | null | undefined, type: ImageType): void {
  if (!value) return;
  const identity = extractImageIdentity(value);
  if (!identity) return;
  _sessionResolvedHashes.add(`${appId}:${type}:${identity}`);
}

export function clearSessionResolveCache(): void {
  _sessionResolvedHashes.clear();
}

function logImgMigrationSkipOnce(): void {
  if (!_imgMigrationSkipLogged) {
    _imgMigrationSkipLogged = true;
    console.log("[ACH][IMG_MIGRATE_SKIP] reason=auto-disabled");
  }
}

export type ImageType = "icon" | "icon_gray";
export type Priority = "high" | "normal" | "low";
export type ImageSourceKind = "remote-url" | "steam-hash" | "local-absolute-path" | "local-file-url" | "tauri-asset-url" | "relative-schema-path" | "invalid";
export type ImageCaller = "user-request" | "game-details" | "achievements-modal" | "progress-sync" | "unknown";

export type ImageQueueItem = {
  appId: string;
  apiName: string;
  sourceUrl: string;
  fileName: string;
  type: ImageType;
  priority: Priority;
  caller: ImageCaller;
  createdAt: number;
  generationId: string;
  platform?: string;
};

export type ImageUpdateCallback = (appId: string, apiName: string, type: ImageType, resolvedUrl: string) => void;

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

// ── Generation tracking ──

const _cancelledGenerations = new Set<string>();
const _cancelledAppPrefixes = new Set<string>();
let _genCounter = 0;

export function nextGenerationId(appId: string, mode: string): string {
  _genCounter++;
  return `${appId}:${mode}:${Date.now()}:${_genCounter}`;
}

export function cancelGeneration(generationId: string): void {
  _cancelledGenerations.add(generationId);
}

export function cancelGenerationsForApp(appId: string): void {
  _cancelledAppPrefixes.add(`${appId}:`);
}

function isGenerationCancelled(generationId: string): boolean {
  if (_cancelledGenerations.has(generationId)) return true;
  for (const prefix of _cancelledAppPrefixes) {
    if (generationId.startsWith(prefix)) return true;
  }
  return false;
}

// ── Source classification ──

/**
 * Check if a URL is a truncated Steam CDN folder URL (no hash filename).
 * Examples: https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/367520/
 * These lack the 40-char hex hash at the end and should be rejected.
 */
function isTruncatedCdnFolderUrl(value: string): boolean {
  if (!value.includes("/steamcommunity/public/images/apps/")) return false;
  // Must have a 40-char hex hash (with .jpg extension) as the last path segment
  const lastSegment = value.split("/").filter(Boolean).pop() ?? "";
  return !/^[a-f0-9]{40}\.jpg$/i.test(lastSegment);
}

export function classifyImageSource(value: string | undefined | null): { kind: ImageSourceKind; cleaned?: string } {
  if (!value) return { kind: "invalid" };

  // Truncated CDN folder URLs (no hash) → invalid
  if (isTruncatedCdnFolderUrl(value)) {
    return { kind: "invalid" };
  }

  // http://asset.localhost/... → local Tauri asset URL
  if (value.startsWith("http://asset.localhost/") || value.startsWith("https://asset.localhost/")) {
    return { kind: "tauri-asset-url" };
  }

  // file://... → local file URL
  if (value.startsWith("file://")) {
    return { kind: "local-file-url" };
  }

  // data:... → already resolved
  if (value.startsWith("data:")) {
    return { kind: "tauri-asset-url" };
  }

  // asset://... → already resolved
  if (value.startsWith("asset://")) {
    return { kind: "tauri-asset-url" };
  }

  // 40-char hex → steam hash
  if (/^[a-f0-9]{40}$/i.test(value)) {
    return { kind: "steam-hash" };
  }

  // http/https remote URL
  if (value.startsWith("http://") || value.startsWith("https://")) {
    // Check for local path encoded in URL (e.g., C%3A%5CUsers)
    if (/C%3A%5C|C%3A%2F|%2FUsers%2F|%2Fhome%2F/i.test(value)) {
      return { kind: "local-file-url" };
    }
    return { kind: "remote-url" };
  }

  // C:\... or /... local absolute path
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/")) {
    return { kind: "local-absolute-path" };
  }

  // img/... relative schema path
  if (value.startsWith("img/")) {
    return { kind: "relative-schema-path", cleaned: value.replace(/^img\//, "").replace(/\.jpg$/i, "").replace(/_gray$/, "") };
  }

  return { kind: "invalid" };
}

function isSteamImageHash(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}

export function isResolvedUrl(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("file://") || url.startsWith("asset://") || url.startsWith("http://asset.localhost/");
}

export function buildCdnUrl(appId: string, hash: string): string {
  return `${STEAM_CDN}/${appId}/${hash}.jpg`;
}

export function resolveImageSource(
  value: string | undefined | null,
  appId: string,
  type: ImageType,
  apiName?: string,
): { sourceUrl: string; fileName: string; sourceKind: ImageSourceKind } | null {
  if (!value) return null;
  if (isResolvedUrl(value)) return null;

  const classification = classifyImageSource(value);

  if (classification.kind === "steam-hash") {
    const suffix = type === "icon_gray" ? "_gray" : "";
    const fileName = `${value}${suffix}.jpg`;
    if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_RESOLVE] appid=${appId} apiName=${apiName ?? "?"} type=${type} input=${value} hash=${value} fileName=${fileName}`);
    return {
      sourceUrl: buildCdnUrl(appId, value),
      fileName,
      sourceKind: "steam-hash",
    };
  }

  if (classification.kind === "remote-url") {
    const rawFileName = value.split("/").filter(Boolean).pop() || "";
    // If no meaningful filename after the last slash, skip
    if (!rawFileName) {
      if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_RESOLVE] appid=${appId} apiName=${apiName ?? "?"} type=${type} invalidUrl reason=no-filename url=${value}`);
      return null;
    }
    // For icon_gray, ensure hash-based filenames get _gray suffix
    const fileName = type === "icon_gray"
      ? rawFileName.replace(/^([a-f0-9]{40})\.jpg$/i, "$1_gray.jpg")
      : rawFileName;
    if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_RESOLVE] appid=${appId} apiName=${apiName ?? "?"} type=${type} input=${value} hash=${rawFileName.replace(/\.jpg$/i, "")} fileName=${fileName}`);
    return { sourceUrl: value, fileName, sourceKind: "remote-url" };
  }

  if (classification.kind === "relative-schema-path" && classification.cleaned && isSteamImageHash(classification.cleaned)) {
    const cleaned = classification.cleaned;
    const suffix = type === "icon_gray" ? "_gray" : "";
    const fileName = `${cleaned}${suffix}.jpg`;
    if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_RESOLVE] appid=${appId} apiName=${apiName ?? "?"} type=${type} input=${value} hash=${cleaned} fileName=${fileName}`);
    return {
      sourceUrl: buildCdnUrl(appId, cleaned),
      fileName,
      sourceKind: "steam-hash",
    };
  }

  // Local paths must not be remote-downloaded
  if (classification.kind === "local-absolute-path" || classification.kind === "local-file-url" || classification.kind === "tauri-asset-url") {
    if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG] skipped download local source appid=${appId} kind=${classification.kind} path=${value}`);
    return null;
  }

  if (DEBUG_ACH_IMAGE_QUEUE) console.warn(`[ACH][IMG] skipped invalid source appid=${appId} value=${value} kind=${classification.kind}`);
  return null;
}

function isLocalFilePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/");
}

function toAssetUrl(filePath: string): string {
  if (filePath.startsWith("data:") || filePath.startsWith("asset://") || filePath.startsWith("file://") || filePath.startsWith("http://asset.localhost/")) return filePath;
  if (isLocalFilePath(filePath)) {
    try {
      return convertFileSrc(filePath, "asset");
    } catch {
      return filePath;
    }
  }
  return filePath;
}

// ── Cross-AppID path validation ──

function extractAppIdFromPath(path: string): string | null {
  // Check local achievement path
  const match = path.match(/[\\/]achievements[\\/](\d+)[\\/]/);
  if (match) return match[1];
  // Check CDN URL source
  const cdnMatch = path.match(/steamcommunity\/public\/images\/apps\/(\d+)\//);
  if (cdnMatch) return cdnMatch[1];
  return null;
}

// ── Queue implementation ──

class AchievementImageQueueImpl {
  private queue: ImageQueueItem[] = [];
  private activeCount = 0;
  private maxConcurrent = 3;
  private failedCooldowns = new Map<string, number>();
  private callbacks: ImageUpdateCallback[] = [];
  private processing = false;
  private activeKeys = new Set<string>();
  private completedKeys = new Set<string>();
  private destinationPaths = new Set<string>();
  private sourceUrlDedup = new Set<string>();
  private hashKeyDedup = new Set<string>();
  private _http403Sources = new Set<string>();
  private batchDownloaded = 0;
  private batchSkipped = 0;
  private batchFailed = 0;
  private batchCacheReads = 0;
  private batchStartTime = 0;
  private lastDrainTime = 0;
  private statusInterval: ReturnType<typeof setInterval> | null = null;
  private notifyQueues = new Map<string, Array<{ apiName: string; type: ImageType; resolvedUrl: string }>>();
  private notifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private notifyCount = 0;

  private getJobKey(item: ImageQueueItem): string {
    return `${item.appId}:${item.apiName}:${item.type}`;
  }

  private getHashKey(item: ImageQueueItem): string {
    const hash = item.fileName.replace(/_(gray)?\.jpg$/i, "").toLowerCase();
    return `${item.appId}:${hash}:${item.type}`;
  }

  // ── Part 3: Pre-check which files exist for a batch of items ──
  private async preSkipExistingBatch(items: ImageQueueItem[]): Promise<ImageQueueItem[]> {
    const appGroups = new Map<string, ImageQueueItem[]>();
    for (const item of items) {
      if (!appGroups.has(item.appId)) appGroups.set(item.appId, []);
      appGroups.get(item.appId)!.push(item);
    }

    const remaining: ImageQueueItem[] = [];
    for (const [appId, group] of appGroups) {
      try {
        const { resolveAchievementImagePaths } = await import("./tauri");
        const statuses = await resolveAchievementImagePaths(Number(appId));
        this.batchCacheReads++;
        const cacheByApiName = new Map(statuses.map((s) => [s.api_name, s]));

        for (const item of group) {
          const achStatus = cacheByApiName.get(item.apiName);
          const exists = achStatus && (item.type === "icon_gray" ? achStatus.icon_gray_exists : achStatus.icon_exists);
          if (exists) {
            this.completedKeys.add(this.getJobKey(item));
            this.batchSkipped++;
          } else {
            remaining.push(item);
          }
        }
      } catch {
        remaining.push(...group);
      }
    }
    return remaining;
  }

  subscribe(cb: ImageUpdateCallback): () => void {
    this.callbacks.push(cb);
    if (!this.statusInterval) {
      this.statusInterval = setInterval(() => {
        if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_QUEUE_STATUS] active=${this.activeCount} queued=${this.queue.length} completed=${this.completedKeys.size} skippedExisting=${this.batchSkipped} skippedSourceDup=${this.sourceUrlDedup.size - this.batchSkipped} skipped403=${this._http403Sources.size}`);
      }, 30000);
    }
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== cb);
      if (this.callbacks.length === 0 && this.statusInterval) {
        clearInterval(this.statusInterval);
        this.statusInterval = null;
      }
    };
  }

  async enqueue(items: ImageQueueItem[]) {
    if (!ACHIEVEMENT_IMAGE_MIGRATION_AUTO) {
      logImgMigrationSkipOnce();
      return;
    }
    const filtered: ImageQueueItem[] = [];
    for (const item of items) {
      const grayAsIcon = item.type === "icon" && item.sourceUrl.toLowerCase().includes("icongray");
      if (grayAsIcon) {
        console.warn(`[ACH][IMG_ROLE_MISMATCH] appid=${item.appId} apiName=${item.apiName} graySourceUsedAsIcon=true source=${item.sourceUrl}`);
        continue;
      }

      const urlAppId = extractAppIdFromPath(item.sourceUrl);
      if (urlAppId && urlAppId !== item.appId) {
        if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_BLOCKED] reason=cross-appid-url jobAppid=${item.appId} urlAppid=${urlAppId} url=${item.sourceUrl}`);
        continue;
      }

      if (this._http403Sources.has(item.sourceUrl)) {
        if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_SKIP] appid=${item.appId} apiName=${item.apiName} source=${item.sourceUrl} reason=403-cooldown`);
        continue;
      }

      const jobKey = this.getJobKey(item);
      const hashKey = this.getHashKey(item);

      // ── Part 3: Dedup by sourceUrl ──
      const sourceDedupKey = `${item.appId}:${item.sourceUrl}`;
      if (this.sourceUrlDedup.has(sourceDedupKey)) {
        if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_DEDUP] appid=${item.appId} file=${item.fileName} reason=duplicate-source-url`);
        continue;
      }

      // ── Part 3: Dedup by hash+type ──
      if (this.hashKeyDedup.has(hashKey)) {
        if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_DEDUP] appid=${item.appId} hash=${hashKey.split(":")[1]} type=${item.type} reason=duplicate-hash`);
        continue;
      }

      // ── Part 2+3: Gray dedup — detect when icon job has same hash as existing gray ──
      const hashMatch = item.fileName.match(/^([a-f0-9]{40})\.jpg$/);
      if (item.type === "icon" && hashMatch) {
        const hash = hashMatch[1];
        const grayHashKey = `${item.appId}:${hash}:icon_gray`;
        const grayCompleted = this.completedKeys.has(`${item.appId}:${item.apiName}:icon_gray`) || this.hashKeyDedup.has(grayHashKey);
        const grayInQueue = this.queue.some(
          (q) => q.appId === item.appId && q.type === "icon_gray" && this.getHashKey(q) === grayHashKey,
        );
        const grayActive = this.activeKeys.has(`${item.appId}:${item.apiName}:icon_gray`);
        if (grayCompleted || grayInQueue || grayActive) {
          if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_DEDUP_GRAY] appid=${item.appId} apiName=${item.apiName} hash=${hash} skipped=${item.fileName} reason=gray-source`);
          continue;
        }
      }

      if (item.caller === "progress-sync") {
        if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_BLOCKED] reason=progress-sync-no-images caller=${item.caller}`);
        continue;
      }

      if (isGenerationCancelled(item.generationId)) {
        continue;
      }

      if (this.completedKeys.has(jobKey)) continue;
      if (this.activeKeys.has(jobKey)) continue;

      if (this.failedCooldowns.has(jobKey)) {
        const until = this.failedCooldowns.get(jobKey)!;
        if (Date.now() < until) continue;
        this.failedCooldowns.delete(jobKey);
      }

      if (this.destinationPaths.has(item.fileName)) {
        if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_DEDUP] appid=${item.appId} file=${item.fileName} reason=duplicate-destination`);
        continue;
      }

      const alreadyQueued = this.queue.some(
        (q) => q.appId === item.appId && q.fileName === item.fileName,
      );
      if (alreadyQueued) continue;

      const already = this.queue.some(
        (q) => q.apiName === item.apiName && q.type === item.type && q.appId === item.appId,
      );
      if (already) continue;

      this.sourceUrlDedup.add(sourceDedupKey);
      this.hashKeyDedup.add(hashKey);
      filtered.push(item);
    }

    const afterPreSkip = await this.preSkipExistingBatch(filtered);

    this.queue.push(...afterPreSkip);

    this.queue.sort((a, b) => {
      const rank: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
      return rank[a.priority] - rank[b.priority];
    });

    this.drain();
  }

  cancelJobsForApp(appId: string, reason: string): void {
    cancelGenerationsForApp(appId);
    const before = this.queue.length;
    this.queue = this.queue.filter((item) => {
      if (item.appId !== appId) return true;
      return false;
    });
    const removed = before - this.queue.length;
    if (removed > 0 && DEBUG_ACH_IMAGE_QUEUE) {
      console.debug(`[ACH][IMG_QUEUE] cancelled ${removed} jobs appid=${appId} reason=${reason}`);
    }
  }

  private drain() {
    if (this.processing) return;
    this.processing = true;
    const tick = () => {
      while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
        const item = this.queue.shift()!;
        const key = this.getJobKey(item);
        this.activeKeys.add(key);
        this.destinationPaths.add(item.fileName);
        this.activeCount++;
        const delay = 150 + Math.floor(Math.random() * 100);
        setTimeout(() => {
          this.downloadItem(item).finally(() => {
            this.activeKeys.delete(key);
            this.activeCount--;
            this.drain();
          });
        }, delay);
      }
      this.processing = false;
    };
    const now = Date.now();
    const gap = Math.max(0, 500 - (now - this.lastDrainTime));
    this.lastDrainTime = now + gap;
    setTimeout(tick, gap);
  }

  // ── Part 5: Debounced notify per appId ──
  private notifyAppId(appId: string, apiName: string, type: ImageType, resolvedUrl: string): void {
    if (!this.notifyQueues.has(appId)) {
      this.notifyQueues.set(appId, []);
    }
    this.notifyQueues.get(appId)!.push({ apiName, type, resolvedUrl });
    this.notifyCount++;

    if (!this.notifyTimers.has(appId)) {
      const timer = setTimeout(() => {
        this.notifyTimers.delete(appId);
        const batch = this.notifyQueues.get(appId) ?? [];
        this.notifyQueues.delete(appId);
        const mode = this.callbacks.length > 0 ? "visible" : "background";
        for (const { apiName: an, type: t, resolvedUrl: ru } of batch) {
          for (const cb of this.callbacks) {
            cb(appId, an, t, ru);
          }
        }
        if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_NOTIFY] appid=${appId} mode=${mode} reason=batch count=${batch.length}`);
      }, 300);
      this.notifyTimers.set(appId, timer);
    }
  }

  private async downloadItem(item: ImageQueueItem): Promise<void> {
    const key = this.getJobKey(item);

    if (isGenerationCancelled(item.generationId)) {
      return;
    }

    const classification = classifyImageSource(item.sourceUrl);
    const sourceKind = classification.kind;

    if (sourceKind !== "remote-url" && sourceKind !== "steam-hash") {
      return;
    }

    if (item.caller === "progress-sync") {
      return;
    }

    if (this.batchStartTime === 0) this.batchStartTime = Date.now();

    try {
      const filePath = await downloadAchievementImage({
        appId: Number(item.appId),
        url: item.sourceUrl,
        fileName: item.fileName,
        platform: item.platform,
      });
      if (filePath) {
        this.completedKeys.add(key);
        this.batchDownloaded++;

        if (isGenerationCancelled(item.generationId)) {
          return;
        }

        const resolvedUrl = toAssetUrl(filePath);

        // ── Part 5: Debounced notification ──
        this.notifyAppId(item.appId, item.apiName, item.type, resolvedUrl);
      }
    } catch (err) {
      const errStr = String(err);
      if (errStr.includes("403") || errStr.includes("Forbidden")) {
        this._http403Sources.add(item.sourceUrl);
        this.batchFailed++;
      } else {
        this.failedCooldowns.set(key, Date.now() + 24 * 60 * 60 * 1000);
        this.batchFailed++;
      }
    }

    const totalProcessed = this.batchDownloaded + this.batchSkipped + this.batchFailed;
    if (DEBUG_ACH_IMAGE_QUEUE && totalProcessed > 0 && (totalProcessed % 20 === 0 || this.queue.length === 0)) {
      const elapsed = Date.now() - this.batchStartTime;
      const cacheReads = this.batchCacheReads;
      console.debug(`[ACH][IMG_BATCH] cacheReads=${cacheReads} downloaded=${this.batchDownloaded} skippedExisting=${this.batchSkipped} skippedDuplicate=${totalProcessed - this.batchDownloaded - this.batchSkipped - this.batchFailed} failed=${this.batchFailed} elapsedMs=${elapsed}`);
      console.debug(`[ACH][PERF] phase=imageBatch elapsedMs=${elapsed} downloaded=${this.batchDownloaded}`);
    }
  }
}

export const achievementImageQueue = new AchievementImageQueueImpl();

// ── Image folder validation (Part B13) ──

export async function validateAchievementImageFolder(appId: string): Promise<{
  appId: string;
  achievements: number;
  expectedMax: number;
  actualFiles: number;
  orphaned: number;
} | null> {
  try {
    const { readAchievementCache, cleanupAchievementOrphanImages } = await import("./tauri");
    const cached = await readAchievementCache(Number(appId));
    if (!cached) {
      console.debug(`[ACH][IMG_VALIDATE] appid=${appId} no-cache-found`);
      return null;
    }
    const achievementCount = cached.achievements.length;
    const expectedMax = achievementCount * 2;
    const result = await cleanupAchievementOrphanImages({ appId: Number(appId), dryRun: true });
    console.debug(`[ACH][IMG_VALIDATE] appid=${appId} achievements=${achievementCount} expectedMax=${expectedMax} actualFiles=${result.actual_files} orphaned=${result.orphaned_count}`);
    return {
      appId,
      achievements: achievementCount,
      expectedMax,
      actualFiles: result.actual_files,
      orphaned: result.orphaned_count,
    };
  } catch {
    return null;
  }
}

// ── Achievement icon resolution validation (Part 3) ──

export async function validateAchievementIconResolution(appId: string): Promise<{
  appId: string;
  total: number;
  withIconPath: number;
  withIconUrl: number;
  missingLocalIconFiles: number;
  remoteFallback: number;
} | null> {
  try {
    const { readAchievementCache, validateGeneratedAchievementSchema } = await import("./tauri");
    const cached = await readAchievementCache(Number(appId));
    if (!cached) {
      console.debug(`[ACH][ICON_VALIDATE] appid=${appId} no-cache-found`);
      return null;
    }
    const achievements = cached.achievements;
    const total = achievements.length;
    let withIconPath = 0;
    let withIconUrl = 0;
    let remoteFallback = 0;

    for (const ach of achievements) {
      const iconVal = ach.icon ?? ach.icon_url ?? "";
      const iconGrayVal = ach.icon_gray ?? ach.icon_gray_url ?? "";
      const iconLocal = iconVal.startsWith("img/") || iconGrayVal.startsWith("img/");
      const isAssetLocalhost = (s: string) => s.startsWith("http://asset.localhost/") || s.startsWith("https://asset.localhost/");
      const iconRemote = (iconVal.startsWith("http") && !isAssetLocalhost(iconVal)) ||
        (iconGrayVal.startsWith("http") && !isAssetLocalhost(iconGrayVal));

      if (iconLocal) withIconPath++;
      if (iconRemote) withIconUrl++;
      if (iconRemote && !iconLocal) remoteFallback++;
    }

    // Reuse Rust schema validation for missing local file count
    const schemaValidation = await validateGeneratedAchievementSchema(Number(appId));
    const missingLocalIconFiles = schemaValidation.missingLocalFiles;

    console.debug(`[ACH][ICON_VALIDATE] appid=${appId} total=${total}`);
    console.debug(`[ACH][ICON_VALIDATE] withIconPath=${withIconPath}`);
    console.debug(`[ACH][ICON_VALIDATE] withIconUrl=${withIconUrl}`);
    console.debug(`[ACH][ICON_VALIDATE] missingLocalIconFiles=${missingLocalIconFiles}`);
    console.debug(`[ACH][ICON_VALIDATE] remoteFallback=${remoteFallback}`);

    return { appId, total, withIconPath, withIconUrl, missingLocalIconFiles, remoteFallback };
  } catch {
    return null;
  }
}

// ── Part 7: Dry-run duplicate detection ──

export async function detectDuplicateGrayIcons(appId: string): Promise<{
  appId: string;
  pairs: Array<{ hash: string; normalFile: string; grayFile: string; normalReferenced: boolean; grayReferenced: boolean }>;
  totalPairs: number;
}> {
  const pairs: Array<{ hash: string; normalFile: string; grayFile: string; normalReferenced: boolean; grayReferenced: boolean }> = [];
  try {
    const { readAchievementCache, resolveAchievementImagePaths } = await import("./tauri");
    const [cached] = await Promise.all([
      readAchievementCache(Number(appId)),
      resolveAchievementImagePaths(Number(appId)).catch(() => []),
    ]);
    if (!cached) return { appId, pairs: [], totalPairs: 0 };

    // Build set of referenced icon filenames (without img/ prefix)
    const referencedIcons = new Set<string>();
    const referencedGrayIcons = new Set<string>();
    for (const ach of cached.achievements) {
      const icon = ach.icon_url ?? ach.icon;
      const gray = ach.icon_gray_url ?? ach.icon_gray;
      if (icon) {
        const fname = icon.replace(/^img\//, "");
        referencedIcons.add(fname);
      }
      if (gray) {
        const fname = gray.replace(/^img\//, "");
        referencedGrayIcons.add(fname);
      }
    }

    // Use the Rust orphan image cleanup to get actual files
    const { cleanupAchievementOrphanImages } = await import("./tauri");
    const result = await cleanupAchievementOrphanImages({ appId: Number(appId), dryRun: true });

    // Find <hash>.jpg files that have a corresponding <hash>_gray.jpg
    const grayFiles = result.orphaned_files.filter((f) => f.endsWith("_gray.jpg"));
    const allFiles = result.orphaned_files;

    for (const grayFile of grayFiles) {
      const hash = grayFile.replace(/_gray\.jpg$/, "");
      const normalFile = `${hash}.jpg`;
      // Only consider if normal file also exists
      if (allFiles.includes(normalFile) || allFiles.some((f) => f.endsWith(`/${normalFile}`))) {
        const normalReferenced = referencedIcons.has(normalFile);
        const grayReferenced = referencedGrayIcons.has(grayFile);
        pairs.push({
          hash,
          normalFile,
          grayFile,
          normalReferenced,
          grayReferenced,
        });
      }
    }

    for (const p of pairs) {
      if (!p.normalReferenced && p.grayReferenced) {
        console.debug(`[ACH][IMG_DUPLICATE_GRAY] appid=${appId} hash=${p.hash} normalFileUnreferenced=true grayReferenced=true`);
      }
    }
  } catch {
    // non-critical
  }
  return { appId, pairs, totalPairs: pairs.length };
}

// ── Dev console exposure ──

if (typeof window !== "undefined") {
  const _w = window as unknown as Record<string, unknown>;
  _w.__validateAchievementImageFolder = validateAchievementImageFolder;
  _w.__validateAchievementIconResolution = validateAchievementIconResolution;
  _w.__detectDuplicateGrayIcons = detectDuplicateGrayIcons;
}