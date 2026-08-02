/**
 * Repack title matching — token-aware ranking for the Store "Repacks" aside.
 *
 * The raw SQL path (`query_by_fuzzy_title` in repack_catalog.rs) does a plain
 * substring `LIKE '%' || ? || '%'` ordered by title length ASC. That mounts
 * unrelated repacks when the query is a substring of another word — e.g.
 * "Portal" → SPORTAL, "Star" → Stardiver, "Hades" → Hades II first. These pure
 * helpers re-rank the SQL candidate pool with whole-word token matching and a
 * simple tier score (exact > prefix > partial, shorter titles first).
 */

/**
 * Mirror the Rust normalization (repack_catalog.rs): lowercase, strip every
 * non-alphanumeric / non-whitespace char, collapse whitespace runs.
 */
export function normalizeRepackTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

const MIN_TOKEN_LENGTH = 2;

/**
 * Score a candidate title against a query.
 *
 * Requires every significant query token (>= 2 chars) to appear as a WHOLE
 * WORD in the normalized title. This rejects substring-inside-word garbage:
 * "portal" does not match "sportal", "star" does not match "stardiver".
 *
 * Returns a lower-is-better sort key, or `null` when the candidate should be
 * discarded. Tier = exact match (0) > title starts with the full query (1) >
 * partial / all-tokens (2); within a tier shorter titles win.
 */
export function scoreRepackMatch(query: string, title: string): number | null {
  const normalizedQuery = normalizeRepackTitle(query);
  const queryTokens = normalizedQuery.split(" ").filter((t) => t.length >= MIN_TOKEN_LENGTH);
  if (queryTokens.length === 0) return null;

  const normalizedTitle = normalizeRepackTitle(title);
  const titleWords = new Set(normalizedTitle.split(" ").filter(Boolean));

  for (const token of queryTokens) {
    if (!titleWords.has(token)) return null;
  }

  let tier: number;
  if (normalizedTitle === normalizedQuery) {
    tier = 0;
  } else if (normalizedTitle.startsWith(normalizedQuery)) {
    tier = 1;
  } else {
    tier = 2;
  }

  return tier * 1_000_000 + normalizedTitle.length;
}

/**
 * Rank a raw SQL candidate pool with scoreRepackMatch, discard non-matches,
 * sort by score (lower = better) and return the top `limit`.
 */
export function rankRepackMatches<T extends { title: string }>(
  query: string,
  candidates: T[],
  limit: number,
): T[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of candidates) {
    const score = scoreRepackMatch(query, item.title);
    if (score !== null) scored.push({ item, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.item);
}
