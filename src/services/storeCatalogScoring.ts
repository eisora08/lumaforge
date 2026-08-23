// ---------------------------------------------------------------------------
// Catalog quality scoring — assigns a 0–1 score to each StoreCatalogGame
// based on metadata completeness, freshness, and section-specific criteria.
// Provider-agnostic: works with any source (RAWG, IGDB, steamdb, etc.).
//
// Two scoring functions:
//   scoreCatalogGame    — for sorting games within a section
//   scoreStoreDiscoverGame — for replacement decisions in mergeEnrichedSections
// ---------------------------------------------------------------------------

import type { StoreCatalogGame, CatalogProviderId } from "./storeCatalogProvider";

export type ScoringContext = {
  /** Which section this game will appear in. */
  sectionType: "new-noteworthy" | "top-rated" | "genre" | "for-you" | "more-to-explore" | "featured";
  /** Current timestamp in ms. */
  now?: number;
  /** Preferred genres for "for-you" sections. */
  preferredGenres?: Set<string>;
};

/**
 * Score a catalog game from 0 (low quality) to 1 (high quality).
 * Higher scores mean the game should appear earlier in its section.
 * Works with any provider — no source-specific assumptions.
 */
export function scoreCatalogGame(
  game: StoreCatalogGame,
  ctx: ScoringContext,
): number {
  const now = ctx.now ?? Date.now();
  let score = 0;

  // ── Base quality signals (0–0.4) ──

  // Has artwork (image URL)
  if (game.imageUrl) score += 0.12;
  if (game.backgroundImageUrl && game.backgroundImageUrl !== game.imageUrl) score += 0.03;
  if (game.screenshotUrls && game.screenshotUrls.length > 0) score += 0.02;

  // Has release date
  if (game.releaseDate && game.releaseTimestamp) score += 0.08;

  // Has genres
  if (game.genres && game.genres.length > 0) score += 0.05;
  if (game.genres && game.genres.length >= 2) score += 0.02;

  // Has rating
  if (game.rating && game.rating > 0) score += 0.05;
  if (game.metacritic && game.metacritic > 0) score += 0.05;

  // ── Section-specific scoring (0–0.6) ──

  switch (ctx.sectionType) {
    case "new-noteworthy": {
      // Recency is king
      if (game.releaseTimestamp) {
        const ageDays = (now - game.releaseTimestamp) / (1000 * 60 * 60 * 24);
        if (ageDays <= 30) score += 0.35;
        else if (ageDays <= 90) score += 0.28;
        else if (ageDays <= 180) score += 0.18;
        else if (ageDays <= 365) score += 0.08;
      }
      // Rating boost for new games
      if (game.metacritic && game.metacritic >= 75) score += 0.15;
      else if (game.rating && game.rating >= 3.5) score += 0.12;
      // Popularity signal (works for both RAWG `added` and IGDB `popularity`)
      if ((game.popularity ?? 0) > 70 || (game.rating && game.rating > 0)) score += 0.05;
      break;
    }

    case "top-rated": {
      // Metacritic/rating is king
      if (game.metacritic) {
        if (game.metacritic >= 90) score += 0.35;
        else if (game.metacritic >= 80) score += 0.28;
        else if (game.metacritic >= 70) score += 0.18;
      } else if (game.rating) {
        if (game.rating >= 4.5) score += 0.30;
        else if (game.rating >= 4.0) score += 0.22;
        else if (game.rating >= 3.5) score += 0.12;
      }
      // Has both rating sources = higher confidence
      if (game.metacritic && game.rating) score += 0.05;
      // Popularity signal
      if ((game.popularity ?? 0) > 80) score += 0.05;
      else if ((game.popularity ?? 0) > 60) score += 0.03;
      break;
    }

    case "genre": {
      // Genre match is implicit (already filtered), so score by quality
      if (game.metacritic && game.metacritic >= 75) score += 0.20;
      else if (game.rating && game.rating >= 3.5) score += 0.15;
      else if (game.rating && game.rating >= 3.0) score += 0.08;
      // Popularity within genre
      if ((game.popularity ?? 0) > 70) score += 0.12;
      else if ((game.popularity ?? 0) > 50) score += 0.08;
      // Recency helps genre sections feel fresh
      if (game.releaseTimestamp) {
        const ageDays = (now - game.releaseTimestamp) / (1000 * 60 * 60 * 24);
        if (ageDays <= 365) score += 0.08;
        else if (ageDays <= 730) score += 0.04;
      }
      break;
    }

    case "for-you": {
      // Genre preference match
      if (ctx.preferredGenres && game.genres) {
        const matches = game.genres.filter((g) => ctx.preferredGenres!.has(g)).length;
        score += Math.min(0.30, matches * 0.10);
      }
      // Quality baseline
      if (game.metacritic && game.metacritic >= 70) score += 0.15;
      else if (game.rating && game.rating >= 3.5) score += 0.10;
      // Popularity
      if ((game.popularity ?? 0) > 60) score += 0.08;
      break;
    }

    case "featured": {
      // High bar for featured
      if (game.metacritic && game.metacritic >= 80) score += 0.25;
      else if (game.rating && game.rating >= 4.0) score += 0.18;
      if ((game.popularity ?? 0) > 75) score += 0.10;
      if (game.genres && game.genres.length >= 2) score += 0.05;
      break;
    }

    case "more-to-explore": {
      // Broad but still needs artwork + title
      if (game.metacritic && game.metacritic >= 65) score += 0.10;
      else if (game.rating && game.rating >= 3.0) score += 0.06;
      if ((game.popularity ?? 0) > 40) score += 0.05;
      break;
    }
  }

  // ── Source quality bonus (provider-agnostic) ──
  const enrichedSources: readonly CatalogProviderId[] = ["rawg", "igdb"];
  if ((enrichedSources as readonly string[]).includes(game.source) && game.metacritic) score += 0.02;
  if (game.source === "curated") score += 0.03; // Curated = hand-picked

  // ── Penalty for steamdb-only (no enrichment) ──
  if (game.source === "steamdb" && !game.imageUrl) score -= 0.10;

  return Math.max(0, Math.min(1, score));
}

/**
 * Score and sort a list of catalog games for a given section.
 * Returns the same array, sorted by score descending, with scores assigned.
 */
export function scoreAndSortGames(
  games: StoreCatalogGame[],
  ctx: ScoringContext,
): StoreCatalogGame[] {
  for (const game of games) {
    game.score = scoreCatalogGame(game, ctx);
  }
  games.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return games;
}

// ---------------------------------------------------------------------------
// Discover-section scoring — used by mergeEnrichedSections to decide whether
// a provider section should REPLACE an existing (curated/steamdb) section.
// Accounts for curated quality, steamAppId presence, metadata completeness.
// ---------------------------------------------------------------------------

/** Minimum avg score for a provider section to replace a curated section. */
export const SECTION_REPLACE_MIN_AVG = 0.30;

/**
 * Score a single game for Discover-section replacement decisions.
 * Different from scoreCatalogGame (intra-section sort) — this penalizes
 * games without steamAppId and boosts curated/known-quality sources.
 */
export function scoreStoreDiscoverGame(
  game: StoreCatalogGame,
  _ctx?: ScoringContext,
): number {
  let score = 0;

  // ── Metadata completeness (0–0.30) ──
  if (game.imageUrl || game.backgroundImageUrl) score += 0.10;
  if (game.genres && game.genres.length > 0) score += 0.05;
  if (game.genres && game.genres.length >= 2) score += 0.03;
  if (game.releaseDate || game.releaseTimestamp) score += 0.04;
  if (game.rating && game.rating > 0) score += 0.04;
  if (game.metacritic && game.metacritic > 0) score += 0.04;

  // ── steamAppId presence — REQUIRED for Store UI navigation (0–0.15) ──
  if (game.steamAppId) {
    score += 0.15;
  } else {
    // IGDB-only games without steamAppId can't navigate to Store details
    score -= 0.25;
  }

  // ── Source quality (0–0.20) ──
  if (game.source === "curated") score += 0.20;  // Hand-picked = high quality
  if (game.source === "igdb") score += 0.08;     // Enriched metadata
  if (game.source === "rawg") score += 0.06;     // Enriched metadata
  if (game.source === "steamdb") score += 0.02;  // Basic metadata only
  if (game.source === "cache") score += 0.05;     // Cached enriched data

  // ── Rating quality (0–0.15) ──
  if (game.metacritic && game.metacritic >= 80) score += 0.15;
  else if (game.metacritic && game.metacritic >= 70) score += 0.10;
  else if (game.rating && game.rating >= 4.0) score += 0.12;
  else if (game.rating && game.rating >= 3.5) score += 0.08;

  // ── Popularity signal (0–0.10) ──
  if ((game.popularity ?? 0) > 80) score += 0.10;
  else if ((game.popularity ?? 0) > 60) score += 0.06;
  else if ((game.popularity ?? 0) > 40) score += 0.03;

  return Math.max(0, Math.min(1, score));
}

/**
 * Compute the average score for a list of catalog games using Discover scoring.
 * Filters out games without steamAppId before scoring (they can't navigate).
 * Returns [avgScore, countOfScoredGames].
 */
export function averageDiscoverScore(
  games: StoreCatalogGame[],
): [number, number] {
  if (games.length === 0) return [0, 0];
  const scored = games.map((g) => scoreStoreDiscoverGame(g));
  const sum = scored.reduce((a, b) => a + b, 0);
  return [sum / scored.length, scored.length];
}
