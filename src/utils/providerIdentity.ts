/**
 * Provider-neutral identity helpers for LibraryGame.
 *
 * Canonical identity priority (all providers):
 *   1. non-empty libraryId
 *   2. providerId + providerGameId (explicit provider identity)
 *   3. non-empty id (legacy records without libraryId/providerId)
 *   4. Steam appId fallback (legacy Steam-only records)
 *
 * Cross-provider duplicates are NEVER merged. Each provider copy is a
 * separate LibraryGame. linkedSteamAppId and linkedIgdbId are metadata
 * links only, never identity.
 *
 * Dedupe policy:
 *   - Within same provider: dedupe by provider-local identity
 *   - Across providers: never dedupe, preserve separate cards
 *
 * Phase 0 — foundation only. No runtime behavior changes.
 */

type MinimalGame = {
  id: string;
  appId?: string;
  libraryId?: string;
  providerId?: string;
  providerGameId?: string;
  source?: string;
};

/**
 * Return the canonical provider-neutral identity for a LibraryGame.
 *
 * This is the single source of truth for cross-provider identity resolution.
 * Use this instead of ad-hoc `game.appId || game.id` patterns.
 *
 * Deterministic: same inputs always produce the same output.
 * Pure: no mutation, no side effects, no randomness.
 *
 * Priority:
 *   1. libraryId  — "steam-480", "manual:<uuid>", "epic:<providerGameId>", "gog:<productId>"
 *   2. providerId + providerGameId — "epic:<providerGameId>", "gog:<productId>" (when libraryId missing)
 *   3. id — "steam-480", "manual:<uuid>" (legacy records)
 *   4. appId — "480" (legacy Steam-only records without libraryId)
 *
 * The caller must NOT use this result for:
 *   - cross-provider deduplication
 *   - linking games across providers
 *   - matching via title or metadata
 */
export function getProviderNeutralId(game: MinimalGame): string {
  // Priority 1: explicit libraryId (set by builder functions)
  if (game.libraryId) return game.libraryId;

  // Priority 2: providerId + providerGameId (canonical external provider identity)
  if (game.providerId && game.providerGameId) {
    return `${game.providerId}:${game.providerGameId}`;
  }

  // Priority 3: game.id (legacy or already-computed identity)
  if (game.id) return game.id;

  // Priority 4: Steam appId fallback (legacy Steam records)
  if (game.appId) return `steam:${game.appId}`;

  // Should never happen for valid LibraryGame, but safe fallback
  return "unknown:undefined";
}

/**
 * Return the dedupe key for within-provider identity resolution.
 * Same provider + same providerGameId = same game = dedupe.
 * Different providers = different games = never dedupe.
 *
 * Returns null when the game lacks sufficient identity fields.
 */
export function getProviderDedupeKey(game: MinimalGame): string | null {
  if (game.providerId && game.providerGameId) {
    return `${game.providerId}:${game.providerGameId}`;
  }
  if (game.libraryId) return game.libraryId;
  if (game.appId) return `steam:${game.appId}`;
  return game.id || null;
}

/**
 * Check whether two LibraryGame entries represent the same provider-local game.
 * Returns false for cross-provider copies (same title, different providers).
 */
export function isSameProviderGame(
  a: MinimalGame,
  b: MinimalGame,
): boolean {
  const keyA = getProviderDedupeKey(a);
  const keyB = getProviderDedupeKey(b);
  if (!keyA || !keyB) return false;
  return keyA === keyB;
}
