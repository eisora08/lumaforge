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
    | "unavailable";
  errorReason?: string;
  updatedAt?: number;
};
