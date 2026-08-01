import { useMemo, useState, useEffect } from "react";
import { Award, Search, CheckCircle2, Lock, Sparkles, Zap, Trophy } from "lucide-react";
import { useLibraryGames } from "../context/LibraryGamesContext";
import { ACHIEVEMENT_DEFINITIONS } from "../features/activity/achievements/achievementDefinitions";
import {
  getPlayerProfile,
  getCategoryProgress,
  getUnlockedIds,
  getUnlocks,
  subscribeAchievementStore,
} from "../features/activity/achievements/achievementStore";
import { evaluateAchievements } from "../features/activity/achievements/achievementEngine";
import { buildEvalContext } from "../features/activity/stats/statsService";
import type {
  AchievementCategory,
  AchievementRarity,
  AchievementWithState,
  PlayerProfile,
} from "../features/activity/types";
import { RARITY_COLORS, RARITY_ICONS, CATEGORY_ICONS } from "../features/activity/types";
import ActivityEmptyState from "../components/activity/ActivityEmptyState";
import AchievementDetailModal from "../components/activity/AchievementDetailModal";
import LevelRing from "../components/activity/LevelRing";
import GrowBar from "../components/common/GrowBar";
import type { EvaluationContextInput } from "../features/activity/stats/statsService";

const CATEGORIES: Array<{ value: AchievementCategory | "all"; label: string; icon?: React.ComponentType<{ className?: string }> }> = [
  { value: "all", label: "All" },
  { value: "library", label: "Library", icon: CATEGORY_ICONS.library },
  { value: "play", label: "Play", icon: CATEGORY_ICONS.play },
  { value: "completion", label: "Completion", icon: CATEGORY_ICONS.completion },
  { value: "streak", label: "Streak", icon: CATEGORY_ICONS.streak },
  { value: "exploration", label: "Exploration", icon: CATEGORY_ICONS.exploration },
  { value: "session", label: "Session", icon: CATEGORY_ICONS.session },
];

const RARITIES: Array<{ value: AchievementRarity | "all"; label: string; dot: string }> = [
  { value: "all", label: "All Rarities", dot: "bg-white/30" },
  { value: "common", label: "Common", dot: "bg-slate-400" },
  { value: "uncommon", label: "Uncommon", dot: "bg-emerald-400" },
  { value: "rare", label: "Rare", dot: "bg-cyan-400" },
  { value: "epic", label: "Epic", dot: "bg-purple-400" },
  { value: "legendary", label: "Legendary", dot: "bg-amber-400" },
];

const STATES = [
  { value: "all" as const, label: "All" },
  { value: "unlocked" as const, label: "Unlocked" },
  { value: "locked" as const, label: "Locked" },
];

const RARITY_ACCENT_BAR: Record<AchievementRarity, string> = {
  common:    "bg-slate-400",
  uncommon:  "bg-emerald-400",
  rare:      "bg-cyan-400",
  epic:      "bg-purple-400",
  legendary: "bg-amber-400",
};

type ProgressInfo = { current: number; target: number; label: string } | null;

function getAchievementProgress(id: string, ctx: EvaluationContextInput): ProgressInfo {
  switch (id) {
    // Library
    case "starter-collection":  return { current: ctx.librarySize, target: 10, label: "Games in library" };
    case "collector":           return { current: ctx.librarySize, target: 50, label: "Games in library" };
    case "hoarder":             return { current: ctx.librarySize, target: 200, label: "Games in library" };
    case "archivist":           return { current: ctx.librarySize, target: 500, label: "Games in library" };
    // Play
    case "first-launch":        return { current: ctx.totalSessions, target: 1, label: "Play sessions" };
    case "marathon-runner":     return { current: ctx.marathonSessions, target: 5, label: "Marathon sessions (4h+)" };
    case "session-master":      return { current: ctx.totalSessions, target: 500, label: "Play sessions" };
    case "night-owl":           return { current: ctx.nightOwlSessions, target: 10, label: "Sessions after midnight" };
    case "early-bird":          return { current: ctx.earlyBirdSessions, target: 10, label: "Sessions before 7 AM" };
    // Completion
    case "finisher":            return { current: ctx.completedGames, target: 1, label: "Games completed" };
    case "closer":              return { current: ctx.completedGames, target: 5, label: "Games completed" };
    case "backlog-slayer":      return { current: ctx.completedGames, target: 10, label: "Games completed" };
    case "completionist":       return { current: ctx.completedGames, target: 25, label: "Games completed" };
    // Streak
    case "week-warrior":        return { current: Math.max(ctx.currentStreak, ctx.longestStreak), target: 7, label: "Day play streak" };
    case "fortnight-fighter":   return { current: Math.max(ctx.currentStreak, ctx.longestStreak), target: 14, label: "Day play streak" };
    case "monthly-dedication":  return { current: Math.max(ctx.currentStreak, ctx.longestStreak), target: 30, label: "Day play streak" };
    case "quarterly-commitment":return { current: Math.max(ctx.currentStreak, ctx.longestStreak), target: 90, label: "Day play streak" };
    case "year-of-gaming":      return { current: Math.max(ctx.currentStreak, ctx.longestStreak), target: 365, label: "Day play streak" };
    // Exploration
    case "genre-hopper":        return { current: ctx.genreCount, target: 5, label: "Genres played" };
    case "renaissance-gamer":   return { current: ctx.genreCount, target: 10, label: "Genres played" };
    case "hidden-gem-hunter":   return null;
    // Session
    case "session-centurion":   return { current: ctx.totalSessions, target: 100, label: "Play sessions" };
    case "weekend-warrior":     return { current: ctx.weekendStreak, target: 4, label: "Consecutive weekends played" };
    default: return null;
  }
}

function formatXpNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

function formatUnlockDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}

function PanelCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-(--color-border)/15 bg-(--color-surface) p-5 ${className}`}>
      {children}
    </div>
  );
}

export default function LauncherAchievements() {
  const { games } = useLibraryGames();
  const [profile, setProfile] = useState<PlayerProfile>(getPlayerProfile);
  const [unlockedIds, setUnlockedIds] = useState<ReadonlySet<string>>(getUnlockedIds);
  const [catFilter, setCatFilter] = useState<AchievementCategory | "all">("all");
  const [rarityFilter, setRarityFilter] = useState<AchievementRarity | "all">("all");
  const [stateFilter, setStateFilter] = useState<"all" | "unlocked" | "locked">("all");
  const [search, setSearch] = useState("");
  const [selectedAch, setSelectedAch] = useState<AchievementWithState | null>(null);

  useEffect(() => {
    return subscribeAchievementStore(() => {
      setProfile(getPlayerProfile());
      setUnlockedIds(getUnlockedIds());
    });
  }, []);

  useEffect(() => {
    if (games.length === 0) return;
    const ctx = buildEvalContext(games);
    evaluateAchievements(ctx);
  }, [games]);

  const achievements = useMemo<AchievementWithState[]>(() => {
    const unlocks = getUnlocks();
    const unlockMap = new Map(unlocks.map((u) => [u.achievementId, u.unlockedAt]));
    return ACHIEVEMENT_DEFINITIONS.map((def) => ({
      ...def,
      unlocked: unlockedIds.has(def.id),
      unlockedAt: unlockMap.get(def.id),
      xpAwarded: unlockedIds.has(def.id) ? def.xp : undefined,
    }));
  }, [unlockedIds]);

  const filtered = useMemo(() => {
    return achievements.filter((a) => {
      if (catFilter !== "all" && a.category !== catFilter) return false;
      if (rarityFilter !== "all" && a.rarity !== rarityFilter) return false;
      if (stateFilter === "unlocked" && !a.unlocked) return false;
      if (stateFilter === "locked" && a.unlocked) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!a.title.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [achievements, catFilter, rarityFilter, stateFilter, search]);

  const catProgress = useMemo(() => {
    const map: Record<string, { unlocked: number; total: number }> = {};
    for (const cat of CATEGORIES.filter((c) => c.value !== "all")) {
      map[cat.value] = getCategoryProgress(cat.value);
    }
    return map;
  }, [unlockedIds]);

  const completionPercent = profile.totalCount > 0 ? Math.round((profile.unlockedCount / profile.totalCount) * 100) : 0;

  const evalCtx = useMemo(() => {
    if (games.length === 0) return null;
    return buildEvalContext(games);
  }, [games]);

  const selectedProgress = useMemo<ProgressInfo>(() => {
    if (!selectedAch || !evalCtx) return null;
    return getAchievementProgress(selectedAch.id, evalCtx);
  }, [selectedAch, evalCtx]);

  return (
    <div className="w-full px-6 lg:px-8 xl:px-10 py-6 lf-page-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/10 border border-amber-400/20">
            <Award className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-(--color-text)">Launcher Achievements</h1>
            <p className="text-sm text-(--color-muted)">Track your milestones and earn XP</p>
          </div>
        </div>
      </div>

      {/* Stats + XP bar row */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Level & XP — large featured card */}
        <PanelCard className="lg:col-span-2 border-amber-400/15">
          <div className="flex items-center gap-6">
            {/* Level circle */}
            <LevelRing percent={profile.progressPercent} level={profile.level} svgClassName="h-28 w-28" levelClassName="text-3xl" labelClassName="text-[9px]" />

            {/* XP details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs text-(--color-muted) mb-1.5">
                <span>{profile.currentLevelXp} / {profile.nextLevelXp} XP</span>
                <span>{Math.round(profile.progressPercent)}%</span>
              </div>
              <GrowBar
                percent={profile.progressPercent}
                minPercent={2}
                trackClassName="h-2.5 rounded-full bg-white/[0.06]"
                fillClassName="bg-linear-to-r from-amber-500 to-amber-400"
              />
              <div className="mt-3 flex items-center gap-5 text-xs text-(--color-muted)">
                <span className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-400/60" />
                  {formatXpNumber(profile.totalXp)} XP
                </span>
                <span className="flex items-center gap-1.5">
                  <Trophy className="h-3.5 w-3.5 text-amber-400/60" />
                  {profile.unlockedCount}/{profile.totalCount}
                </span>
              </div>
            </div>
          </div>
        </PanelCard>

        {/* Completion stat */}
        <PanelCard>
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl font-bold text-(--color-text)">{completionPercent}%</div>
            <div className="text-[10px] uppercase tracking-wider text-(--color-muted)/60 mt-1">Completion</div>
            <div className="mt-3 w-full">
              <GrowBar
                percent={completionPercent}
                trackClassName="h-2 rounded-full bg-white/[0.06]"
                fillClassName="bg-linear-to-r from-(--color-accent) to-(--color-accent)/70"
              />
            </div>
            <div className="mt-2 text-[11px] text-(--color-muted)">{profile.unlockedCount} of {profile.totalCount} unlocked</div>
          </div>
        </PanelCard>
      </div>

      {/* Category progress */}
      <div className="mt-5 grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-6 gap-2">
        {CATEGORIES.filter((c) => c.value !== "all").map((cat) => {
          const p = catProgress[cat.value] ?? { unlocked: 0, total: 0 };
          const pct = p.total > 0 ? Math.round((p.unlocked / p.total) * 100) : 0;
          const CatIcon = cat.icon;
          return (
            <button
              key={cat.value}
              onClick={() => setCatFilter(catFilter === cat.value ? "all" : cat.value)}
              className={`rounded-xl border px-3 py-2.5 text-center transition ${
                catFilter === cat.value
                  ? "border-(--color-accent)/40 bg-(--color-accent)/8"
                  : "border-(--color-border)/15 bg-(--color-surface) hover:border-(--color-border)/30"
              }`}
            >
              {CatIcon && <CatIcon className="h-4 w-4 mx-auto mb-0.5 text-(--color-muted)/60" />}
              <div className="text-xs font-semibold text-(--color-text)">{cat.label}</div>
              <div className="mt-0.5 text-[10px] text-(--color-muted)">{p.unlocked}/{p.total}</div>
              <div className="mt-1">
                <GrowBar
                  percent={pct}
                  trackClassName="h-1 rounded-full bg-white/[0.06]"
                  fillClassName="bg-(--color-accent)/50"
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-(--color-muted)/50" />
          <input
            type="text"
            placeholder="Search achievements..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-(--color-border)/30 bg-(--color-surface) pl-9 pr-3 py-2.5 text-sm text-(--color-text) placeholder:text-(--color-muted)/40 focus:border-(--color-accent)/50 focus:outline-none"
          />
        </div>

        <select
          value={rarityFilter}
          onChange={(e) => setRarityFilter(e.target.value as AchievementRarity | "all")}
          className="rounded-xl border border-(--color-border)/30 bg-(--color-surface) px-3 py-2.5 text-sm text-(--color-text) focus:border-(--color-accent)/50 focus:outline-none"
        >
          {RARITIES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        <div className="flex rounded-xl border border-(--color-border)/30 overflow-hidden">
          {STATES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStateFilter(s.value)}
              className={`px-3 py-2 text-xs font-medium transition ${
                stateFilter === s.value
                  ? "bg-(--color-accent)/15 text-(--color-accent)"
                  : "text-(--color-muted) hover:text-(--color-text)"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Achievement grid */}
      <div className="mt-5 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {filtered.map((ach) => (
          <AchievementCard
            key={ach.id}
            achievement={ach}
            onClick={() => setSelectedAch(ach)}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="mt-8">
          <ActivityEmptyState
            icon={Sparkles}
            title="No achievements match your filters"
            description="Try adjusting your search or filters to find what you're looking for."
          />
        </div>
      )}

      <AchievementDetailModal
        open={selectedAch !== null}
        achievement={selectedAch}
        progress={selectedProgress}
        onClose={() => setSelectedAch(null)}
      />
    </div>
  );
}

function AchievementCard({ achievement, onClick }: { achievement: AchievementWithState; onClick: () => void }) {
  const rarity = RARITY_COLORS[achievement.rarity];
  const isLocked = !achievement.unlocked;
  const AchIcon = achievement.icon;
  const RarityIcon = RARITY_ICONS[achievement.rarity];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border text-left transition-all duration-200 focus-visible:ring-2 focus-visible:ring-(--color-accent)/50 ${
        isLocked
          ? "border-(--color-border)/10 bg-(--color-surface)/80 hover:bg-(--color-surface) hover:border-(--color-border)/20"
          : `bg-(--color-surface) hover:brightness-110 ${rarity.border}`
      } ${rarity.glow ? `shadow-md ${rarity.glow}` : "shadow-sm"} hover:shadow-lg hover:scale-[1.01]`}
    >
      {/* Rarity accent bar at top for unlocked */}
      {!isLocked && (
        <div className={`absolute inset-x-0 top-0 h-0.5 ${RARITY_ACCENT_BAR[achievement.rarity]}`} />
      )}

      <div className="flex items-start gap-3 p-4">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition ${
            isLocked
              ? "bg-white/[0.04] text-(--color-muted)/30"
              : `${rarity.bg} border ${rarity.border}`
          }`}
        >
          {isLocked ? (
            <Lock className="h-4.5 w-4.5 text-(--color-muted)/40" />
          ) : (
            <AchIcon className={`h-5 w-5 ${rarity.text}`} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className={`text-sm font-semibold leading-5 ${isLocked ? "text-(--color-text)/50" : "text-(--color-text)"}`}>
              {achievement.title}
            </h3>
            {!isLocked && (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            )}
          </div>
          <p className={`mt-0.5 text-xs leading-relaxed ${isLocked ? "text-(--color-muted)/40" : "text-(--color-muted)"}`}>
            {achievement.hidden && isLocked ? "???" : achievement.description}
          </p>

          <div className="mt-2 flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${rarity.bg} ${rarity.text}`}>
              <RarityIcon className="h-2.5 w-2.5" />
              {achievement.rarity}
            </span>
            <span className="text-[10px] font-bold text-amber-400/80">
              +{achievement.xp} XP
            </span>
          </div>

          {achievement.unlocked && achievement.unlockedAt && (
            <div className="mt-1.5 text-[10px] text-(--color-muted)/40">
              Unlocked {formatUnlockDate(achievement.unlockedAt)}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
