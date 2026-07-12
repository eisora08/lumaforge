import { useMemo, useState, useEffect } from "react";
import {
  BarChart3, Clock, Gamepad2, Trophy, Flame, CalendarDays,
  TrendingUp, Zap, Swords, Timer, Award, Archive,
  BookOpen,
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
} from "../features/activity/stats/statsService";
import { getPlayerProfile, subscribeAchievementStore } from "../features/activity/achievements/achievementStore";
import type { PlayerProfile, StatsTimeFilter } from "../features/activity/types";
import ActivityFeed from "../components/activity/ActivityFeed";
import ActivityEmptyState from "../components/activity/ActivityEmptyState";

const TIME_FILTERS: Array<{ value: StatsTimeFilter; label: string }> = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "30days", label: "Last 30 Days" },
  { value: "year", label: "This Year" },
  { value: "all", label: "All Time" },
];

const HEATMAP_COLORS = [
  "bg-white/[0.04]",
  "bg-emerald-900/50",
  "bg-emerald-700/60",
  "bg-emerald-500/70",
  "bg-emerald-400/90",
];

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function PanelCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-(--color-border)/15 bg-(--color-surface) p-5 ${className}`}>
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
  const { games } = useLibraryGames();
  const [timeFilter, setTimeFilter] = useState<StatsTimeFilter>("all");
  const [profile, setProfile] = useState<PlayerProfile>(getPlayerProfile);

  useEffect(() => {
    return subscribeAchievementStore(() => setProfile(getPlayerProfile()));
  }, []);

  const stats = useMemo(() => computeLibraryStats(games), [games]);
  const filteredPlaytime = useMemo(() => computeFilteredPlaytime(games, timeFilter), [games, timeFilter]);
  const activityByDay = useMemo(() => computePlayActivityByDay(games, 90), [games]);
  const streaks = useMemo(() => computeStreaks(games), [games]);
  const heatmapData = useMemo(() => computeHeatmapData(games, 90), [games]);
  const topGames = useMemo(() => computeTopGames(games, 10), [games]);
  const sessionHistory = useMemo(() => computeSessionHistory(games, 20), [games]);
  const totalLaunches = useMemo(() => getTotalLaunchCount(games), [games]);
  const masteryTiers = useMemo(() => computeMasteryTiers(games), [games]);

  const maxDaySeconds = useMemo(() => Math.max(1, ...activityByDay.map((d) => d.seconds)), [activityByDay]);
  const hasAnyPlaytime = stats.totalHours > 0;

  return (
    <div className="w-full px-6 lg:px-8 xl:px-10 py-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-(--color-accent)/10 border border-(--color-accent)/20">
            <BarChart3 className="h-5 w-5 text-(--color-accent)" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-(--color-text)">Activity & Stats</h1>
            <p className="text-sm text-(--color-muted)">Your gaming activity at a glance</p>
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
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Top Stats — full width 6-col grid */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={<Clock className="h-4 w-4" />} label="Total Hours" value={formatDuration(stats.totalHours * 3600)} accent />
        <StatCard icon={<Gamepad2 className="h-4 w-4" />} label="Games Played" value={`${stats.gamesPlayed}`} />
        <StatCard icon={<Archive className="h-4 w-4 text-(--color-muted)/40" />} label="Unplayed" value={`${stats.gamesUnplayed}`} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Total Launches" value={`${totalLaunches}`} />
        <StatCard icon={<Timer className="h-4 w-4" />} label="Sessions" value={`${stats.totalSessions}`} />
        {stats.mostPlayedTitle && (
          <StatCard icon={<Trophy className="h-4 w-4 text-amber-400" />} label="Most Played" value={stats.mostPlayedTitle} truncate />
        )}
      </div>

      {/* Filtered playtime + Most Played — full width 2-col */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PanelCard>
          <div className="text-[10px] uppercase tracking-wider text-(--color-muted)/60">
            Play Time ({TIME_FILTERS.find((f) => f.value === timeFilter)?.label})
          </div>
          <div className="mt-1 text-xl font-bold text-(--color-text)">{formatDuration(filteredPlaytime.totalSeconds)}</div>
          <div className="mt-1 text-[10px] text-(--color-muted)/50">{filteredPlaytime.gamesPlayed} games active in period</div>
        </PanelCard>
        {stats.mostPlayedTitle && (
          <PanelCard>
            <div className="text-[10px] uppercase tracking-wider text-(--color-muted)/60">Most Played</div>
            <div className="mt-1 text-xl font-bold text-(--color-text) truncate">{stats.mostPlayedTitle}</div>
            <div className="mt-1 text-[10px] text-(--color-muted)/50">{formatDuration(stats.mostPlayedHours * 3600)} total</div>
          </PanelCard>
        )}
      </div>

      {/* Play Activity Chart — full width */}
      <PanelCard className="mt-6">
        <SectionTitle icon={BarChart3}>Play Activity (90 Days)</SectionTitle>
        {!hasAnyPlaytime ? (
          <ActivityEmptyState
            icon={BarChart3}
            title="No play activity yet"
            description="Launch and close a game to start building your activity chart."
          />
        ) : (
          <>
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
                      style={{ height: `${height}%`, minHeight: height > 0 ? "4px" : "0" }}
                    />
                  </div>
                );
              })}
            </div>
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
          <SectionTitle icon={Flame}>Streaks</SectionTitle>
          {!hasAnyPlaytime ? (
            <ActivityEmptyState
              icon={Flame}
              title="No streaks yet"
              description="Play games on consecutive days to build a streak."
              compact
            />
          ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/10 mb-2">
                <Flame className="h-4 w-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-amber-400">{streaks.currentStreak}</div>
              <div className="text-[10px] uppercase tracking-wider text-(--color-muted)/60">Current</div>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-(--color-accent)/10 mb-2">
                <TrendingUp className="h-4 w-4 text-(--color-accent)" />
              </div>
              <div className="text-2xl font-bold text-(--color-text)">{streaks.longestStreak}</div>
              <div className="text-[10px] uppercase tracking-wider text-(--color-muted)/60">Longest</div>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] mb-2">
                <CalendarDays className="h-4 w-4 text-(--color-muted)" />
              </div>
              <div className="text-2xl font-bold text-(--color-text)">{streaks.totalDaysPlayed}</div>
              <div className="text-[10px] uppercase tracking-wider text-(--color-muted)/60">Days Played</div>
            </div>
          </div>
          )}
        </PanelCard>

        {/* XP & Level — polished */}
        <PanelCard className="border-amber-400/15">
          <SectionTitle icon={Award}>XP & Level</SectionTitle>
          <div className="flex items-center gap-6">
            {/* Level circle */}
            <div className="relative shrink-0">
              <svg className="h-24 w-24 -rotate-90" viewBox="0 0 88 88">
                <circle cx="44" cy="44" r="38" fill="none" stroke="currentColor" strokeWidth="5" className="text-white/[0.06]" />
                <circle
                  cx="44" cy="44" r="38" fill="none" stroke="currentColor" strokeWidth="5"
                  strokeDasharray={`${2 * Math.PI * 38}`}
                  strokeDashoffset={`${2 * Math.PI * 38 * (1 - profile.progressPercent / 100)}`}
                  strokeLinecap="round"
                  className="text-amber-400 transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-amber-400">{profile.level}</span>
                <span className="text-[8px] uppercase tracking-widest text-amber-400/60 -mt-0.5">Level</span>
              </div>
            </div>

            {/* XP details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs text-(--color-muted) mb-1.5">
                <span>{profile.currentLevelXp} / {profile.nextLevelXp} XP</span>
                <span>{Math.round(profile.progressPercent)}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-linear-to-r from-amber-500 to-amber-400 transition-all duration-700"
                  style={{ width: `${Math.max(2, profile.progressPercent)}%` }}
                />
              </div>
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
            </div>
          </div>
        </PanelCard>
      </div>

      {/* 2-column: Heatmap + Top Games */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Activity Heatmap */}
        <PanelCard>
          <SectionTitle icon={CalendarDays}>Activity Heatmap (90 Days)</SectionTitle>
          {!hasAnyPlaytime ? (
            <ActivityEmptyState
              icon={CalendarDays}
              title="No activity heatmap yet"
              description="Your play sessions will fill this heatmap over time."
              compact
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                {heatmapData.map((day) => (
                  <div
                    key={day.date}
                    title={`${formatDateShort(day.date)}: ${day.value > 0 ? `Level ${day.value}` : "No activity"}`}
                    className={`h-4 w-4 rounded-sm ${HEATMAP_COLORS[day.value] || HEATMAP_COLORS[0]}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 text-[10px] text-(--color-muted)/50">
                <span>Less</span>
                {HEATMAP_COLORS.map((c, idx) => (
                  <div key={idx} className={`h-3 w-3 rounded-sm ${c}`} />
                ))}
                <span>More</span>
              </div>
            </>
          )}
        </PanelCard>

        {/* Top Games */}
        <PanelCard>
          <SectionTitle icon={Trophy}>Top 10 Games</SectionTitle>
          {topGames.length === 0 ? (
            <ActivityEmptyState
              icon={Gamepad2}
              title="No play data yet"
              description="Your most played games will appear here."
              compact
            />
          ) : (
            <div className="space-y-1.5">
              {topGames.map((game, i) => (
                <div key={game.appId} className="flex items-center gap-3 py-1.5">
                  <span className={`w-5 text-xs text-right font-medium ${i < 3 ? "text-amber-400/70" : "text-(--color-muted)/30"}`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-(--color-text) truncate">{game.title}</div>
                  </div>
                  <span className="text-xs text-(--color-muted)">{game.sessions} sessions</span>
                  <span className="text-xs font-medium text-(--color-text)">{formatDuration(game.totalSeconds)}</span>
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      </div>

      {/* Mastery Tiers — full width */}
      <PanelCard className="mt-6">
        <SectionTitle icon={Swords}>Mastery Tiers</SectionTitle>
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

      {/* 2-column: Session History + Activity Feed */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Session History */}
        <PanelCard>
          <SectionTitle icon={Timer}>Recent Sessions</SectionTitle>
          {sessionHistory.length === 0 ? (
            <ActivityEmptyState
              icon={Clock}
              title="No sessions recorded yet"
              description="Completed play sessions will appear here."
              compact
            />
          ) : (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {sessionHistory.map((s, i) => (
                <div key={`${s.appId}-${s.startedAt}-${i}`} className="flex items-center gap-3 py-2 border-b border-(--color-border)/10 last:border-0">
                  <Gamepad2 className="h-4 w-4 text-(--color-muted)/40 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-(--color-text) truncate">{s.gameTitle}</div>
                    <div className="text-[10px] text-(--color-muted)/50">{formatTimestamp(s.startedAt)}</div>
                  </div>
                  <span className="text-xs font-medium text-(--color-text)">{formatDuration(s.durationSeconds)}</span>
                </div>
              ))}
            </div>
          )}
        </PanelCard>

        {/* Activity Feed */}
        <PanelCard>
          <SectionTitle icon={BookOpen}>Activity Feed</SectionTitle>
          <ActivityFeed compact />
        </PanelCard>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, truncate, accent }: { icon: React.ReactNode; label: string; value: string; truncate?: boolean; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-(--color-border)/15 bg-(--color-surface) px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-(--color-muted)/60">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${accent ? "text-(--color-accent)" : "text-(--color-text)"} ${truncate ? "truncate" : ""}`}>{value}</div>
    </div>
  );
}

