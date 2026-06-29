import { resolveSteamReviewSummaries, readStoreReviewSummary, writeStoreReviewSummary } from "./tauri";
import type { SteamReviewSummary } from "../types/gameReview";

const ENABLE_VERBOSE_STORE_CACHE_LOGS = false;

const inMemoryCache = new Map<number, SteamReviewSummary>();

function log(...args: unknown[]) {
  if (ENABLE_VERBOSE_STORE_CACHE_LOGS) {
    console.debug("[ReviewResolver]", ...args);
  }
}

async function loadFromAppCache(appId: number): Promise<SteamReviewSummary | null> {
  try {
    const cached = await readStoreReviewSummary(appId);
    if (cached && cached.data) {
      log("app-data cache hit for", appId);
      return cached.data as SteamReviewSummary;
    }
  } catch {
    // corrupt or missing
  }
  return null;
}

async function saveToAppCache(appId: number, data: SteamReviewSummary): Promise<void> {
  try {
    await writeStoreReviewSummary(appId, {
      app_id: appId,
      data,
      updated_at: Date.now(),
      version: 1,
    });
  } catch {
    // non-critical
  }
}

export async function resolveGameReviewSummaries(
  appIds: number[]
): Promise<Record<number, SteamReviewSummary>> {
  const uniqueAppIds = Array.from(new Set(appIds));
  const result: Record<number, SteamReviewSummary> = {};
  const missingAppIds: number[] = [];

  for (const appId of uniqueAppIds) {
    const cached = inMemoryCache.get(appId);
    if (cached) {
      result[appId] = cached;
    } else {
      missingAppIds.push(appId);
    }
  }

  if (missingAppIds.length === 0) {
    return result;
  }

  const toFetch: number[] = [];

  for (const appId of missingAppIds) {
    const fromDisk = await loadFromAppCache(appId);
    if (fromDisk) {
      inMemoryCache.set(appId, fromDisk);
      result[appId] = fromDisk;
    } else {
      toFetch.push(appId);
    }
  }

  if (toFetch.length === 0) {
    return result;
  }

  const resolved = await resolveSteamReviewSummaries(toFetch);

  for (const summary of resolved) {
    inMemoryCache.set(summary.app_id, summary);
    result[summary.app_id] = summary;
    saveToAppCache(summary.app_id, summary);
  }

  for (const appId of toFetch) {
    if (!result[appId]) {
      result[appId] = createFallbackReviewSummary(appId);
    }
  }

  return result;
}

export function clearGameReviewSummaryCache() {
  inMemoryCache.clear();
}

function createFallbackReviewSummary(appId: number): SteamReviewSummary {
  return {
    app_id: appId,
    review_score: 0,
    review_score_desc: "N/A",
    total_positive: 0,
    total_negative: 0,
    total_reviews: 0,
    positive_percent: null,
    resolved: false,
  };
}
