import { convertFileSrc } from "@tauri-apps/api/core";
import { downloadAchievementImage } from "./tauri";

export type ImageType = "icon" | "icon_gray";
export type Priority = "high" | "normal" | "low";

export type ImageQueueItem = {
  appId: string;
  apiName: string;
  sourceUrl: string;
  fileName: string;
  type: ImageType;
  priority: Priority;
};

export type ImageUpdateCallback = (apiName: string, type: ImageType, resolvedUrl: string) => void;

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

function isSteamImageHash(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}

export function isResolvedUrl(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("file://") || url.startsWith("asset://");
}

export function buildCdnUrl(appId: string, hash: string): string {
  return `${STEAM_CDN}/${appId}/${hash}.jpg`;
}

export function resolveImageSource(
  value: string | undefined | null,
  appId: string,
  type: ImageType,
): { sourceUrl: string; fileName: string } | null {
  if (!value) return null;
  if (isResolvedUrl(value)) return null;
  if (isSteamImageHash(value)) {
    const suffix = type === "icon_gray" ? "_gray" : "";
    return {
      sourceUrl: buildCdnUrl(appId, value),
      fileName: `${value}${suffix}.jpg`,
    };
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const fileName = value.split("/").pop() || `${Date.now()}.jpg`;
    return { sourceUrl: value, fileName };
  }
  const cleaned = value.replace(/^img\//, "").replace(/\.jpg$/i, "").replace(/_gray$/, "");
  if (isSteamImageHash(cleaned)) {
    const suffix = type === "icon_gray" ? "_gray" : "";
    return {
      sourceUrl: buildCdnUrl(appId, cleaned),
      fileName: `${cleaned}${suffix}.jpg`,
    };
  }
  console.warn(`[ACH][IMG] skipped invalid source appid=${appId} value=${value}`);
  return null;
}

function isLocalFilePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/");
}

function toAssetUrl(filePath: string): string {
  if (filePath.startsWith("data:") || filePath.startsWith("asset://") || filePath.startsWith("file://")) return filePath;
  if (isLocalFilePath(filePath)) {
    try {
      return convertFileSrc(filePath, "asset");
    } catch {
      return filePath;
    }
  }
  return filePath;
}

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
      const jobKey = this.getJobKey(item);

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

      // Skip if already queued
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
    try {
      const filePath = await downloadAchievementImage({
        appId: Number(item.appId),
        url: item.sourceUrl,
        fileName: item.fileName,
      });
      if (filePath) {
        this.completedKeys.add(key);
        const resolvedUrl = toAssetUrl(filePath);
        for (const cb of this.callbacks) {
          cb(item.apiName, item.type, resolvedUrl);
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
