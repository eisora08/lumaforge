import { useMemo, useState, useEffect, useRef } from "react";
import { Search, RefreshCw, Trophy, X, Calendar, Star, Lock, Unlock } from "lucide-react";
import type { GameAchievement, GameAchievementsSummary } from "../../types/gameAchievements";
import AchievementIcon from "../common/AchievementIcon";
import { achievementImageQueue, resolveImageSource, isResolvedUrl } from "../../services/achievementImageQueue";

type Props = {
  summary: GameAchievementsSummary;
  appIdStr?: string;
  onClose: () => void;
  onRefresh: () => void;
  refreshing: boolean;
};

type FilterMode = "all" | "unlocked" | "locked";
type SortMode = "default" | "name" | "date" | "rarity" | "unlocked-first" | "locked-first";

function formatAchievementDate(ts: number): string {
  let t = ts;
  if (t > 0 && t < 1000000000000) t *= 1000;
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function normalizeUnlockTime(ts: number | undefined | null): number | undefined {
  if (ts == null || ts === 0) return undefined;
  if (ts < 1000000000000) return ts * 1000;
  return ts;
}

function sortAchievements(list: GameAchievement[], sort: SortMode): GameAchievement[] {
  const sorted = [...list];
  switch (sort) {
    case "default":
    case "unlocked-first":
      sorted.sort((a, b) => {
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
        if (a.unlocked && b.unlocked) {
          const at = a.unlockTime ?? 0;
          const bt = b.unlockTime ?? 0;
          if (at !== bt) return bt - at;
        }
        if (!a.unlocked && !b.unlocked) {
          const ar = a.rarityPercent ?? 101;
          const br = b.rarityPercent ?? 101;
          if (ar !== br) return ar - br;
        }
        return a.name.localeCompare(b.name);
      });
      break;
    case "locked-first":
      sorted.sort((a, b) => {
        if (a.unlocked !== b.unlocked) return a.unlocked ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
      break;
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "date":
      sorted.sort((a, b) => {
        const at = a.unlockTime ?? 0;
        const bt = b.unlockTime ?? 0;
        if (at !== bt) return bt - at;
        return a.name.localeCompare(b.name);
      });
      break;
    case "rarity":
      sorted.sort((a, b) => {
        const ar = a.rarityPercent ?? 101;
        const br = b.rarityPercent ?? 101;
        if (ar !== br) return ar - br;
        return a.name.localeCompare(b.name);
      });
      break;
  }
  return sorted;
}

export default function AchievementsModal({ summary, appIdStr, onClose, onRefresh, refreshing }: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("default");
  const [search, setSearch] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  // PART 11: Prevent body scroll, focus close button, Escape key
  useEffect(() => {
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Enqueue missing achievement images when modal opens
  useEffect(() => {
    if (!summary.achievements?.length || !appIdStr) return;
    const items: import("../../services/achievementImageQueue").ImageQueueItem[] = [];
    for (const a of summary.achievements) {
      if (a.iconUrl && !isResolvedUrl(a.iconUrl)) {
        const resolved = resolveImageSource(a.iconUrl, appIdStr, "icon");
        if (resolved) items.push({ appId: appIdStr, apiName: a.apiName, ...resolved, type: "icon", priority: "high" });
      }
      if (a.iconGrayUrl && !isResolvedUrl(a.iconGrayUrl)) {
        const resolved = resolveImageSource(a.iconGrayUrl, appIdStr, "icon_gray");
        if (resolved) items.push({ appId: appIdStr, apiName: a.apiName, ...resolved, type: "icon_gray", priority: "high" });
      }
    }
    if (items.length > 0) {
      console.debug(`[ACH][IMG] modal enqueued ${items.length} images for appid=${appIdStr}`);
      achievementImageQueue.enqueue(items);
    }
  }, [summary.achievements, appIdStr]);

  const filtered = useMemo(() => {
    let list = summary.achievements;

    if (summary.progressAvailable) {
      if (filter === "unlocked") list = list.filter((a) => a.unlocked);
      else if (filter === "locked") list = list.filter((a) => !a.unlocked);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q));
    }

    return sortAchievements(list, sort);
  }, [summary.achievements, filter, sort, search]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ animation: "lfModalOverlayIn 150ms ease-out both" }}
      aria-modal="true"
      role="dialog"
      aria-label={`Achievements — ${summary.total} total`}
    >
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative z-10 mx-4 flex max-h-[82vh] w-full max-w-[820px] flex-col overflow-hidden rounded-2xl border border-(--surface-active-border) bg-(--color-bg) shadow-2xl lf-modal-panel"
      >
        {/* PART 6: Header with progress bar */}
        <div className="shrink-0 border-b border-(--surface-active-border)">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-(--color-accent)/10">
                <Trophy className="h-4 w-4 text-(--color-accent)" />
              </div>
              <div>
                <h2 className="text-base font-bold text-(--color-text)">
                  Achievements
                </h2>
                <p className="text-[11px] text-(--color-muted)">
                  {summary.progressAvailable
                    ? `${summary.unlocked} of ${summary.total} achievements earned`
                    : `${summary.total} total`}
                  {appIdStr ? <> &middot; App {appIdStr}</> : null}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/5 p-1.5 text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
                aria-label="Close achievements modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {summary.progressAvailable && summary.total > 0 && (
            <div className="px-5 pb-3">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-(--color-text) font-medium">
                  {summary.unlocked} / {summary.total}
                </span>
                <span className="text-(--color-muted)">
                  {summary.percent}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-(--color-accent) transition-all duration-700 ease-out"
                  style={{ width: `${summary.percent}%`, boxShadow: "0 0 8px var(--color-accent)" }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Progress unavailable banner */}
        {!summary.progressAvailable && (
          <div className="shrink-0 border-b border-(--surface-active-border) bg-amber-500/5 px-5 py-2 text-center text-[11px] text-amber-400/80">
            Achievement progress is unavailable. Showing achievement list only.
          </div>
        )}

        {/* PART 7: Controls bar */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-(--surface-active-border) px-5 py-2.5">
          {/* Filter */}
          <div className="flex overflow-hidden rounded-lg border border-(--surface-active-border)">
            {(["all"] as FilterMode[]).concat(summary.progressAvailable ? ["unlocked", "locked"] : []).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`cursor-pointer px-3 py-1 text-[11px] font-medium transition ${
                  filter === f
                    ? "bg-(--color-accent)/20 text-(--color-accent)"
                    : "text-(--color-muted) hover:text-(--color-text)"
                }`}
                aria-pressed={filter === f}
              >
                <span className="inline-flex items-center gap-1">
                  {f === "unlocked" && <Unlock className="h-3 w-3" />}
                  {f === "locked" && <Lock className="h-3 w-3" />}
                  {f === "all" ? "All" : f === "unlocked" ? "Unlocked" : "Locked"}
                </span>
              </button>
            ))}
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1.5 text-[11px] text-(--color-muted)">
            <span>Sort:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="rounded-lg border border-(--surface-active-border) bg-white/5 px-2 py-1 text-[11px] text-(--color-text) outline-none focus:border-(--color-accent)"
            >
              <option value="default">Default</option>
              <option value="name">Name</option>
              <option value="date">Unlock Date</option>
              <option value="rarity">Rarity</option>
              <option value="locked-first">Locked First</option>
              <option value="unlocked-first">Unlocked First</option>
            </select>
          </div>

          {/* Refresh */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-(--surface-active-border) bg-white/5 px-2 py-1 text-[11px] text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:opacity-50"
            aria-label="Refresh achievements"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>

          {/* Search */}
          <div className="relative ml-auto min-w-0">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--color-muted)" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search achievements..."
              className="h-7 w-36 rounded-lg border border-(--surface-active-border) bg-white/5 pl-7 pr-2 text-[11px] text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent) focus:w-48 transition-all"
              aria-label="Search achievements"
            />
          </div>
        </div>

        {/* PART 8: Achievement list */}
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Trophy className="h-10 w-10 text-(--color-muted)/40" />
              <p className="mt-3 text-sm text-(--color-muted)">
                {search ? "No achievements match your search." : "No achievements to show."}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((ach) => (
                <AchievementRow key={ach.id} achievement={ach} progressAvailable={summary.progressAvailable} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-(--surface-active-border) px-5 py-2 text-center text-[10px] text-(--color-muted)/60">
          {summary.source === "steam-web-api" ? "Data from Steam Web API" : summary.source === "steam-appcache" ? "Data from local Steam cache" : summary.source === "local-cache" ? "Cached achievement data" : summary.source === "librarycache" ? "Progress from local Steam library cache" : summary.source === "schema-only" ? "Schema loaded \u2014 log in with Steam for progress" : summary.source === "global-percentages" ? "Global achievement rates from Steam" : "Achievement data unavailable"}
        </div>
      </div>
    </div>
  );
}

function AchievementRow({ achievement, progressAvailable }: { achievement: GameAchievement; progressAvailable: boolean }) {
  const unlockTime = normalizeUnlockTime(achievement.unlockTime);
  const isUnlocked = achievement.unlocked;

  return (
    <div
      className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/[0.03] ${
        isUnlocked ? "bg-emerald-500/[0.02]" : ""
      }`}
    >
      <AchievementIcon
        iconUrl={achievement.iconUrl}
        iconGrayUrl={achievement.iconGrayUrl}
        unlocked={isUnlocked}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className={`text-sm font-medium ${isUnlocked ? "text-(--color-text)" : "text-(--color-text)/80"}`}>
            {achievement.name}
          </span>
          <span
            className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
              isUnlocked
                ? "bg-emerald-500/10 text-emerald-400"
                : progressAvailable
                  ? "bg-white/5 text-(--color-muted)"
                  : "bg-white/[0.02] text-(--color-muted)/50"
            }`}
          >
            {isUnlocked ? "Unlocked" : progressAvailable ? "Locked" : "N/A"}
          </span>
        </div>
        {achievement.description && (
          <p className="mt-0.5 text-xs leading-relaxed text-(--color-muted)/80 line-clamp-2">
            {achievement.description}
          </p>
        )}
        <div className="mt-1 flex items-center gap-3 text-[10px] text-(--color-muted)/60">
          {unlockTime && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatAchievementDate(unlockTime)}
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
