/**
 * games_v2 — unified game table (migration v5+).
 *
 * Single source of truth for all game types: Steam, Manual, Epic, Debrid, GOG, Lua, Local, Emulator.
 * Identity format: "steam-480", "manual:<uuid>", "epic:<ns>:<catId>:<appName>", "debrid:<repackId>", etc.
 */
export type GameV2 = {
  /** Unique identifier. Format varies by source. */
  id: string;
  title: string;
  /** Provider source: "steam" | "manual" | "epic" | "debrid" | "lua" | "gog" | "local" | "emulator" */
  source: string;
  /** Steam numeric app ID (nullable for non-Steam). */
  appId?: string;
  /** Raw provider game ID. */
  providerGameId?: string;
  /** Scoped library ID: "steam-480", "manual:<uuid>", etc. */
  libraryId?: string;

  // Installation
  isInstalled: boolean;
  installDir?: string;
  installSize?: number;
  exePath?: string;
  exeName?: string;
  workingDirectory?: string;
  launchArguments?: string;

  // Playtime (seconds)
  playtimeSeconds: number;
  playCount: number;
  lastPlayedAt?: number;

  // Media
  coverPath?: string;
  landscapePath?: string;
  backgroundPath?: string;
  logoPath?: string;
  iconPath?: string;

  // Metadata
  releaseDate?: string;
  description?: string;
  shortDescription?: string;
  /** JSON array — temporal, migrate to junction table later. */
  genres?: string;
  /** JSON array — temporal. */
  developers?: string;
  /** JSON array — temporal. */
  publishers?: string;
  /** JSON array — temporal. */
  categories?: string;
  /** JSON array — temporal. */
  features?: string;
  /** JSON array — temporal. */
  tags?: string;

  // Scores
  userScore?: string;
  criticScore?: string;
  communityScore?: string;
  reviewSummary?: string;
  reviewCount?: string;

  // Links (cross-provider)
  linkedAppId?: string;
  linkedIgdbId?: string;

  // State
  isFavorite: boolean;
  isHidden: boolean;
  standalone: boolean;
  sortingName?: string;

  // Series / Rating
  series?: string;
  ageRating?: string;
  region?: string;
  completionStatus?: string;

  // Lua overlay
  hasLua: boolean;

  // Provider-specific overrides (JSON blob)
  providerMetadata?: string;

  createdAt: number;
  updatedAt: number;
};

/** Source type for filtering. */
export type GameV2Source =
  | "steam"
  | "manual"
  | "epic"
  | "debrid"
  | "lua"
  | "gog"
  | "local"
  | "emulator";
