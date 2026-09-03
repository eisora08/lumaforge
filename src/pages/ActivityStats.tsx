import { useMemo, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3, Clock, Gamepad2, Trophy, Flame, CalendarDays,
  TrendingUp, Zap, Swords, Timer, Award, Archive,
  BookOpen, Sun, Sunrise, Moon, Sunset,
} from "lucide-react";
import { useLibraryGames } from "../context/LibraryGamesContext";
import {
  computeLibraryStats,
  computePlayActivityByDay,
  computeStreaks,
  computeHeatmapData,
  computeTopGames,
  computeSessionHistory,
  computeFilteredPlaytime,
  getTotalLaunchCount,
  computeMasteryTiers,
  computeWeeklyComparison,
  computeAvgSessionLength,
  computeTimeOfDay,
} from "../features/activity/stats/statsService";
import type { LibraryStats, PlayActivityDay, StreakInfo, TopGame, SessionHistoryEntry, WeeklyComparison, TimeOfDayBucket, MasteryTierResult } from "../features/activity/stats/statsService";
import { getPlayerProfile, subscribeAchievementStore } from "../features/activity/achievements/achievementStore";
import { subscribePlaytimeStore, loadPlaytimeStore } from "../services/playtimeService";
import { resolveGameMediaUrl } from "../services/gameCacheService";
import { scanAchievementFolders, type FolderAchievementSummary } from "../services/tauri";
import type { PlayerProfile, StatsTimeFilter } from "../features/activity/types";
import type { LibraryGame } from "../types/libraryGame";
import ActivityFeed from "../components/activity/ActivityFeed";
import ActivityEmptyState from "../components/activity/ActivityEmptyState";
import LevelRing from "../components/activity/LevelRing";
import GrowBar from "../components/common/GrowBar";
import { useGrowOnMount } from "../hooks/useGrowOnMount";

const TIME_FILTERS: Array<{ value: StatsTimeFilter; labelKey: string }> = [
  { value: "today", labelKey: "activity_stats.today" },
  { value: "week", labelKey: "activity_stats.this_week" },
  { value: "month", labelKey: "activity_stats.this_month" },
  { value: "30days", labelKey: "activity_stats.last_30_days" },
  { value: "year", labelKey: "activity_stats.this_year" },
  { value: "all", labelKey: "activity_stats.all_time" },
];

const HEATMAP_COLORS = [
  "bg-white/[0.04]",
  "bg-emerald-900/50",
  "bg-emerald-700/60",
  "bg-emerald-500/70",
  "bg-emerald-400/90",
];

const SOURCE_BADGE_COLORS: Record<string, string> = {
  steam: "border-sky-500/20 bg-sky-500/10 text-sky-300",
  local: "border-slate-500/20 bg-slate-500/10 text-slate-300",
  lua: "border-purple-500/20 bg-purple-500/10 text-purple-300",
  system: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
  manual: "border-teal-500/20 bg-teal-500/10 text-teal-300",
  debrid: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
  epic: "border-indigo-500/20 bg-indigo-500/10 text-indigo-300",
};

const EXIT_REASON_LABELS: Record<string, string> = {
  normal: "activity_stats.clean_exit",
  stopped: "activity_stats.stopped",
  crashed: "activity_stats.crashed",
  "process-exited": "activity_stats.process_exited",
  unknown: "activity_stats.unknown",
};

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function PanelCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-(--color-border)/15 lf-surface p-5 ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({ children, icon: Icon }: { children: React.ReactNode; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="h-4 w-4 text-(--color-muted)/50" />
      <h3 className="text-sm font-semibold text-(--color-text)">{children}</h3>
    </div>
  );
}

export default function ActivityStats() {
  const { t } = useTranslation();
  const { games, initialLoading } = useLibraryGames();
  const [timeFilter, setTimeFilter] = useState<StatsTimeFilter>("today");
  const [profile, setProfile] = useState<PlayerProfile>(getPlayerProfile);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    return subscribeAchievementStore(() => setProfile(getPlayerProfile()));
  }, []);

  // Live refresh: recompute when playtime changes
  const bump = useCallback(() => setRefreshKey(n => n + 1), []);
  useEffect(() => {
    const unsub = subscribePlaytimeStore(bump);
    return () => unsub();
  }, [bump]);

  // Async state for computed stats
  const [stats, setStats] = useState<LibraryStats>({ totalHours: 0, totalSessions: 0, gamesPlayed: 0, gamesUnplayed: 0, mostPlayedTitle: "", mostPlayedHours: 0 });
  const [filteredPlaytime, setFilteredPlaytime] = useState<{ totalSeconds: number; gamesPlayed: number; sessions: SessionHistoryEntry[] }>({ totalSeconds: 0, gamesPlayed: 0, sessions: [] });
  const [activityByDay, setActivityByDay] = useState<PlayActivityDay[]>([]);
  const [streaks, setStreaks] = useState<StreakInfo>({ currentStreak: 0, longestStreak: 0, streakStarted: null, totalDaysPlayed: 0 });
  const [heatmapData, setHeatmapData] = useState<{ date: string; value: number }[]>([]);
  const [topGames, setTopGames] = useState<TopGame[]>([]);
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>([]);
  const [masteryTiers, setMasteryTiers] = useState<MasteryTierResult[]>([]);
  const [weeklyComparison, setWeeklyComparison] = useState<WeeklyComparison>({ thisWeekSeconds: 0, lastWeekSeconds: 0, percentChange: null });
  const [avgSessionLength, setAvgSessionLength] = useState<number | null>(null);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDayBucket[]>([]);

  // Recompute all async stats
  useEffect(() => {
    if (initialLoading || games.length === 0) return;
    let cancelled = false;
    async function recompute() {
      try {
        // Ensure the playtime store is loaded from games_v2 before computing stats
        await loadPlaytimeStore();
        const [s, fp, abd, st, ht, tg, sh, mt, wc, asl, tod] = await Promise.all([
          computeLibraryStats(games),
          computeFilteredPlaytime(games, timeFilter),
          computePlayActivityByDay(games, 90),
          computeStreaks(games),
          computeHeatmapData(games, 90),
          computeTopGames(games, 10),
          computeSessionHistory(games, 20),
          computeMasteryTiers(games),
          computeWeeklyComparison(games),
          computeAvgSessionLength(games),
          computeTimeOfDay(games),
        ]);
        if (!cancelled) {
          setStats(s);
          setFilteredPlaytime(fp);
          setActivityByDay(abd);
          setStreaks(st);
          setHeatmapData(ht);
          setTopGames(tg);
          setSessionHistory(sh);
          setMasteryTiers(mt);
          setWeeklyComparison(wc);
          setAvgSessionLength(asl);
          setTimeOfDay(tod);
        }
      } catch (err) {
        console.error("[ACTIVITY_STATS] recompute failed:", err);
      }
    }
    recompute();
    return () => { cancelled = true; };
  }, [games, timeFilter, refreshKey, initialLoading]);

  const totalLaunches = useMemo(() => getTotalLaunchCount(games), [games]);

  const maxDaySeconds = useMemo(() => Math.max(1, ...activityByDay.map((d) => d.seconds)), [activityByDay]);
  const hasAnyPlaytime = stats.totalHours > 0;

  return (
    <div className="w-full px-6 lg:px-8 xl:px-10 py-6 lf-page-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-(--color-accent)/10 border border-(--color-accent)/20">
            <BarChart3 className="h-5 w-5 text-(--color-accent)" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-(--color-text)">{t("activity_stats.title", "Activity & Stats")}</h1>
            <p className="text-sm text-(--color-muted)">{t("activity_stats.subtitle", "Your gaming activity at a glance")}</p>
          </div>
        </div>

        <div className="flex rounded-xl border border-(--color-border)/30 overflow-hidden">
          {TIME_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTimeFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-medium transition ${
                timeFilter === f.value
                  ? "bg-(--color-accent)/15 text-(--color-accent)"
                  : "text-(--color-muted) hover:text-(--color-text)"
              }`}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Top Stats — full width grid */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <StatCard icon={<Clock className="h-4 w-4" />} label={t("activity_stats.total_hours")} value={formatDuration(stats.totalHours * 3600)} accent />
        <StatCard icon={<Gamepad2 className="h-4 w-4" />} label={t("activity_stats.games_played")} value={`${stats.gamesPlayed}`} />
        <StatCard icon={<Archive className="h-4 w-4 text-(--color-muted)/40" />} label={t("activity_stats.unplayed")} value={`${stats.gamesUnplayed}`} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label={t("activity_stats.total_launches")} value={`${totalLaunches}`} />
        <StatCard icon={<Timer className="h-4 w-4" />} label={t("activity_stats.sessions")} value={`${stats.totalSessions}`} />
        {stats.mostPlayedTitle && (
          <StatCard icon={<Trophy className="h-4 w-4 text-amber-400" />} label={t("activity_stats.most_played")} value={stats.mostPlayedTitle} truncate />
        )}
        {weeklyComparison.percentChange !== null && (
          <StatCard
            icon={weeklyComparison.percentChange >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingUp className="h-4 w-4 rotate-180" />}
            label={t("activity_stats.vs_last_week")}
            value={`${weeklyComparison.percentChange >= 0 ? "+" : ""}${Math.round(weeklyComparison.percentChange)}%`}
            accent={weeklyComparison.percentChange >= 0}
          />
        )}
      </div>

      {/* Filtered playtime + Avg Session — 2-col */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PanelCard>
          <div className="text-[10px] uppercase tracking-wider text-(--color-muted)/60">
            {t("activity_stats.play_time")} ({t(TIME_FILTERS.find((f) => f.value === timeFilter)?.labelKey ?? "")})
          </div>
          <div className="mt-1 text-xl font-bold text-(--color-text)">{formatDuration(filteredPlaytime.totalSeconds)}</div>
          <div className="mt-1 text-[10px] text-(--color-muted)/50">{t("activity_stats.games_active", { count: filteredPlaytime.gamesPlayed })}</div>
        </PanelCard>
        <PanelCard>
          <div className="text-[10px] uppercase tracking-wider text-(--color-muted)/60">{t("activity_stats.avg_session")}</div>
          <div className="mt-1 text-xl font-bold text-(--color-text)">
            {avgSessionLength !== null ? formatDuration(avgSessionLength) : "—"}
          </div>
          <div className="mt-1 text-[10px] text-(--color-muted)/50">{t("activity_stats.per_session")}</div>
        </PanelCard>
      </div>

      {/* Play Activity Chart — full width */}
      <PanelCard className="mt-6">
        <SectionTitle icon={BarChart3}>{t("activity_stats.play_activity")}</SectionTitle>
        {!hasAnyPlaytime ? (
          <ActivityEmptyState
            icon={BarChart3}
            title={t("activity_stats.no_activity")}
            description={t("activity_stats.no_activity_desc")}
          />
        ) : (
          <>
            <PlayActivityBars activityByDay={activityByDay} maxDaySeconds={maxDaySeconds} />
            <div className="flex justify-between mt-2 text-[10px] text-(--color-muted)/50">
              <span>{formatDateShort(activityByDay[0]?.date ?? "")}</span>
              <span>{formatDateShort(activityByDay[activityByDay.length - 1]?.date ?? "")}</span>
            </div>
          </>
        )}
      </PanelCard>

      {/* 2-column: Streaks + XP & Level */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Streaks */}
        <PanelCard>
          <SectionTitle icon={Flame}>{t("activity_stats.streaks")}</SectionTitle>
          {!hasAnyPlaytime ? (
            <ActivityEmptyState
              icon={Flame}
              title={t("activity_stats.no_streaks")}
              description={t("activity_stats.no_streaks_desc")}
              compact
            />
          ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/10 mb-2">
                <Flame className="h-4 w-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-amber-400">{streaks.currentStreak}</div>
              <div className="text-[10px] uppercase tracking-wider text-(--color-muted)/60">{t("activity_stats.current")}</div>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-(--color-accent)/10 mb-2">
                <TrendingUp className="h-4 w-4 text-(--color-accent)" />
              </div>
              <div className="text-2xl font-bold text-(--color-text)">{streaks.longestStreak}</div>
              <div className="text-[10px] uppercase tracking-wider text-(--color-muted)/60">{t("activity_stats.longest")}</div>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] mb-2">
                <CalendarDays className="h-4 w-4 text-(--color-muted)" />
              </div>
              <div className="text-2xl font-bold text-(--color-text)">{streaks.totalDaysPlayed}</div>
              <div className="text-[10px] uppercase tracking-wider text-(--color-muted)/60">{t("activity_stats.days_played")}</div>
            </div>
          </div>
          )}
        </PanelCard>

        {/* XP & Level — polished */}
        <PanelCard className="border-amber-400/15">
          <SectionTitle icon={Award}>{t("activity_stats.xp_level")}</SectionTitle>
          <div className="flex items-center gap-6">
            {/* Level circle */}
            <LevelRing percent={profile.progressPercent} level={profile.level} />

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
              <div className="mt-3 flex items-center gap-4 text-xs text-(--color-muted)">
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3 text-amber-400/60" />
                  {profile.totalXp} XP
                </span>
                <span className="flex items-center gap-1">
                  <Trophy className="h-3 w-3 text-amber-400/60" />
                  {profile.unlockedCount}/{profile.totalCount}
                </span>
              </div>
              {/* Achievement progress bar */}
              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px] text-(--color-muted)/60 mb-1">
                  <span>{t("activity_stats.launcher_achievements")}</span>
                  <span>{Math.round(profile.totalCount > 0 ? (profile.unlockedCount / profile.totalCount) * 100 : 0)}%</span>
                </div>
                <GrowBar
                  percent={profile.totalCount > 0 ? (profile.unlockedCount / profile.totalCount) * 100 : 0}
                  minPercent={profile.unlockedCount > 0 ? 3 : 0}
                  trackClassName="h-2 rounded-full bg-white/[0.06]"
                  fillClassName="bg-linear-to-r from-violet-500 to-violet-400"
                />
              </div>
            </div>
          </div>
        </PanelCard>
      </div>

      {/* 3-column: Heatmap + Time of Day + Top Games */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity Heatmap */}
        <PanelCard>
          <SectionTitle icon={CalendarDays}>{t("activity_stats.activity_heatmap")}</SectionTitle>
          {!hasAnyPlaytime ? (
            <ActivityEmptyState
              icon={CalendarDays}
              title={t("activity_stats.no_heatmap")}
              description={t("activity_stats.no_heatmap_desc")}
              compact
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                {heatmapData.map((day) => (
                  <div
                    key={day.date}
                    title={`${formatDateShort(day.date)}: ${day.value > 0 ? `${t("activity_stats.level")} ${day.value}` : t("activity_stats.no_activity_label")}`}
                    className={`h-4 w-4 rounded-sm ${HEATMAP_COLORS[day.value] || HEATMAP_COLORS[0]}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 text-[10px] text-(--color-muted)/50">
                <span>{t("activity_stats.less")}</span>
                {HEATMAP_COLORS.map((c, idx) => (
                  <div key={idx} className={`h-3 w-3 rounded-sm ${c}`} />
                ))}
                <span>{t("activity_stats.more")}</span>
              </div>
            </>
          )}
        </PanelCard>

        {/* Time of Day */}
        <PanelCard>
          <SectionTitle icon={Sun}>{t("activity_stats.time_of_day")}</SectionTitle>
          {!hasAnyPlaytime ? (
            <ActivityEmptyState
              icon={Clock}
              title={t("activity_stats.no_session_data")}
              description={t("activity_stats.no_session_data_desc")}
              compact
            />
          ) : (
            <TimeOfDayChart buckets={timeOfDay} />
          )}
        </PanelCard>

        {/* Top Games */}
        <PanelCard>
          <SectionTitle icon={Trophy}>{t("activity_stats.top_10_games")}</SectionTitle>
          {topGames.length === 0 ? (
            <ActivityEmptyState
              icon={Gamepad2}
              title={t("activity_stats.no_play_data")}
              description={t("activity_stats.no_play_data_desc")}
              compact
            />
          ) : (
            <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
              {topGames.map((game, i) => (
                <TopGameRow key={game.appId} game={game} index={i} />
              ))}
            </div>
          )}
        </PanelCard>
      </div>

      {/* Mastery Tiers — full width */}
      <PanelCard className="mt-6">
        <SectionTitle icon={Swords}>{t("activity_stats.mastery_tiers")}</SectionTitle>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
          {masteryTiers.map(({ tier, count }) => {
            const TierIcon = tier.icon;
            return (
              <div
                key={tier.tier}
                className={`rounded-xl border ${tier.borderColor} ${tier.bgColor} p-4 text-center`}
              >
                <TierIcon className={`h-6 w-6 mx-auto mb-1 ${tier.color}`} />
                <div className={`text-lg font-bold ${tier.color}`}>{count}</div>
                <div className="text-[10px] uppercase tracking-wider text-(--color-muted)/60 mt-0.5">{tier.label}</div>
                <div className="text-[9px] text-(--color-muted)/40 mt-0.5">{">="}{tier.thresholdHours}h</div>
              </div>
            );
          })}
        </div>
      </PanelCard>

      {/* Game Achievements — split by source */}
      <GameAchievementsCards games={games} />

      {/* 2-column: Session History + Activity Feed */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Session History */}
        <PanelCard>
          <SectionTitle icon={Timer}>{t("activity_stats.recent_sessions")}</SectionTitle>
          {sessionHistory.length === 0 ? (
            <ActivityEmptyState
              icon={Clock}
              title={t("activity_stats.no_sessions")}
              description={t("activity_stats.no_sessions_desc")}
              compact
            />
          ) : (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {sessionHistory.map((s, i) => (
                <div key={`${s.appId}-${s.startedAt}-${i}`} className="flex items-center gap-3 py-2 border-b border-(--color-border)/10 last:border-0">
                  <Gamepad2 className="h-4 w-4 text-(--color-muted)/40 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-(--color-text) truncate">{s.gameTitle}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-(--color-muted)/50">{formatTimestamp(s.startedAt)}</span>
                      {s.source && (
                        <span className={`inline-flex rounded-full border px-1.5 py-px text-[9px] font-medium ${SOURCE_BADGE_COLORS[s.source] || "border-white/10 bg-white/[0.04] text-(--color-muted)"}`}>
                          {s.source === "steam" ? "Steam" : s.source === "local" ? "Local" : s.source === "lua" ? "Lua" : s.source === "manual" ? "Manual" : s.source === "debrid" ? "Debrid" : s.source === "epic" ? "Epic" : s.source}
                        </span>
                      )}
                      {s.exitReason && s.exitReason !== "normal" && (
                        <span className="text-[9px] text-(--color-muted)/40">{t(EXIT_REASON_LABELS[s.exitReason] || "")}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-(--color-text)">{formatDuration(s.durationSeconds)}</span>
                </div>
              ))}
            </div>
          )}
        </PanelCard>

        {/* Activity Feed */}
        <PanelCard>
          <SectionTitle icon={BookOpen}>{t("activity_stats.activity_feed")}</SectionTitle>
          <ActivityFeed compact />
        </PanelCard>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, truncate, accent }: { icon: React.ReactNode; label: string; value: string; truncate?: boolean; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-(--color-border)/15 lf-surface px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-(--color-muted)/60">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${accent ? "text-(--color-accent)" : "text-(--color-text)"} ${truncate ? "truncate" : ""}`}>{value}</div>
    </div>
  );
}

function PlayActivityBars({
  activityByDay,
  maxDaySeconds,
}: {
  activityByDay: Array<{ date: string; seconds: number }>;
  maxDaySeconds: number;
}) {
  const grow = useGrowOnMount();
  return (
    <div className="flex items-end gap-[3px] h-36">
      {activityByDay.map((day) => {
        const height = day.seconds > 0 ? Math.max(4, (day.seconds / maxDaySeconds) * 100) : 0;
        return (
          <div
            key={day.date}
            className="flex-1 group relative"
            title={`${formatDateShort(day.date)}: ${formatDuration(day.seconds)}`}
          >
            <div
              className="w-full rounded-t bg-(--color-accent)/50 transition-all hover:bg-(--color-accent)/70"
              style={{ height: grow ? `${height}%` : "0%", minHeight: height > 0 ? "4px" : "0" }}
            />
          </div>
        );
      })}
    </div>
  );
}

function TopGameRow({ game, index }: { game: { title: string; appId: string; totalSeconds: number; sessions: number; game?: LibraryGame }; index: number }) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const libGame = game.game;

  useEffect(() => {
    if (!libGame) return;
    let cancelled = false;
    const resolve = async () => {
      const bg = libGame.backgroundPath ?? libGame.landscapePath ?? libGame.coverPath;
      if (!bg) return;
      try {
        const url = await resolveGameMediaUrl(libGame.appId ?? "", bg, "steam");
        if (!cancelled && url) setImgSrc(url);
      } catch { /* ignore */ }
    };
    resolve();
    return () => { cancelled = true; };
  }, [libGame]);

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className={`w-4 text-[10px] text-right font-medium shrink-0 ${index < 3 ? "text-amber-400/70" : "text-(--color-muted)/30"}`}>{index + 1}</span>
      {imgSrc ? (
        <img src={imgSrc} alt="" className="h-8 w-8 rounded-md object-cover shrink-0" />
      ) : (
        <div className="h-8 w-8 rounded-md bg-white/[0.04] shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-(--color-text) truncate">{game.title}</div>
      </div>
      <span className="text-[10px] text-(--color-muted) shrink-0">{game.sessions}s</span>
      <span className="text-xs font-medium text-(--color-text) shrink-0">{formatDuration(game.totalSeconds)}</span>
    </div>
  );
}

const TIME_ICONS = [Sunrise, Sun, Sunset, Moon] as const;
const TIME_FG = ["text-amber-400", "text-yellow-300", "text-orange-400", "text-indigo-400"] as const;
const TIME_BG = ["bg-amber-400", "bg-yellow-300", "bg-orange-400", "bg-indigo-400"] as const;

function TimeOfDayChart({ buckets }: { buckets: TimeOfDayBucket[] }) {
  const grow = useGrowOnMount();
  const maxPercent = Math.max(1, ...buckets.map(b => b.percent));

  return (
    <div className="space-y-3">
      {buckets.map((b, i) => {
        const Icon = TIME_ICONS[i];
        const barWidth = maxPercent > 0 ? (b.percent / maxPercent) * 100 : 0;
        return (
          <div key={b.label}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <Icon className={`h-3 w-3 ${TIME_FG[i]}`} />
                <span className="text-xs text-(--color-text)">{b.label}</span>
              </div>
              <span className="text-[10px] text-(--color-muted)">{b.percent}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-out ${TIME_BG[i]}`}
                style={{ width: grow ? `${barWidth}%` : "0%" }}
              />
            </div>
            <div className="text-[9px] text-(--color-muted)/40 mt-0.5">{b.hours} · {formatDuration(b.seconds)}</div>
          </div>
        );
      })}
    </div>
  );
}

function GameAchievementsCards({ games }: { games: LibraryGame[] }) {
  const { t } = useTranslation();
  const grow = useGrowOnMount();
  const [folderData, setFolderData] = useState<FolderAchievementSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    scanAchievementFolders().then((rows) => {
      if (!cancelled) setFolderData(rows);
    });
    return () => { cancelled = true; };
  }, []);

  const { steamGames, crackGames, epicGames } = useMemo(() => {
    const steam: Array<{ game: LibraryGame; total: number; unlocked: number; percent: number; appId: string }> = [];
    const crack: Array<{ game: LibraryGame; total: number; unlocked: number; percent: number; appId: string }> = [];
    const epic: Array<{ game: LibraryGame; total: number; unlocked: number; percent: number; appId: string }> = [];

    const gameByAppId = new Map<string, LibraryGame>();
    for (const game of games) {
      if (game.appId) gameByAppId.set(game.appId, game);
    }

    for (const row of folderData) {
      if (row.total <= 0 || row.unlocked <= 0) continue;
      const game = gameByAppId.get(row.appId);
      if (!game) continue;

      const entry = { game, total: row.total, unlocked: row.unlocked, percent: Math.round(row.percent), appId: row.appId };

      if (row.source === "crack") {
        crack.push(entry);
      } else if (row.source === "epic-official") {
        epic.push(entry);
      } else {
        steam.push(entry);
      }
    }

    steam.sort((a, b) => b.percent - a.percent);
    crack.sort((a, b) => b.percent - a.percent);
    epic.sort((a, b) => b.percent - a.percent);
    return { steamGames: steam, crackGames: crack, epicGames: epic };
  }, [games, folderData]);

  if (steamGames.length === 0 && crackGames.length === 0 && epicGames.length === 0) return null;

  return (
    <>
      {steamGames.length > 0 && (
        <GameAchievementSection
          title={t("activity_stats.steam_achievements")}
          icon={<Trophy className="h-4 w-4 text-sky-400" />}
          entries={steamGames}
          grow={grow}
        />
      )}
      {crackGames.length > 0 && (
        <GameAchievementSection
          title={t("activity_stats.crack_achievements")}
          icon={<Zap className="h-4 w-4 text-purple-400" />}
          entries={crackGames}
          grow={grow}
        />
      )}
      {epicGames.length > 0 && (
        <GameAchievementSection
          title={t("activity_stats.epic_achievements")}
          icon={<Award className="h-4 w-4 text-amber-400" />}
          entries={epicGames}
          grow={grow}
        />
      )}
    </>
  );
}

function GameAchievementSection({
  title,
  icon,
  entries,
  grow,
}: {
  title: string;
  icon: React.ReactNode;
  entries: Array<{ game: LibraryGame; total: number; unlocked: number; percent: number; appId: string }>;
  grow: boolean;
}) {
  const { t } = useTranslation();
  const [imgSrcs, setImgSrcs] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (entries.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = new Map<string, string>();
      for (const { game } of entries.slice(0, 30)) {
        if (cancelled) break;
        if (!game.appId) continue;
        if (game.source && game.source !== "steam" && game.imageUrl) {
          if (!cancelled) next.set(game.appId, game.imageUrl);
          continue;
        }
        const bg = game.coverPath ?? game.landscapePath ?? game.backgroundPath;
        if (!bg) continue;
        try {
          const url = await resolveGameMediaUrl(game.appId, bg, "steam");
          if (!cancelled && url) next.set(game.appId, url);
        } catch { /* ignore */ }
      }
      if (!cancelled) setImgSrcs(next);
    })();
    return () => { cancelled = true; };
  }, [entries]);

  return (
    <PanelCard className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-(--color-text)">{title}</h3>
        <span className="text-[10px] text-(--color-muted)">{entries.length} {t("activity_stats.games")}</span>
      </div>
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {entries.map(({ game, total, unlocked, percent, appId }) => {
          const img = imgSrcs.get(appId);
          return (
            <div key={appId} className="flex items-center gap-2.5 py-1.5">
              {img ? (
                <img src={img} alt="" className="h-7 w-7 rounded-md object-cover shrink-0" />
              ) : (
                <div className="h-7 w-7 rounded-md bg-white/[0.04] shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs text-(--color-text) truncate">{game.title}</span>
                  <span className="text-[10px] text-(--color-muted) ml-2 shrink-0">{unlocked}/{total}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out ${
                      percent >= 100
                        ? "bg-linear-to-r from-amber-400 to-amber-300"
                        : percent >= 75
                        ? "bg-linear-to-r from-emerald-500 to-emerald-400"
                        : percent >= 50
                        ? "bg-linear-to-r from-sky-500 to-sky-400"
                        : "bg-linear-to-r from-(--color-accent) to-(--color-accent)/70"
                    }`}
                    style={{ width: grow ? `${percent}%` : "0%" }}
                  />
                </div>
              </div>
              <span className={`text-[10px] font-medium shrink-0 ${
                percent >= 100 ? "text-amber-400" : percent >= 75 ? "text-emerald-400" : "text-(--color-muted)"
              }`}>{percent}%</span>
            </div>
          );
        })}
      </div>
    </PanelCard>
  );
}

