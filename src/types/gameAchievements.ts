export type GameAchievement = {
  id: string;
  apiName: string;
  name: string;
  description?: string;
  iconUrl?: string;
  iconGrayUrl?: string;
  unlocked: boolean;
  unlockTime?: number;
  rarityPercent?: number;
  statId?: number;
  bit?: number;
  /** Schema metadata for progress tracking (carried through for cache round-trip) */
  progressStatId?: number;
  progressMin?: number;
  progressMax?: number;
  /** Runtime progress values (computed from binary stats) */
  progress?: number;
  maxProgress?: number;
};

export type UnlockEvent = {
  apiName: string;
  name: string;
  description?: string;
  iconUrl?: string;
  iconGrayUrl?: string;
  unlockTime?: number;
  rarityPercent?: number;
  /** True when this unlock completes 100% of the game (platinum trophy). */
  isPlatinum?: boolean;
};

export type GameAchievementsSummary = {
  appId: string;
  total: number;
  unlocked?: number;
  percent?: number;
  progressAvailable: boolean;
  achievements: GameAchievement[];
  source:
    | "steam-web-api"
    | "local-cache"
    | "steam-appcache"
    | "schema-only"
    | "schema-generated"
    | "binary-stats"
    | "global-percentages"
    | "setup-required"
    | "disabled"
    | "unavailable"
    | "librarycache"
    | "librarycache-stale"
    | "steam-web-api-stale"
    | "steam-appcache-stale"
    | "local-cache-stale"
    | "crack";
  errorReason?: string;
  updatedAt?: number;
  newlyUnlocked?: UnlockEvent[];
};
