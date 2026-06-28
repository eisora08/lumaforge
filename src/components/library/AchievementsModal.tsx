import { useMemo, useState } from "react";
import { Search, RefreshCw, Trophy, X, Calendar, Star, Lock, Unlock } from "lucide-react";
import type { GameAchievement, GameAchievementsSummary } from "../../types/gameAchievements";
import AsyncImage from "../common/AsyncImage";

type Props = {
  summary: GameAchievementsSummary;
  appIdStr?: string;
  onClose: () => void;
  onRefresh: () => void;
  refreshing: boolean;
};

type FilterMode = "all" | "unlocked" | "locked";
type SortMode = "name" | "date" | "rarity";

function formatAchievementDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function AchievementsModal({ summary, appIdStr, onClose, onRefresh, refreshing }: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("name");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = summary.achievements;

    if (filter === "unlocked") list = list.filter((a) => a.unlocked);
    else if (filter === "locked") list = list.filter((a) => !a.unlocked);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q));
    }

    list = [...list];
    if (sort === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "date") {
      list.sort((a, b) => {
        const at = a.unlockTime ?? 0;
        const bt = b.unlockTime ?? 0;
        if (at !== bt) return bt - at;
        return a.name.localeCompare(b.name);
      });
    } else if (sort === "rarity") {
      list.sort((a, b) => {
        const ar = a.rarityPercent ?? 101;
        const br = b.rarityPercent ?? 101;
        if (ar !== br) return ar - br;
        return a.name.localeCompare(b.name);
      });
    }

    return list;
  }, [summary.achievements, filter, sort, search]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-(--surface-active-border) bg-(--color-bg) shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-(--surface-active-border) px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-(--color-text)">
              <Trophy className="mr-2 inline h-4 w-4 text-(--color-accent)" />
              Achievements
            </h2>
            <p className="mt-0.5 text-xs text-(--color-muted)">
              {summary.progressAvailable
                ? `${summary.unlocked} / ${summary.total} \u00b7 ${summary.percent}% complete`
                : `${summary.total} total`}
              {appIdStr ? <> \u00b7 App {appIdStr}</> : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/5 p-1.5 text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Progress unavailable banner */}
        {!summary.progressAvailable && (
          <div className="border-b border-(--surface-active-border) bg-amber-500/5 px-5 py-2 text-center text-[11px] text-amber-400/80">
            Achievement progress is unavailable. Showing achievement list only.
          </div>
        )}

        {/* Controls bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-(--surface-active-border) px-5 py-3">
          {/* Filter */}
          <div className="flex overflow-hidden rounded-lg border border-(--surface-active-border)">
            {(["all", "unlocked", "locked"] as FilterMode[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`cursor-pointer px-3 py-1 text-xs font-medium transition ${
                  filter === f
                    ? "bg-(--color-accent)/20 text-(--color-accent)"
                    : "text-(--color-muted) hover:text-(--color-text)"
                }`}
              >
                {f === "all" ? "All" : f === "unlocked" ? "Unlocked" : "Locked"}
              </button>
            ))}
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1.5 text-xs text-(--color-muted)">
            <span>Sort:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="rounded-lg border border-(--surface-active-border) bg-white/5 px-2 py-1 text-xs text-(--color-text) outline-none focus:border-(--color-accent)"
            >
              <option value="name">Name</option>
              <option value="date">Date</option>
              <option value="rarity">Rarity</option>
            </select>
          </div>

          {/* Search */}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--color-muted)" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search achievements..."
              className="h-8 w-48 rounded-lg border border-(--surface-active-border) bg-white/5 pl-8 pr-3 text-xs text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Trophy className="h-10 w-10 text-(--color-muted)" />
              <p className="mt-2 text-sm text-(--color-muted)">
                {search ? "No achievements match your search." : "No achievements to show."}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((ach) => (
                <AchievementRow key={ach.id} achievement={ach} progressAvailable={summary.progressAvailable} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-(--surface-active-border) px-5 py-2 text-center text-[10px] text-(--color-muted)">
          {summary.source === "steam-web-api" ? "Data from Steam Web API" : summary.source === "steam-appcache" ? "Data from local Steam cache" : summary.source === "local-cache" ? "Cached achievement data" : summary.source === "schema-only" ? "Schema loaded \u2014 log in with Steam for progress" : summary.source === "global-percentages" ? "Global achievement rates from Steam" : "Achievement data unavailable"}
        </div>
      </div>
    </div>
  );
}

function AchievementRow({ achievement, progressAvailable }: { achievement: GameAchievement; progressAvailable: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/[0.03]">
      {/* Icon */}
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
        {achievement.unlocked && achievement.iconUrl ? (
          <AsyncImage
            src={achievement.iconUrl}
            alt={achievement.name}
            className="h-full w-full"
            fallback={<div className="flex h-full w-full items-center justify-center text-(--color-muted)"><Trophy className="h-5 w-5" /></div>}
          />
        ) : achievement.iconGrayUrl ? (
          <AsyncImage
            src={achievement.iconGrayUrl}
            alt={achievement.name}
            className="h-full w-full opacity-50"
            fallback={<div className="flex h-full w-full items-center justify-center text-(--color-muted)/50"><Lock className="h-5 w-5" /></div>}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-(--color-muted)">
            {achievement.unlocked ? <Unlock className="h-5 w-5 text-emerald-400" /> : <Lock className="h-5 w-5" />}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium text-(--color-text)">
            {achievement.name}
          </span>
          <span className={`shrink-0 text-[10px] font-medium ${achievement.unlocked ? "text-emerald-400" : progressAvailable ? "text-(--color-muted)" : "text-(--color-muted)/50"}`}>
            {achievement.unlocked ? "Unlocked" : progressAvailable ? "Locked" : "Progress unavailable"}
          </span>
        </div>
        {achievement.description && (
          <p className="mt-0.5 text-xs leading-relaxed text-(--color-muted) line-clamp-2">
            {achievement.description}
          </p>
        )}
        <div className="mt-1 flex items-center gap-3 text-[10px] text-(--color-muted)/60">
          {achievement.unlockTime && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatAchievementDate(achievement.unlockTime)}
            </span>
          )}
          {achievement.rarityPercent != null && (
            <span className="inline-flex items-center gap-1">
              <Star className="h-3 w-3" />
              {achievement.rarityPercent.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
