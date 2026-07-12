import { ACHIEVEMENT_DEFINITIONS } from "./achievementDefinitions";
import { isUnlocked, unlockAchievement } from "./achievementStore";
import type { AchievementDef } from "../types";

const DEBUG_ACH_ENGINE = false;

type EvaluationContext = {
  librarySize: number;
  totalPlaytimeSeconds: number;
  totalSessions: number;
  completedGames: number;
  currentStreak: number;
  longestStreak: number;
  marathonSessions: number;
  nightOwlSessions: number;
  earlyBirdSessions: number;
  genreCount: number;
  weekendStreak: number;
  gamesPlayed: number;
};

type EvaluateResult = {
  newlyUnlocked: AchievementDef[];
  totalEvaluated: number;
};

let _lastEvalHash = "";

function computeEvalHash(ctx: EvaluationContext): string {
  return `${ctx.librarySize}-${ctx.totalPlaytimeSeconds}-${ctx.totalSessions}-${ctx.completedGames}-${ctx.currentStreak}-${ctx.genreCount}`;
}

/**
 * Evaluate all achievements against current stats.
 * Deterministic and idempotent — only awards XP once per achievement.
 * Hash-gated — identical context never re-evaluates.
 */
export function evaluateAchievements(ctx: EvaluationContext): EvaluateResult {
  const hash = computeEvalHash(ctx);
  if (hash === _lastEvalHash) {
    if (DEBUG_ACH_ENGINE) console.log(`[LF_ACH][SKIP_DUPLICATE_HASH] hash=${hash}`);
    return { newlyUnlocked: [], totalEvaluated: 0 };
  }
  const prevHash = _lastEvalHash;
  _lastEvalHash = hash;

  if (DEBUG_ACH_ENGINE) console.log(`[LF_ACH][EVAL_START] prevHash=${prevHash} newHash=${hash}`);

  const newlyUnlocked: AchievementDef[] = [];

  for (const def of ACHIEVEMENT_DEFINITIONS) {
    if (isUnlocked(def.id)) {
      if (DEBUG_ACH_ENGINE) console.log(`[LF_ACH][SKIP_ALREADY_UNLOCKED] id=${def.id}`);
      continue;
    }

    if (checkCondition(def, ctx)) {
      const ok = unlockAchievement(def.id);
      if (ok) {
        if (DEBUG_ACH_ENGINE) console.log(`[LF_ACH][UNLOCK] id=${def.id} title="${def.title}" xp=${def.xp}`);
        newlyUnlocked.push(def);
      }
    }
  }

  if (DEBUG_ACH_ENGINE) console.log(`[LF_ACH][EVAL_DONE] unlocked=${newlyUnlocked.length} total=${ACHIEVEMENT_DEFINITIONS.length}`);
  return { newlyUnlocked, totalEvaluated: ACHIEVEMENT_DEFINITIONS.length };
}

function checkCondition(def: AchievementDef, ctx: EvaluationContext): boolean {
  switch (def.id) {
    // Library
    case "starter-collection": return ctx.librarySize >= 10;
    case "collector":          return ctx.librarySize >= 50;
    case "hoarder":            return ctx.librarySize >= 200;
    case "archivist":          return ctx.librarySize >= 500;

    // Play
    case "first-launch":       return ctx.totalSessions >= 1;
    case "marathon-runner":    return ctx.marathonSessions >= 5;
    case "session-master":     return ctx.totalSessions >= 500;
    case "night-owl":          return ctx.nightOwlSessions >= 10;
    case "early-bird":         return ctx.earlyBirdSessions >= 10;

    // Completion
    case "finisher":           return ctx.completedGames >= 1;
    case "closer":             return ctx.completedGames >= 5;
    case "backlog-slayer":     return ctx.completedGames >= 10;
    case "completionist":      return ctx.completedGames >= 25;

    // Streak
    case "week-warrior":         return ctx.currentStreak >= 7 || ctx.longestStreak >= 7;
    case "fortnight-fighter":    return ctx.currentStreak >= 14 || ctx.longestStreak >= 14;
    case "monthly-dedication":   return ctx.currentStreak >= 30 || ctx.longestStreak >= 30;
    case "quarterly-commitment": return ctx.currentStreak >= 90 || ctx.longestStreak >= 90;
    case "year-of-gaming":       return ctx.currentStreak >= 365 || ctx.longestStreak >= 365;

    // Exploration
    case "genre-hopper":          return ctx.genreCount >= 5;
    case "renaissance-gamer":     return ctx.genreCount >= 10;
    case "hidden-gem-hunter":     return false; // TODO: requires per-game rating data

    // Session
    case "session-centurion":     return ctx.totalSessions >= 100;
    case "weekend-warrior":       return ctx.weekendStreak >= 4;

    default: return false;
  }
}
