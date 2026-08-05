/** Source type for non-Steam achievement detection. */
export type NonSteamSource =
  | "goldberg"
  | "codex"
  | "onlinefix"
  | "manual";

/** Per-game configuration for non-Steam achievement tracking. */
export type NonSteamAchievementConfig = {
  /** Steam AppID used for schema lookup (required for most sources). */
  appId: number;
  /** Display name (from game metadata or user input). */
  name: string;
  /** Absolute path to the game's root directory (contains steam_settings/ or achievements.ini). */
  gameDir: string;
  /** Detection source — "auto" means detect from gameDir. */
  source: NonSteamSource | "auto";
  /** Whether this config is active. */
  enabled: boolean;
  /** Timestamp of last successful detection. */
  updatedAt?: number;
  /** Directory where achievement unlock state files are stored (e.g. GSE Saves path). */
  savePath?: string;
  /** Platform identifier for the reference tool config (e.g. "goldberg", "codex", "onlinefix"). */
  platform?: string;
};

/** Result of auto-detection from a game directory. */
export type NonSteamDetectionResult = {
  /** Whether achievement data was found. */
  hasAchievements: boolean;
  /** Which source was detected. */
  source: NonSteamSource | null;
  /** The AppID used (from config, steam_appid.txt, or user input). */
  appId: number | null;
  /** Number of achievements found in the schema/data. */
  achievementCount: number;
  /** Human-readable message about the detection. */
  message: string;
};

/** Normalized achievement data from a non-Steam source. */
export type NonSteamAchievementData = {
  /** Achievement API name (matches Steam schema). */
  apiName: string;
  /** Display name. */
  displayName: string;
  /** Description. */
  description: string;
  /** Whether the achievement is unlocked. */
  unlocked: boolean;
  /** Unlock timestamp (epoch seconds). */
  unlockTime?: number;
  /** Icon filename (CRC32-based for CODEX). */
  icon?: string;
  /** Gray icon filename. */
  iconGray?: string;
  /** Whether the achievement is hidden. */
  hidden: boolean;
};

/** Detection source priority order for auto-detect. */
export const DETECTION_ORDER: NonSteamSource[] = [
  "goldberg",
  "codex",
  "onlinefix",
];

/** Human-readable labels for each source. */
export const SOURCE_LABELS: Record<NonSteamSource, string> = {
  goldberg: "Goldberg Steam Emulator",
  codex: "CODEX / RUNE",
  onlinefix: "OnlineFix",
  manual: "Manual",
};
