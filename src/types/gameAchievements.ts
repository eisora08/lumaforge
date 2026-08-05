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
};

export type UnlockEvent = {
  apiName: string;
  name: string;
  iconUrl?: string;
  iconGrayUrl?: string;
  unlockTime?: number;
  rarityPercent?: number;
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
    | "global-percentages"
    | "setup-required"
    | "disabled"
    | "unavailable"
    | "librarycache"
    | "librarycache-stale"
    | "steam-web-api-stale"
    | "steam-appcache-stale"
    | "local-cache-stale"
    | "non-steam-goldberg"
    | "non-steam-codex"
    | "non-steam-onlinefix"
    | "non-steam-generated";
  errorReason?: string;
  updatedAt?: number;
  newlyUnlocked?: UnlockEvent[];
};
