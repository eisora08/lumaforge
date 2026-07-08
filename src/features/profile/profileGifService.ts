export type ProfileGifResult = {
  id: string;
  previewUrl: string;
  gifUrl: string;
  title: string;
  source: "giphy";
};

export type GifServiceStatus =
  | { available: true; key: string }
  | { available: false; reason: "missing-key" | "error" };

const GIPHY_SEARCH_URL = "https://api.giphy.com/v1/gifs/search";
const GIPHY_TRENDING_URL = "https://api.giphy.com/v1/gifs/trending";
const RATING = "g";
const LIMIT = 24;

function getApiKey(): string | null {
  if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_GIPHY_API_KEY) {
    return import.meta.env.VITE_GIPHY_API_KEY as string;
  }
  return null;
}

export function getGifServiceStatus(): GifServiceStatus {
  const key = getApiKey();
  if (!key) return { available: false, reason: "missing-key" };
  return { available: true, key };
}

function parseGiphyResponse(data: any): ProfileGifResult[] {
  if (!data?.data || !Array.isArray(data.data)) return [];
  return data.data.map((item: any) => {
    const downsized = item.images?.downsized?.url ?? item.images?.original?.url ?? "";
    const preview = item.images?.preview_gif?.url ?? item.images?.fixed_width_small?.url ?? downsized;
    return {
      id: item.id,
      previewUrl: preview,
      gifUrl: downsized,
      title: item.title || "",
      source: "giphy" as const,
    };
  });
}

async function fetchGiphy(endpoint: string, params: Record<string, string>): Promise<ProfileGifResult[]> {
  const status = getGifServiceStatus();
  if (!status.available) return [];

  const url = new URL(endpoint);
  url.searchParams.set("api_key", status.key);
  url.searchParams.set("rating", RATING);
  url.searchParams.set("limit", String(LIMIT));
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    return parseGiphyResponse(data);
  } catch {
    return [];
  }
}

export async function searchProfileGifs(query: string): Promise<ProfileGifResult[]> {
  if (!query.trim()) return [];
  return fetchGiphy(GIPHY_SEARCH_URL, { q: query.trim() });
}

export async function getTrendingProfileGifs(): Promise<ProfileGifResult[]> {
  return fetchGiphy(GIPHY_TRENDING_URL, {});
}
