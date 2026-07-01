import type { LibraryGame } from "../types/libraryGame";
import type { PlaytimeStore } from "./playtimeService";

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
