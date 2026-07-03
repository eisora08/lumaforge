import { convertFileSrc } from "@tauri-apps/api/core";
import { downloadAchievementImage } from "./tauri";

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

export function classifyImageSource(value: string | undefined | null): { kind: ImageSourceKind; cleaned?: string } {
  if (!value) return { kind: "invalid" };

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
    console.debug(`[ACH][IMG_RESOLVE] appid=${appId} apiName=${apiName ?? "?"} type=${type} input=${value} hash=${value} fileName=${fileName}`);
    return {
      sourceUrl: buildCdnUrl(appId, value),
      fileName,
      sourceKind: "steam-hash",
    };
  }

  if (classification.kind === "remote-url") {
    const rawFileName = value.split("/").pop() || `${Date.now()}.jpg`;
    // For icon_gray, ensure hash-based filenames get _gray suffix
    const fileName = type === "icon_gray"
      ? rawFileName.replace(/^([a-f0-9]{40})\.jpg$/i, "$1_gray.jpg")
      : rawFileName;
    console.debug(`[ACH][IMG_RESOLVE] appid=${appId} apiName=${apiName ?? "?"} type=${type} input=${value} hash=${rawFileName.replace(/\.jpg$/i, "")} fileName=${fileName}`);
    return { sourceUrl: value, fileName, sourceKind: "remote-url" };
  }

  if (classification.kind === "relative-schema-path" && classification.cleaned && isSteamImageHash(classification.cleaned)) {
    const cleaned = classification.cleaned;
    const suffix = type === "icon_gray" ? "_gray" : "";
    const fileName = `${cleaned}${suffix}.jpg`;
    console.debug(`[ACH][IMG_RESOLVE] appid=${appId} apiName=${apiName ?? "?"} type=${type} input=${value} hash=${cleaned} fileName=${fileName}`);
    return {
      sourceUrl: buildCdnUrl(appId, cleaned),
      fileName,
      sourceKind: "steam-hash",
    };
  }

  // Local paths must not be remote-downloaded
  if (classification.kind === "local-absolute-path" || classification.kind === "local-file-url" || classification.kind === "tauri-asset-url") {
    console.debug(`[ACH][IMG] skipped download local source appid=${appId} kind=${classification.kind} path=${value}`);
    return null;
  }

  console.warn(`[ACH][IMG] skipped invalid source appid=${appId} value=${value} kind=${classification.kind}`);
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

  private getJobKey(item: ImageQueueItem): string {
    return `${item.appId}:${item.apiName}:${item.type}`;
  }

  subscribe(cb: ImageUpdateCallback): () => void {
    this.callbacks.push(cb);
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== cb);
    };
  }

  enqueue(items: ImageQueueItem[]) {
    for (const item of items) {
      // ── Part 2: Role mismatch detection ──
      // If a source URL belongs to icon_gray but is being enqueued as "icon", flag it
      const grayAsIcon = item.type === "icon" && item.sourceUrl.toLowerCase().includes("icongray");
      if (grayAsIcon) {
        console.warn(`[ACH][IMG_ROLE_MISMATCH] appid=${item.appId} apiName=${item.apiName} graySourceUsedAsIcon=true source=${item.sourceUrl}`);
        continue;
      }

      // ── Cross-AppID source URL validation (Part 4) ──
      const urlAppId = extractAppIdFromPath(item.sourceUrl);
      if (urlAppId && urlAppId !== item.appId) {
        console.debug(`[ACH][IMG_BLOCKED] reason=cross-appid-url jobAppid=${item.appId} urlAppid=${urlAppId} url=${item.sourceUrl}`);
        continue;
      }

      const jobKey = this.getJobKey(item);

      // ── Part 3: Dedup gray source creating icon job for same hash family ──
      // If an icon job's hash matches an existing/completed icon_gray job's hash,
      // skip the icon job to avoid duplicate download of the gray source.
      const hashMatch = item.fileName.match(/^([a-f0-9]{40})\.jpg$/);
      if (item.type === "icon" && hashMatch) {
        const hash = hashMatch[1];
        const grayFileName = `${hash}_gray.jpg`;
        const grayQueued = this.queue.some(
          (q) => q.appId === item.appId && q.type === "icon_gray" && q.fileName === grayFileName,
        );
        const grayKey = `${item.appId}:${item.apiName}:icon_gray`;
        const grayActive = this.activeKeys.has(grayKey);
        const grayCompleted = this.completedKeys.has(grayKey);
        if (grayQueued || grayActive || grayCompleted) {
          console.debug(`[ACH][IMG_DEDUP_GRAY] appid=${item.appId} apiName=${item.apiName} hash=${hash} skipped=${item.fileName} reason=gray-source-already-has-gray-file`);
          continue;
        }
      }

      // ── Block progress-sync callers from downloading images (Part B10) ──
      if (item.caller === "progress-sync") {
        console.debug(`[ACH][IMG_BLOCKED] reason=progress-sync-no-images caller=${item.caller}`);
        continue;
      }

      // ── Check if generation was cancelled (Part B4) ──
      if (isGenerationCancelled(item.generationId)) {
        console.debug(`[ACH][IMG_QUEUE] ignored stale job appid=${item.appId} apiName=${item.apiName} generation=${item.generationId}`);
        continue;
      }

      // Skip already completed in this session
      if (this.completedKeys.has(jobKey)) continue;

      // Skip currently downloading
      if (this.activeKeys.has(jobKey)) continue;

      // Skip on cooldown
      if (this.failedCooldowns.has(jobKey)) {
        const until = this.failedCooldowns.get(jobKey)!;
        if (Date.now() < until) continue;
        this.failedCooldowns.delete(jobKey);
      }

      // Skip duplicate destination path
      if (this.destinationPaths.has(item.fileName)) {
        console.debug(`[ACH][IMG_QUEUE] skipped duplicate destination appid=${item.appId} apiName=${item.apiName} path=${item.fileName}`);
        continue;
      }

      // Skip if already queued (by destination path)
      const alreadyQueued = this.queue.some(
        (q) => q.appId === item.appId && q.fileName === item.fileName,
      );
      if (alreadyQueued) continue;

      // Skip if already queued (by apiName+type)
      const already = this.queue.some(
        (q) => q.apiName === item.apiName && q.type === item.type && q.appId === item.appId,
      );
      if (already) continue;

      this.queue.push(item);
    }

    this.queue.sort((a, b) => {
      const rank: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
      return rank[a.priority] - rank[b.priority];
    });

    this.drain();
  }

  /**
   * Cancel all queued and active jobs for a given appId.
   */
  cancelJobsForApp(appId: string, reason: string): void {
    // Cancel all generations for this app (marks active jobs as stale)
    cancelGenerationsForApp(appId);

    // Remove from queue
    const before = this.queue.length;
    this.queue = this.queue.filter((item) => {
      if (item.appId !== appId) return true;
      console.debug(`[ACH][IMG_QUEUE] cancelled job appid=${appId} apiName=${item.apiName} reason=${reason}`);
      return false;
    });
    const removed = before - this.queue.length;
    if (removed > 0) {
      console.debug(`[ACH][IMG_QUEUE] cancelled ${removed} queued jobs for appid=${appId} reason=${reason}`);
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
        this.downloadItem(item).finally(() => {
          this.activeKeys.delete(key);
          this.activeCount--;
          tick();
        });
      }
      this.processing = false;
    };
    tick();
  }

  private async downloadItem(item: ImageQueueItem): Promise<void> {
    const key = this.getJobKey(item);

    // ── Check if generation was cancelled before processing (Part 3) ──
    if (isGenerationCancelled(item.generationId)) {
      console.debug(`[ACH][IMG_QUEUE] ignored stale job appid=${item.appId} apiName=${item.apiName} generation=${item.generationId}`);
      return;
    }

    // ── Source classification ──
    const classification = classifyImageSource(item.sourceUrl);
    const sourceKind = classification.kind;

    // Only download remote URLs and steam hashes ─ skip local/asset/invalid sources (Part 7)
    if (sourceKind !== "remote-url" && sourceKind !== "steam-hash") {
      if (sourceKind === "local-absolute-path" || sourceKind === "local-file-url" || sourceKind === "tauri-asset-url") {
        console.debug(`[ACH][IMG] skipped download local source appid=${item.appId} kind=${sourceKind} path=${item.sourceUrl}`);
      } else {
        console.debug(`[ACH][IMG] using existing asset url appid=${item.appId} kind=${sourceKind} path=${item.sourceUrl}`);
      }
      return;
    }

    // ── Check caller for progress-sync (Part 8) ──
    if (item.caller === "progress-sync") {
      console.debug(`[ACH][IMG_BLOCKED] reason=progress-sync-no-images caller=${item.caller}`);
      return;
    }

    // ── Part 6: Skip download if destination file already exists on disk ──
    if (item.fileName.endsWith("_gray.jpg") || item.fileName.endsWith(".jpg")) {
      try {
        const { readAchievementCache } = await import("./tauri");
        const cached = await readAchievementCache(Number(item.appId));
        if (cached) {
          // Check via resolveAchievementImagePaths without import
          const { resolveAchievementImagePaths } = await import("./tauri");
          const statuses = await resolveAchievementImagePaths(Number(item.appId));
          const achStatus = statuses.find((s) => s.api_name === item.apiName);
          if (achStatus) {
            if (item.type === "icon_gray" && achStatus.icon_gray_exists) {
              console.debug(`[ACH][IMG_SKIP] appid=${item.appId} apiName=${item.apiName} type=icon_gray file=${item.fileName} reason=exists`);
              this.completedKeys.add(key);
              return;
            }
            if (item.type === "icon" && achStatus.icon_exists) {
              console.debug(`[ACH][IMG_SKIP] appid=${item.appId} apiName=${item.apiName} type=icon file=${item.fileName} reason=exists`);
              this.completedKeys.add(key);
              return;
            }
          }
        }
      } catch {
        // Non-critical — proceed with download if cache read fails
      }
    }

    // ── Image trace log (Part 9) ──
    console.debug(
      `[ACH][IMG_TRACE] appid=${item.appId} apiName=${item.apiName} type=${item.type} ` +
      `source=${item.sourceUrl} destination=achievements/${item.appId}/img/${item.fileName} ` +
      `sourceKind=${sourceKind} caller=${item.caller} generationId=${item.generationId}`
    );

    try {
      const filePath = await downloadAchievementImage({
        appId: Number(item.appId),
        url: item.sourceUrl,
        fileName: item.fileName,
      });
      if (filePath) {
        this.completedKeys.add(key);

        // ── Stale job check: if cancelled, don't update UI (Part 3) ──
        if (isGenerationCancelled(item.generationId)) {
          console.debug(`[ACH][IMG_QUEUE] completed inactive appid=${item.appId} no-ui-update=true`);
          return;
        }

        const resolvedUrl = toAssetUrl(filePath);

        // Only update UI for non-stale jobs — pass appId for subscriber filtering
        for (const cb of this.callbacks) {
          cb(item.appId, item.apiName, item.type, resolvedUrl);
        }
        console.debug(`[ACH][IMG] downloaded appid=${item.appId} apiName=${item.apiName} type=${item.type}`);
      } else {
        console.debug(`[ACH][IMG] download returned null appid=${item.appId} apiName=${item.apiName} type=${item.type}`);
      }
    } catch (err) {
      this.failedCooldowns.set(key, Date.now() + 24 * 60 * 60 * 1000);
      console.warn(`[ACH][IMG] failed appid=${item.appId} apiName=${item.apiName} type=${item.type} reason=${err}`);
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
