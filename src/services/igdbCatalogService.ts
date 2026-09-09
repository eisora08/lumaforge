// ---------------------------------------------------------------------------
// IGDB Catalog Service — fetches game catalogs from the IGDB API.
// Used by the StoreCatalogOrchestrator for enriched discovery sections.
// Requires Twitch Client ID + Client Secret configured in Settings.
// ---------------------------------------------------------------------------

import type { StoreCatalogGame } from "./storeCatalogProvider";
import { getIgdbAccessToken, resolveIgdbCredentials } from "./igdbAccessTokenService";
import { igdbQueryCatalog, type IgdbCatalogGame } from "./tauri";

const DEBUG_STORE_CATALOG = false;

// ── Dedup + inflight tracking ──
const _igdbInFlight = new Map<string, Promise<StoreCatalogGame[]>>();
const _igdbLastCall = new Map<string, number>();
const IGDB_MIN_INTERVAL_MS = 1100;

// ── IGDB Genre ID → display name ──
const IGDB_GENRE_MAP: Record<number, string> = {
  2: "Point-and-click",
  4: "Fighting",
  5: "Shooter",
  7: "Music",
  8: "Platform",
  9: "Puzzle",
  10: "Racing",
  11: "Real Time Strategy (RTS)",
  12: "Role-playing (RPG)",
  13: "Simulator",
  14: "Sport",
  15: "Strategy",
  16: "Turn-based strategy (TBS)",
  24: "Tactical",
  25: "Hack and slash/Beat 'em up",
  26: "Quiz/Trivia",
  30: "Pinball",
  31: "Adventure",
  32: "Indie",
  33: "Arcade",
  34: "Visual Novel",
  35: "Card & Board Game",
  36: "MOBA",
  42: "Quiz",
};

// ── Section → IGDB query templates ──

type IgdbSectionQuery = {
  tag: string;
  title: string;
  query: string;
};

function buildIgdbSectionQueries(): IgdbSectionQuery[] {
  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - 365 * 24 * 60 * 60;

  // Relaxed thresholds: IGDB total_rating_count is 0-10000+ scale.
  // Many quality games have rating_count < 20. Requiring 50-100 returns
  // near-zero results. We use very low minimums and rely on our scoring
  // function for quality ordering.
  return [
    {
      tag: "new-noteworthy",
      title: "New & Noteworthy",
      query: `fields name, summary, first_release_date, genres.name, rating, popularity, cover.url, screenshots.url, involved_companies.company.name, involved_companies.publisher, involved_companies.developer, external_games.category, external_games.url, external_games.uid; where first_release_date > ${oneYearAgo} & total_rating_count >= 3; sort first_release_date desc; limit 30;`,
    },
    {
      tag: "top-picks",
      title: "Top Picks",
      query: `fields name, summary, first_release_date, genres.name, rating, popularity, cover.url, screenshots.url, involved_companies.company.name, involved_companies.publisher, involved_companies.developer, external_games.category, external_games.url, external_games.uid; where total_rating_count >= 5 & rating >= 50; sort rating desc; limit 30;`,
    },
    {
      tag: "featured",
      title: "Featured",
      query: `fields name, summary, first_release_date, genres.name, rating, popularity, cover.url, screenshots.url, involved_companies.company.name, involved_companies.publisher, involved_companies.developer, external_games.category, external_games.url, external_games.uid; where total_rating_count >= 10 & rating >= 60; sort popularity desc; limit 30;`,
    },
  ];
}

// ── Map IGDB response to StoreCatalogGame ──

function mapIgdbGame(g: IgdbCatalogGame): StoreCatalogGame | null {
  if (!g.igdb_id || !g.name) return null;

  // Parse cover URL — IGDB returns "//images.igdb.com/..." format
  let imageUrl: string | undefined;
  if (g.cover_url) {
    imageUrl = g.cover_url.startsWith("//") ? `https:${g.cover_url}` : g.cover_url;
  }

  // Parse screenshot URLs
  const screenshotUrls = g.screenshot_urls?.map((url) =>
    url.startsWith("//") ? `https:${url}` : url,
  ) ?? [];

  // Map genre names (IGDB returns full genre names, but sometimes IDs)
  const genres = g.genres?.map((name) => {
    // If it's a numeric string, try to look up the display name
    const numId = Number(name);
    if (!isNaN(numId) && IGDB_GENRE_MAP[numId]) return IGDB_GENRE_MAP[numId];
    return name;
  }) ?? [];

  // Parse release date timestamp
  let releaseTimestamp: number | undefined;
  if (g.first_release_date) {
    // IGDB returns ISO date string from Rust, parse it
    const parsed = new Date(g.first_release_date).getTime();
    if (!isNaN(parsed)) releaseTimestamp = parsed;
  }

  return {
    id: `igdb-${g.igdb_id}`,
    title: g.name,
    source: "igdb",
    igdbId: g.igdb_id,
    releaseDate: g.first_release_date ?? undefined,
    releaseTimestamp,
    genres,
    rating: g.rating ?? undefined,
    metacritic: undefined, // IGDB doesn't provide metacritic directly
    popularity: g.popularity ?? undefined,
    imageUrl,
    backgroundImageUrl: imageUrl,
    screenshotUrls,
    developers: g.developers ?? undefined,
    publishers: g.publishers ?? undefined,
    description: g.summary ?? undefined,
    steamAppId: g.steam_app_id ?? undefined,
  };
}

// ── Fetch a single section ──

async function fetchIgdbSection(
  clientId: string,
  accessToken: string,
  section: IgdbSectionQuery,
  timeoutMs = 12000,
): Promise<StoreCatalogGame[]> {
  // Rate limit
  const lastCall = _igdbLastCall.get(section.tag) ?? 0;
  const elapsed = Date.now() - lastCall;
  if (elapsed < IGDB_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, IGDB_MIN_INTERVAL_MS - elapsed));
  }

  if (_igdbInFlight.has(section.tag)) {
    return _igdbInFlight.get(section.tag)!;
  }

  const promise = (async () => {
    _igdbLastCall.set(section.tag, Date.now());
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      if (DEBUG_STORE_CATALOG) {
        console.log(`[STORE_CATALOG][IGDB_QUERY_START] sectionId=${section.tag} queryName=${section.title}`);
      }

      const rawGames = await igdbQueryCatalog(clientId, accessToken, section.query);
      clearTimeout(timer);

      const games = rawGames.map(mapIgdbGame).filter((g): g is StoreCatalogGame => g !== null);

      if (DEBUG_STORE_CATALOG) {
        const firstTitles = games.slice(0, 3).map((g) => g.title).join(", ");
        const firstSteamIds = games.slice(0, 5).map((g) => g.steamAppId ?? "none").join(", ");
        console.log(`[STORE_CATALOG][IGDB_QUERY_RESULT] sectionId=${section.tag} rawCount=${rawGames.length} mappedCount=${games.length} firstTitles=[${firstTitles}] firstSteamIds=[${firstSteamIds}]`);
      }

      return games;
    } catch (err: any) {
      if (err?.name !== "AbortError" && !String(err).includes("abort")) {
        if (DEBUG_STORE_CATALOG) {
          console.log(`[STORE_CATALOG][IGDB_QUERY_RESULT] sectionId=${section.tag} rawCount=0 mappedCount=0 error=${err?.message ?? err}`);
        }
      }
      return [];
    } finally {
      _igdbInFlight.delete(section.tag);
    }
  })();

  _igdbInFlight.set(section.tag, promise);
  return promise;
}

// ── Public API ──

/**
 * Fetch all IGDB catalog sections concurrently.
 * Returns a map of section tag → games array.
 */
export async function fetchIgdbCatalogSections(
  clientId: string,
  clientSecret: string,
): Promise<Map<string, StoreCatalogGame[]>> {
  const creds = resolveIgdbCredentials(clientId, clientSecret);
  if (!creds.clientId || !creds.clientSecret) return new Map();

  let accessToken: string;
  try {
    if (DEBUG_STORE_CATALOG) {
      console.log(`[STORE_CATALOG][IGDB_QUERY_START] sectionId=token queryName=acquire-token`);
    }
    accessToken = await getIgdbAccessToken(creds.clientId, creds.clientSecret);
    if (DEBUG_STORE_CATALOG) {
      console.log(`[STORE_CATALOG][IGDB_QUERY_RESULT] sectionId=token rawCount=1 mappedCount=1 firstTitles=[token-ok]`);
    }
  } catch (err) {
    if (DEBUG_STORE_CATALOG) {
      console.log(`[STORE_CATALOG][IGDB_QUERY_RESULT] sectionId=token rawCount=0 mappedCount=0 error=${err}`);
    }
    return new Map();
  }

  const sections = buildIgdbSectionQueries();
  const results = await Promise.allSettled(
    sections.map((sec) => fetchIgdbSection(creds.clientId, accessToken, sec)),
  );

  const map = new Map<string, StoreCatalogGame[]>();
  for (let i = 0; i < sections.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      map.set(sections[i].tag, result.value);
    } else {
      map.set(sections[i].tag, []);
    }
  }
  return map;
}

/** Get total IGDB games fetched in a batch. */
export function countIgdbGames(sections: Map<string, StoreCatalogGame[]>): number {
  let count = 0;
  for (const games of sections.values()) count += games.length;
  return count;
}
