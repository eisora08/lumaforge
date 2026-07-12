import type React from "react";
import {
  BookOpen,
  Gamepad2,
  Trophy,
  Flame,
  Compass,
  Timer,
  Gem,
  Crown,
  Sparkles,
} from "lucide-react";

export type AchievementCategory =
  | "library"
  | "play"
  | "completion"
  | "streak"
  | "exploration"
  | "session";

export type AchievementRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary";

export type AchievementDef = {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  rarity: AchievementRarity;
  xp: number;
  icon: React.ComponentType<{ className?: string }>;
  hidden?: boolean;
};

export type AchievementUnlock = {
  achievementId: string;
  unlockedAt: number;
  xpAwarded: number;
};

export type PlayerXpEvent = {
  id: string;
  source: "achievement" | "activity" | "streak";
  amount: number;
  timestamp: number;
  label: string;
  refId?: string;
};

export type PlayerProfile = {
  totalXp: number;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
  unlockedCount: number;
  totalCount: number;
  xpAvailable: number;
};

export type AchievementWithState = AchievementDef & {
  unlocked: boolean;
  unlockedAt?: number;
  xpAwarded?: number;
};

export type StatsTimeFilter = "week" | "month" | "30days" | "year" | "all";

export type PlayActivityDay = {
  date: string;
  seconds: number;
  launches: number;
};

export type SessionHistoryEntry = {
  gameTitle: string;
  appId?: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
};

export const RARITY_COLORS: Record<AchievementRarity, { bg: string; text: string; border: string; glow: string }> = {
  common:    { bg: "bg-slate-500/15", text: "text-slate-300", border: "border-slate-500/25", glow: "" },
  uncommon:  { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/25", glow: "" },
  rare:      { bg: "bg-cyan-500/15", text: "text-cyan-400", border: "border-cyan-500/25", glow: "" },
  epic:      { bg: "bg-purple-500/15", text: "text-purple-400", border: "border-purple-500/25", glow: "shadow-purple-500/10" },
  legendary: { bg: "bg-amber-400/15", text: "text-amber-300", border: "border-amber-400/30", glow: "shadow-amber-400/15" },
};

export const RARITY_ACCENT_BAR: Record<AchievementRarity, string> = {
  common:    "bg-slate-400",
  uncommon:  "bg-emerald-400",
  rare:      "bg-cyan-400",
  epic:      "bg-purple-400",
  legendary: "bg-amber-400",
};

export const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  library: "Library",
  play: "Play",
  completion: "Completion",
  streak: "Streak",
  exploration: "Exploration",
  session: "Session",
};

export const CATEGORY_ICONS: Record<AchievementCategory, React.ComponentType<{ className?: string }>> = {
  library: BookOpen,
  play: Gamepad2,
  completion: Trophy,
  streak: Flame,
  exploration: Compass,
  session: Timer,
};

export const RARITY_ICONS: Record<AchievementRarity, React.ComponentType<{ className?: string }>> = {
  common: Sparkles,
  uncommon: Sparkles,
  rare: Gem,
  epic: Crown,
  legendary: Trophy,
};
