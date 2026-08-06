/**
 * Unified Steam genre/category taxonomy.
 *
 * This file is the single source of truth for:
 * - Official Steam genre normalization (canonical values + aliases)
 * - Steam category identification (NOT genres)
 * - Genre filtering predicates
 *
 * Used by both the offline builder and the runtime query service.
 */

// ── Official Steam Store Genres (canonical) ──
// These are the 10 genres recognized by the Steam Store appdetails API.
export const CANONICAL_GENRES = [
  "Action",
  "Adventure",
  "RPG",
  "Strategy",
  "Simulation",
  "Sports",
  "Racing",
  "Indie",
  "Casual",
  "Massively Multiplayer",
] as const;

export type CanonicalGenre = (typeof CANONICAL_GENRES)[number];

// ── Genre Aliases ──
// Maps normalized lowercase aliases → canonical genre name.
const GENRE_ALIASES: Record<string, CanonicalGenre> = {
  // Action
  "action": "Action",

  // Adventure
  "adventure": "Adventure",
  "action-adventure": "Action", // Steam compound: route to Action (primary)
  "adventure-game": "Adventure",

  // RPG
  "rpg": "RPG",
  "role-playing": "RPG",
  "role playing": "RPG",
  "roleplaying": "RPG",
  "role playing game": "RPG",

  // Strategy
  "strategy": "Strategy",

  // Simulation
  "simulation": "Simulation",
  "sim": "Simulation",

  // Sports
  "sports": "Sports",

  // Racing
  "racing": "Racing",
  "race": "Racing",

  // Indie
  "indie": "Indie",

  // Casual
  "casual": "Casual",

  // Massively Multiplayer
  "massively multiplayer": "Massively Multiplayer",
  "mmo": "Massively Multiplayer",
  "mmorpg": "Massively Multiplayer",
  "massively multiplayers": "Massively Multiplayer",
};

// ── Steam Categories (NOT genres) ──
// These are the numeric category IDs from the Steam appdetails API.
// They MUST NOT be used to populate genre rails.
export const STEAM_CATEGORY_IDS: Record<number, string> = {
  1: "Single-player",
  2: "Multiplayer",
  7: "Co-op",
  8: "Steam Achievements",
  9: "Steam Cloud",
  13: "Controller Support",
  15: "Remote Play",
  16: "Workshop",
  17: "Trading Cards",
  18: "In-App Purchases",
  20: "MMO",
  21: "Shared/Split Screen",
  22: "Steam Turn Notifications",
  23: "VR Support",
  24: "SteamVR Collectibles",
  25: "Commentary Available",
  26: "Full Controller Support",
  27: "Partial Controller Support",
  28: "Captions Available",
  29: "Steam Workshop",
  30: "Steam Deck Playable",
  31: "Steam Deck Verified",
  32: "Steam Deck Unsupported",
  35: "Remote Play Together",
  36: "Online Multi-Player",
  37: "Local Multi-Player",
  38: "LAN Multi-Player",
  39: "Online Co-Op",
  40: "Local Co-Op",
  41: "LAN Co-Op",
};

// ── Normalization ──

/**
 * Normalize a raw Steam genre string to a canonical genre name.
 *
 * Returns `null` for unknown genres. Unknown genres are NOT mapped
 * to Action or Adventure as a default.
 *
 * @example
 * normalizeGenreName("Role-Playing")  → "RPG"
 * normalizeGenreName("Action")        → "Action"
 * normalizeGenreName("Sandbox")       → null
 */
export function normalizeGenreName(raw: string): CanonicalGenre | null {
  const cleaned = raw.trim().toLowerCase();

  // 1. Exact match on cleaned string
  const exact = GENRE_ALIASES[cleaned];
  if (exact) return exact;

  // 2. Prefix match (e.g. "Action-Adventure" → "Action")
  for (const [alias, canonical] of Object.entries(GENRE_ALIASES)) {
    if (cleaned.startsWith(alias + " ") || cleaned.startsWith(alias + "-")) {
      return canonical;
    }
  }

  // 3. Suffix match (e.g. "Action Game" → "Action")
  for (const [alias, canonical] of Object.entries(GENRE_ALIASES)) {
    if (cleaned.endsWith(" " + alias)) {
      return canonical;
    }
  }

  // 4. Contains match (e.g. "Action RPG" → "Action")
  for (const [alias, canonical] of Object.entries(GENRE_ALIASES)) {
    if (cleaned.includes(" " + alias + " ")) {
      return canonical;
    }
  }

  // 5. Token-level match — split on whitespace, check each token
  const tokens = cleaned.split(/\s+/);
  for (const token of tokens) {
    const match = GENRE_ALIASES[token];
    if (match) return match;
  }

  // Unknown genre — explicit policy: return null (not in canonical rails)
  return null;
}

/**
 * Normalize an array of raw Steam genre strings.
 * Returns unique canonical genres in the order they first appear.
 * Unknown genres are preserved in `originalGenres` but not in the canonical list.
 */
export function normalizeGenres(rawGenres: string[]): {
  genres: CanonicalGenre[];
  originalGenres: string[];
} {
  const seen = new Set<CanonicalGenre>();
  const genres: CanonicalGenre[] = [];
  const originalGenres: string[] = [];

  for (const raw of rawGenres) {
    const canonical = normalizeGenreName(raw);
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      genres.push(canonical);
    }
    // Always preserve original for diagnostics
    if (raw.trim() && !originalGenres.includes(raw.trim())) {
      originalGenres.push(raw.trim());
    }
  }

  return { genres, originalGenres };
}

/**
 * Check if a value is a Steam category (not a genre).
 * Categories must never populate genre rails.
 */
export function isSteamCategory(categoryId: number): boolean {
  return categoryId in STEAM_CATEGORY_IDS;
}

/**
 * Check if a genre array contains at least one canonical genre
 * (as opposed to being only categories mislabeled as genres).
 */
export function hasCanonicalGenre(genres: string[]): boolean {
  return genres.some((g) => normalizeGenreName(g) !== null);
}

// ── Display mapping for Store UI ──

// Genre section rails (genre-action, genre-rpg, etc.) are deprecated.
// Genres are now served by a single "Browse by Genre" mosaic section.

