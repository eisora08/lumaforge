// ---------------------------------------------------------------------------
// RAWG Catalog Service — fetches game catalogs from the RAWG API.
// Used by the StoreCatalogOrchestrator for enriched discovery sections.
// Requires a valid RAWG API key configured in Settings.
// ---------------------------------------------------------------------------

import type { StoreCatalogGame } from "./storeCatalogProvider";

const DEBUG_RAWG_CATALOG = false;

// ── Dedup + inflight tracking ──
const _rawgInFlight = new Map<string, Promise<StoreCatalogGame[]>>();
const _rawgLastCall = new Map<string, number>(); // endpoint → last call timestamp
const RAWG_MIN_INTERVAL_MS = 1100; // ~55 requests/min safe limit

// ── Types matching RAWG /api/games response ──
type RawgGameResult = {
  id: number;
  slug: string;
  name: string;
  released: string | null;
  background_image: string | null;
  rating: number;
  rating_top: number;
  ratings_count: number;
  metacritic: number | null;
  added: number;
  genres: { id: number; name: string }[];
  tags: { id: number; name: string }[];
  stores: { store: { id: number; name: string }; url: string | null }[];
  short_screenshots: { id: number; image: string }[];
  esrb_rating: { id: number; name: string } | null;
};

type RawgApiResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: RawgGameResult[];
};

// ── Genre ID mapping (RAWG genre IDs → display names) ──
const RAWG_GENRE_MAP: Record<number, string> = {
  4: "Action",
  3: "Adventure",
  5: "RPG",
  14: "Simulation",
  15: "Strategy",
  1: "Racing",
  11: "Arcade",
  17: "Casual",
  7: "Puzzle",
  2: "Indie",
  83: "Platformer",
  59: "Massively Multiplayer",
  40: "Casual",
};

// ── Endpoints ──
type RawgEndpoint = {
  tag: string;
  url: string;
};

function buildRawgUrl(
  apiKey: string,
  opts: {
    dates?: string;
    ordering?: string;
    genres?: string;
    page_size?: number;
    metacritic?: string;
  },
): string {
  const params = new URLSearchParams({
    key: apiKey,
    page_size: String(opts.page_size ?? 20),
    ordering: opts.ordering ?? "-rating",
  });
  if (opts.dates) params.set("dates", opts.dates);
  if (opts.genres) params.set("genres", opts.genres);
  if (opts.metacritic) params.set("metacritic", opts.metacritic);
  // Exclude non-game types
  params.set("exclude_additions", "true");
  return `https://api.rawg.io/api/games?${params.toString()}`;
}

function mapRawgGame(g: RawgGameResult): StoreCatalogGame {
  const steamStore = g.stores?.find((s) => s.store.id === 1); // Steam store

  // Extract Steam app ID from RAWG store URL
  let steamAppId: string | undefined;
  if (steamStore?.url) {
    // URL format: https://store.steampowered.com/app/12345/slug-name
    const match = steamStore.url.match(/\/app\/(\d+)/);
    if (match) steamAppId = match[1];
  }

  return {
    id: `rawg-${g.id}`,
    title: g.name,
    source: "rawg",
    rawgId: g.id,
    steamAppId,
    releaseDate: g.released ?? undefined,
    releaseTimestamp: g.released ? new Date(g.released).getTime() : undefined,
    genres: g.genres?.map((genre) => RAWG_GENRE_MAP[genre.id] ?? genre.name) ?? [],
    tags: g.tags?.slice(0, 10).map((t) => t.name) ?? [],
    rating: g.rating ?? undefined,
    metacritic: g.metacritic ?? undefined,
    popularity: g.added ?? undefined, // Map RAWG `added` to generic `popularity`
    imageUrl: g.background_image ?? undefined,
    backgroundImageUrl: g.background_image ?? undefined,
    screenshotUrls: g.short_screenshots?.slice(1, 5).map((s) => s.image) ?? [],
    storeUrl: steamStore
      ? `https://store.steampowered.com/app/${steamAppId ?? g.id}`
      : undefined,
  };
}

async function fetchRawgEndpoint(
  apiKey: string,
  endpoint: RawgEndpoint,
  timeoutMs = 10000,
): Promise<StoreCatalogGame[]> {
  if (!apiKey) return [];

  // Rate limit
  const lastCall = _rawgLastCall.get(endpoint.tag) ?? 0;
  const elapsed = Date.now() - lastCall;
  if (elapsed < RAWG_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, RAWG_MIN_INTERVAL_MS - elapsed));
  }

  if (_rawgInFlight.has(endpoint.tag)) {
    return _rawgInFlight.get(endpoint.tag)!;
  }

  const promise = (async () => {
    _rawgLastCall.set(endpoint.tag, Date.now());
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(endpoint.url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        if (DEBUG_RAWG_CATALOG) console.log(`[RAWG_CATALOG] endpoint=${endpoint.tag} status=${res.status}`);
        return [];
      }
      const body: RawgApiResponse = await res.json();
      const games = (body.results ?? []).map(mapRawgGame);
      if (DEBUG_RAWG_CATALOG) console.log(`[RAWG_CATALOG] endpoint=${endpoint.tag} games=${games.length}`);
      return games;
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        if (DEBUG_RAWG_CATALOG) console.log(`[RAWG_CATALOG] endpoint=${endpoint.tag} error=${err?.message ?? err}`);
      }
      return [];
    } finally {
      _rawgInFlight.delete(endpoint.tag);
    }
  })();

  _rawgInFlight.set(endpoint.tag, promise);
  return promise;
}

// ── Public: build endpoint list ──

export function buildRawgEndpoints(apiKey: string): RawgEndpoint[] {
  const now = new Date();
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const today = now.toISOString().split("T")[0];
  const yearStart = `${now.getFullYear()}-01-01`;
  const yearEnd = `${now.getFullYear()}-12-31`;

  return [
    {
      tag: "new-noteworthy",
      url: buildRawgUrl(apiKey, {
        dates: `${threeMonthsAgo},${today}`,
        ordering: "-released",
        page_size: 20,
      }),
    },
    {
      tag: "popular-year",
      url: buildRawgUrl(apiKey, {
        dates: `${yearStart},${yearEnd}`,
        ordering: "-rating",
        page_size: 20,
      }),
    },
    {
      tag: "top-rated",
      url: buildRawgUrl(apiKey, {
        ordering: "-metacritic",
        page_size: 20,
        metacritic: "80,100",
      }),
    },
  ];
}

// ── Public: fetch all endpoints concurrently ──

export async function fetchRawgCatalogSections(
  apiKey: string,
): Promise<Map<string, StoreCatalogGame[]>> {
  if (!apiKey) return new Map();

  const endpoints = buildRawgEndpoints(apiKey);
  const results = await Promise.allSettled(
    endpoints.map((ep) => fetchRawgEndpoint(apiKey, ep)),
  );

  const map = new Map<string, StoreCatalogGame[]>();
  for (let i = 0; i < endpoints.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      map.set(endpoints[i].tag, result.value);
    } else {
      map.set(endpoints[i].tag, []);
    }
  }
  return map;
}

/** Get total RAWG games fetched in a batch. */
export function countRawgGames(sections: Map<string, StoreCatalogGame[]>): number {
  let count = 0;
  for (const games of sections.values()) count += games.length;
  return count;
}
