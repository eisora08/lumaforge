import { resolveSteamReviewSummaries } from "./tauri";
import type { SteamReviewSummary } from "../types/gameReview";

const CACHE_KEY = "lumaforge-steam-review-summary-cache";

type ReviewCache = Record<string, SteamReviewSummary>;

function loadCache(): ReviewCache {
  try {
    const rawCache = localStorage.getItem(CACHE_KEY);

    if (!rawCache) {
      return {};
    }

    return JSON.parse(rawCache) as ReviewCache;
  } catch {
    return {};
  }
}

function saveCache(cache: ReviewCache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export async function resolveGameReviewSummaries(
  appIds: number[]
): Promise<Record<number, SteamReviewSummary>> {
  const uniqueAppIds = Array.from(new Set(appIds));
  const cache = loadCache();

  const missingAppIds = uniqueAppIds.filter(
    (appId) => !cache[String(appId)]
  );

  if (missingAppIds.length > 0) {
    const resolved = await resolveSteamReviewSummaries(missingAppIds);

    resolved.forEach((summary) => {
      cache[String(summary.app_id)] = summary;
    });

    saveCache(cache);
  }

  return uniqueAppIds.reduce<Record<number, SteamReviewSummary>>(
    (result, appId) => {
      result[appId] =
        cache[String(appId)] ?? createFallbackReviewSummary(appId);

      return result;
    },
    {}
  );
}

export function clearGameReviewSummaryCache() {
  localStorage.removeItem(CACHE_KEY);
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