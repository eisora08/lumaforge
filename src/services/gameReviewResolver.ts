import { resolveSteamReviewSummaries, readStoreReviewSummary } from "./tauri";
import type { SteamReviewSummary } from "../types/gameReview";

const ENABLE_VERBOSE_STORE_CACHE_LOGS = false;

const inMemoryCache = new Map<number, SteamReviewSummary>();

function log(...args: unknown[]) {
  if (ENABLE_VERBOSE_STORE_CACHE_LOGS) {
    console.debug("[ReviewResolver]", ...args);
  }
}

async function loadFromAppCache(appId: number): Promise<SteamReviewSummary | null> {
  // SQLite-first fallback: fast boot reads without scanning 5K JSON files
  try {
    const { getStoreReviewFromDb } = await import("./tauri");
    const dbRow = await getStoreReviewFromDb(String(appId));
    if (dbRow && dbRow.data) {
      log("sqlite cache hit for", appId);
      return JSON.parse(dbRow.data) as SteamReviewSummary;
    }
  } catch {
    // not in SQLite yet
  }
  // JSON fallback
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
    const { upsertStoreReview } = await import("./tauri");
    await upsertStoreReview({
      appId: String(appId),
      data: JSON.stringify(data),
      updatedAt: Date.now(),
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

  const diskResults = await Promise.allSettled(missingAppIds.map((appId) => loadFromAppCache(appId)));
  for (let i = 0; i < missingAppIds.length; i++) {
    const appId = missingAppIds[i];
    const settled = diskResults[i];
    if (settled.status === "fulfilled" && settled.value) {
      inMemoryCache.set(appId, settled.value);
      result[appId] = settled.value;
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
