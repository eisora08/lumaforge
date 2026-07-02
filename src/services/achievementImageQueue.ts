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

export type ImageUpdateCallback = (apiName: string, type: ImageType, dataUrl: string) => void;

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

/** Check if a string looks like a raw Steam image hash (40-char hex). */
function isSteamImageHash(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}

/** Check if a URL is a data URL or a local Tauri URL — no download needed. */
export function isResolvedUrl(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("file://") || url.startsWith("asset://");
}

/** Construct CDN URL from a Steam image hash + appId. */
export function buildCdnUrl(appId: string, hash: string): string {
  return `${STEAM_CDN}/${appId}/${hash}.jpg`;
}

/** Given a raw icon/icongray value, resolve to { sourceUrl, fileName } or null if invalid. */
export function resolveImageSource(
  value: string | undefined | null,
  appId: string,
  type: ImageType,
): { sourceUrl: string; fileName: string } | null {
  if (!value) return null;

  // Already a resolved URL — no download needed
  if (isResolvedUrl(value)) return null;

  // Raw 40-char hex hash
  if (isSteamImageHash(value)) {
    const suffix = type === "icon_gray" ? "_gray" : "";
    return {
      sourceUrl: buildCdnUrl(appId, value),
      fileName: `${value}${suffix}.jpg`,
    };
  }

  // Full CDN / http URL — extract filename from path
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const fileName = value.split("/").pop() || `${Date.now()}.jpg`;
    return { sourceUrl: value, fileName };
  }

  // Local img/ path from Achievements App schema (e.g. "img/<hash>.jpg")
  // Extract hash and build CDN URL as fallback
  const cleaned = value.replace(/^img\//, "").replace(/\.jpg$/i, "").replace(/_gray$/, "");
  if (isSteamImageHash(cleaned)) {
    const suffix = type === "icon_gray" ? "_gray" : "";
    return {
      sourceUrl: buildCdnUrl(appId, cleaned),
      fileName: `${cleaned}${suffix}.jpg`,
    };
  }

  // Invalid — skip
  console.warn(`[ACH][IMG] skipped invalid source appid=${appId} value=${value}`);
  return null;
}

class AchievementImageQueueImpl {
  private queue: ImageQueueItem[] = [];
  private activeCount = 0;
  private maxConcurrent = 3;
  private failedCooldowns = new Map<string, number>();
  private callbacks: ImageUpdateCallback[] = [];
  private processing = false;

  subscribe(cb: ImageUpdateCallback): () => void {
    this.callbacks.push(cb);
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== cb);
    };
  }

  enqueue(items: ImageQueueItem[]) {
    for (const item of items) {
      const key = `${item.appId}_${item.apiName}_${item.type}`;
      if (this.failedCooldowns.has(key)) {
        const until = this.failedCooldowns.get(key)!;
        if (Date.now() < until) continue;
        this.failedCooldowns.delete(key);
      }
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
        this.activeCount++;
        this.downloadItem(item).finally(() => {
          this.activeCount--;
          tick();
        });
      }
      this.processing = false;
    };
    tick();
  }

  private async downloadItem(item: ImageQueueItem): Promise<void> {
    try {
      const dataUrl = await downloadAchievementImage({
        appId: Number(item.appId),
        url: item.sourceUrl,
        fileName: item.fileName,
      });
      if (dataUrl) {
        for (const cb of this.callbacks) {
          cb(item.apiName, item.type, dataUrl);
        }
        console.debug(`[ACH][IMG] downloaded appid=${item.appId} apiName=${item.apiName} type=${item.type}`);
      } else {
        console.debug(`[ACH][IMG] download returned null appid=${item.appId} apiName=${item.apiName} type=${item.type}`);
      }
    } catch (err) {
      const key = `${item.appId}_${item.apiName}_${item.type}`;
      this.failedCooldowns.set(key, Date.now() + 24 * 60 * 60 * 1000);
      console.warn(`[ACH][IMG] failed appid=${item.appId} apiName=${item.apiName} type=${item.type} reason=${err}`);
    }
  }
}

export const achievementImageQueue = new AchievementImageQueueImpl();
