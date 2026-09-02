import type { LibraryGame } from "../types/libraryGame";
import type { PlaytimeStore } from "./playtimeService";
import type { SteamAppMetadata } from "../types/gameMetadata";

/** Minimal shape used by the recommendation engine for catalog fill. */
export type CatalogGameEntry = {
  appId: string;
  title: string;
  installed: boolean;
  metadataJson: string;
};

type UserProfile = {
  genres: Set<string>;
  categories: Set<string>;
};

type ScoredGame = {
  game: LibraryGame;
  matchCount: number;
};

function buildUserProfile(
  games: LibraryGame[],
  favoriteIds: Set<string>,
  playtimeStore: PlaytimeStore | null,
): UserProfile {
  const genres = new Set<string>();
  const categories = new Set<string>();

  const interestAppIds = new Set<string>();

  for (const game of games) {
    if (!game.appId) continue;
    if (favoriteIds.has(game.appId)) {
      interestAppIds.add(game.appId);
      continue;
    }
    const entry = playtimeStore?.games[`app-${game.appId}`];
    const totalSeconds =
      entry?.totalPlaytimeSeconds ??
      (game.steamPlaytimeMinutes ? game.steamPlaytimeMinutes * 60 : 0);
    if (totalSeconds > 0) {
      interestAppIds.add(game.appId);
    }
  }

  for (const game of games) {
    if (!game.appId || !interestAppIds.has(game.appId)) continue;
    const meta = game.metadata;
    if (!meta) continue;
    for (const g of meta.genres) genres.add(g.toLowerCase());
    for (const c of meta.categories) categories.add(c.toLowerCase());
  }

  return { genres, categories };
}

function scoreGame(
  game: LibraryGame,
  profile: UserProfile,
): number {
  const meta = game.metadata;
  if (!meta) return 0;

  let matches = 0;
  for (const g of meta.genres) {
    if (profile.genres.has(g.toLowerCase())) matches++;
  }
  for (const c of meta.categories) {
    if (profile.categories.has(c.toLowerCase())) matches++;
  }
  return matches;
}

export function getRecommendedGames(
  games: LibraryGame[],
  favoriteIds: Set<string>,
  playtimeStore: PlaytimeStore | null,
  continuePlayingAppIds: Set<string>,
  limit = 10,
): LibraryGame[] {
  const profile = buildUserProfile(games, favoriteIds, playtimeStore);

  if (profile.genres.size === 0 && profile.categories.size === 0) {
    return getFallbackRecommendations(games, favoriteIds, continuePlayingAppIds, limit);
  }

  const excludeIds = new Set<string>();
  for (const id of favoriteIds) excludeIds.add(id);
  for (const id of continuePlayingAppIds) excludeIds.add(id);

  const scored: ScoredGame[] = [];

  for (const game of games) {
    if (!game.appId) continue;
    if (excludeIds.has(game.appId)) continue;
    if (game.steamInstalled) continue;

    const matchCount = scoreGame(game, profile);
    if (matchCount === 0) continue;

    scored.push({ game, matchCount });
  }

  scored.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    const aPop = a.game.metadata?.dlc_count ?? 0;
    const bPop = b.game.metadata?.dlc_count ?? 0;
    if (bPop !== aPop) return bPop - aPop;
    return a.game.title.localeCompare(b.game.title);
  });

  const seen = new Set<string>();
  const result: LibraryGame[] = [];
  for (const { game } of scored) {
    if (!game.appId || seen.has(game.appId)) continue;
    seen.add(game.appId);
    result.push(game);
    if (result.length >= limit) break;
  }

  return result;
}

function getFallbackRecommendations(
  games: LibraryGame[],
  favoriteIds: Set<string>,
  continuePlayingAppIds: Set<string>,
  limit = 10,
): LibraryGame[] {
  const excludeIds = new Set<string>();
  for (const id of favoriteIds) excludeIds.add(id);
  for (const id of continuePlayingAppIds) excludeIds.add(id);

  const scored = games
    .filter((g) => g.appId && !excludeIds.has(g.appId) && !g.steamInstalled)
    .map((g) => ({
      game: g,
      playtime: g.steamPlaytimeMinutes ?? 0,
    }))
    .sort((a, b) => {
      if (b.playtime !== a.playtime) return b.playtime - a.playtime;
      return a.game.title.localeCompare(b.game.title);
    });

  const seen = new Set<string>();
  const result: LibraryGame[] = [];
  for (const { game } of scored) {
    if (!game.appId || seen.has(game.appId)) continue;
    seen.add(game.appId);
    result.push(game);
    if (result.length >= limit) break;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Extend personalized recommendations with global catalog fill when the
// user's library yields fewer than `limit` results.
// ---------------------------------------------------------------------------
export function getRecommendedWithGlobalFill(
  games: LibraryGame[],
  catalogEntries: CatalogGameEntry[],
  favoriteIds: Set<string>,
  playtimeStore: PlaytimeStore | null,
  continuePlayingAppIds: Set<string>,
  limit = 10,
): LibraryGame[] {
  // First run the existing personalized algorithm
  const personalized = getRecommendedGames(games, favoriteIds, playtimeStore, continuePlayingAppIds, limit);

  if (personalized.length >= limit) return personalized;

  // Build user profile for scoring catalog entries
  const profile = buildUserProfile(games, favoriteIds, playtimeStore);
  if (profile.genres.size === 0 && profile.categories.size === 0) return personalized;

  // Map library games to exclude
  const excludeIds = new Set<string>();
  for (const g of personalized) if (g.appId) excludeIds.add(g.appId);
  for (const id of favoriteIds) excludeIds.add(id);
  for (const id of continuePlayingAppIds) excludeIds.add(id);
  for (const g of games) if (g.appId) excludeIds.add(g.appId);

  // Score catalog entries by genre/category match
  const scored: Array<{ game: LibraryGame; matchCount: number }> = [];
  for (const entry of catalogEntries) {
    if (!entry.appId || excludeIds.has(entry.appId)) continue;
    const meta = parseMetadataJson(entry.metadataJson);
    if (!meta) continue;

    let matches = 0;
    for (const g of meta.genres) {
      if (profile.genres.has(g.toLowerCase())) matches++;
    }
    for (const c of meta.categories) {
      if (profile.categories.has(c.toLowerCase())) matches++;
    }
    if (matches === 0) continue;

    const fakeGame: Partial<LibraryGame> = {
      id: `catalog-${entry.appId}`,
      appId: entry.appId,
      title: entry.title,
      source: "steam",
      metadata: meta,
      steamInstalled: entry.installed,
    };

    scored.push({ game: fakeGame as LibraryGame, matchCount: matches });
  }

  scored.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return a.game.title.localeCompare(b.game.title);
  });

  const result = [...personalized];
  const seen = new Set<string>();
  for (const g of personalized) if (g.appId) seen.add(g.appId);
  for (const { game } of scored) {
    if (!game.appId || seen.has(game.appId)) continue;
    seen.add(game.appId);
    result.push(game);
    if (result.length >= limit) break;
  }

  return result;
}

function parseMetadataJson(json: string): SteamAppMetadata | null {
  try {
    if (json && json !== "{}") {
      return JSON.parse(json) as SteamAppMetadata;
    }
  } catch { /* ignore */ }
  return null;
}
