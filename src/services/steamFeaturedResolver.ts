import { resolveSteamFeaturedCategories } from "./tauri";
import type { SteamFeaturedCategory } from "../types/steamFeatured";

const CACHE_KEY = "lumaforge-steam-featured-categories-cache";
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

type CacheShape = {
  savedAt: number;
  categories: SteamFeaturedCategory[];
};

function loadCache(): CacheShape | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CacheShape;

    if (!parsed.savedAt || !Array.isArray(parsed.categories)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function saveCache(categories: SteamFeaturedCategory[]) {
  const payload: CacheShape = {
    savedAt: Date.now(),
    categories,
  };

  localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
}

export async function resolveFeaturedStoreCategories(): Promise<
  SteamFeaturedCategory[]
> {
  const cached = loadCache();

  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return cached.categories;
  }

  const categories = await resolveSteamFeaturedCategories({
    countryCode: "US",
    language: "english",
  });

  saveCache(categories);

  return categories;
}

export function clearFeaturedStoreCategoriesCache() {
  localStorage.removeItem(CACHE_KEY);
}