import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Search, RefreshCw, Trophy, X, Calendar, Star, Lock, Unlock,
  ChevronDown, ChevronRight, Layers, Globe, Eraser,
} from "lucide-react";
import type { GameAchievement, GameAchievementsSummary } from "../../types/gameAchievements";
import AchievementIcon from "../common/AchievementIcon";
import { achievementImageQueue, resolveImageSource, isResolvedUrl } from "../../services/achievementImageQueue";
import { cleanupAchievementOrphanImages } from "../../services/tauri";

type Props = {
  summary: GameAchievementsSummary;
  appIdStr?: string;
  gameTitle?: string;
  gameIconUrl?: string;
  onClose: () => void;
  onRefresh: () => void;
  refreshing: boolean;
};

type TabId = "my-achievements" | "global-achievements" | "achievement-groups";
type FilterMode = "all" | "unlocked" | "locked";
type SortMode = "default" | "name" | "date" | "rarity" | "unlocked-first" | "locked-first";
type GroupMode = "dlc" | "rarity" | "status";

type GroupInfo = {
  title: string;
  achievements: GameAchievement[];
  unlockedCount: number;
  totalCount: number;
  rarityScore?: number;
};

const RARITY_LABELS: Record<string, { label: string; color: string }> = {
  "ultra-rare": { label: "Ultra Rare", color: "text-yellow-400" },
  rare: { label: "Rare", color: "text-purple-400" },
  uncommon: { label: "Uncommon", color: "text-blue-400" },
  common: { label: "Common", color: "text-emerald-400" },
  unknown: { label: "Unknown", color: "text-(--color-muted)/60" },
};

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

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

function getRarityTier(pct: number | undefined | null): string {
  if (pct == null) return "unknown";
  if (pct >= 50) return "common";
  if (pct >= 25) return "uncommon";
  if (pct >= 10) return "rare";
  return "ultra-rare";
}

function getRarityScore(achievements: GameAchievement[]): number {
  const vals = achievements.map((a) => a.rarityPercent).filter((v): v is number => v != null);
  if (vals.length === 0) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function isDlcAchievement(apiName: string, _name: string): boolean {
  const upper = apiName.toUpperCase();
  if (upper.includes("DLC")) return true;
  if (upper.includes("EXPANSION")) return true;
  if (/^WORLD\d*DLC/i.test(apiName)) return true;
  return false;
}

function isDlcMetaDescription(description: string | undefined): boolean {
  if (!description) return false;
  const d = description.toLowerCase();
  return d.includes("requires ") || d.includes("downloadable content") || d.includes("dlc:");
}

function buildSortedUnlocked(list: GameAchievement[]): GameAchievement[] {
  return [...list].sort((a, b) => {
    const at = normalizeUnlockTime(a.unlockTime) ?? 0;
    const bt = normalizeUnlockTime(b.unlockTime) ?? 0;
    if (at !== bt) return bt - at;
    const ar = a.rarityPercent ?? 101;
    const br = b.rarityPercent ?? 101;
    if (ar !== br) return ar - br;
    return a.name.localeCompare(b.name);
  });
}

function buildSortedLocked(list: GameAchievement[]): GameAchievement[] {
  return [...list].sort((a, b) => {
    const ar = a.rarityPercent ?? 101;
    const br = b.rarityPercent ?? 101;
    if (ar !== br) return ar - br;
    return a.name.localeCompare(b.name);
  });
}

function filterBySearch(list: GameAchievement[], query: string): GameAchievement[] {
  if (!query.trim()) return list;
  const q = query.trim().toLowerCase();
  return list.filter((a) => a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q));
}

function resolveGameIconUrl(gameIconUrl: string | undefined, appIdStr: string | undefined): string | undefined {
  if (!gameIconUrl) return undefined;
  if (gameIconUrl.startsWith("data:") || gameIconUrl.startsWith("file://") || gameIconUrl.startsWith("asset://")) return gameIconUrl;
  if (/^[a-f0-9]{40}$/i.test(gameIconUrl) && appIdStr) return `${STEAM_CDN}/${appIdStr}/${gameIconUrl}.jpg`;
  if (gameIconUrl.startsWith("http://") || gameIconUrl.startsWith("https://")) return gameIconUrl;
  return undefined;
}

function sortGlobalAchievements(list: GameAchievement[]): GameAchievement[] {
  return [...list].sort((a, b) => {
    const ar = a.rarityPercent ?? 101;
    const br = b.rarityPercent ?? 101;
    if (ar !== br) return ar - br;
    return a.name.localeCompare(b.name);
  });
}

export default function AchievementsModal({
  summary, appIdStr, gameTitle, gameIconUrl, onClose, onRefresh, refreshing,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("my-achievements");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("default");
  const [search, setSearch] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>("dlc");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const cleanupDoneRef = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Portal — prevent body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Enqueue images
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

  const toggleGroup = useCallback((title: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }, []);

  // Expand all groups by default
  useEffect(() => {
    setExpandedGroups(new Set());
  }, [groupMode, summary.achievements]);

  const percent = summary.progressAvailable && summary.total > 0
    ? Math.round((summary.unlocked! / summary.total) * 100)
    : 0;

  const resolvedGameIcon = resolveGameIconUrl(gameIconUrl, appIdStr);

  // --- Tab: My Achievements ---
  const myAchievementsContent = useMemo(() => {
    const unlockedRaw = summary.achievements.filter((a) => a.unlocked);
    const lockedRaw = summary.achievements.filter((a) => !a.unlocked);

    let unlockedList = buildSortedUnlocked(unlockedRaw);
    let lockedList = buildSortedLocked(lockedRaw);

    if (filter === "unlocked") lockedList = [];
    else if (filter === "locked") unlockedList = [];

    if (search.trim()) {
      unlockedList = filterBySearch(unlockedList, search);
      lockedList = filterBySearch(lockedList, search);
    }

    if (sort === "name") {
      unlockedList = [...unlockedList].sort((a, b) => a.name.localeCompare(b.name));
      lockedList = [...lockedList].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "date") {
      unlockedList = [...unlockedList].sort((a, b) => {
        const at = normalizeUnlockTime(a.unlockTime) ?? 0;
        const bt = normalizeUnlockTime(b.unlockTime) ?? 0;
        if (at !== bt) return bt - at;
        return a.name.localeCompare(b.name);
      });
    } else if (sort === "rarity") {
      const byRarity = (a: GameAchievement, b: GameAchievement) => {
        const ar = a.rarityPercent ?? 101;
        const br = b.rarityPercent ?? 101;
        if (ar !== br) return ar - br;
        return a.name.localeCompare(b.name);
      };
      unlockedList = [...unlockedList].sort(byRarity);
      lockedList = [...lockedList].sort(byRarity);
    }

    return { unlockedList, lockedList };
  }, [summary.achievements, filter, sort, search]);

  // --- Tab: Global Achievements ---
  const globalAchievementsList = useMemo(() => {
    const sorted = sortGlobalAchievements(summary.achievements);
    if (search.trim()) return filterBySearch(sorted, search);
    return sorted;
  }, [summary.achievements, search]);

  // --- Tab: Achievement Groups ---
  const achievementGroups = useMemo((): GroupInfo[] => {
    const all = summary.achievements;
    if (groupMode === "dlc") {
      const base: GameAchievement[] = [];
      const dlc: GameAchievement[] = [];
      for (const a of all) {
        if (isDlcAchievement(a.apiName, a.name) || isDlcMetaDescription(a.description)) {
          dlc.push(a);
        } else {
          base.push(a);
        }
      }
      if (dlc.length === 0) {
        const baseUnlocked = base.filter((a) => a.unlocked).length;
        return [{
          title: "All Achievements",
          achievements: base,
          unlockedCount: baseUnlocked,
          totalCount: base.length,
          rarityScore: getRarityScore(base),
        }];
      }
      return [
        {
          title: "Base Game",
          achievements: base,
          unlockedCount: base.filter((a) => a.unlocked).length,
          totalCount: base.length,
          rarityScore: getRarityScore(base),
        },
        {
          title: "DLC & Update",
          achievements: dlc,
          unlockedCount: dlc.filter((a) => a.unlocked).length,
          totalCount: dlc.length,
          rarityScore: getRarityScore(dlc),
        },
      ];
    }
    if (groupMode === "rarity") {
      const tiers: Record<string, GameAchievement[]> = {
        "ultra-rare": [],
        rare: [],
        uncommon: [],
        common: [],
        unknown: [],
      };
      for (const a of all) {
        const tier = getRarityTier(a.rarityPercent);
        tiers[tier].push(a);
      }
      const order = ["common", "uncommon", "rare", "ultra-rare", "unknown"];
      return order
        .filter((k) => tiers[k].length > 0)
        .map((k) => ({
          title: RARITY_LABELS[k].label,
          achievements: tiers[k],
          unlockedCount: tiers[k].filter((a) => a.unlocked).length,
          totalCount: tiers[k].length,
          rarityScore: getRarityScore(tiers[k]),
        }));
    }
    if (groupMode === "status") {
      const unlocked = all.filter((a) => a.unlocked);
      const locked = all.filter((a) => !a.unlocked);
      const groups: GroupInfo[] = [];
      if (unlocked.length > 0) {
        groups.push({
          title: "Unlocked",
          achievements: unlocked,
          unlockedCount: unlocked.length,
          totalCount: unlocked.length,
          rarityScore: getRarityScore(unlocked),
        });
      }
      if (locked.length > 0) {
        groups.push({
          title: "Locked",
          achievements: locked,
          unlockedCount: 0,
          totalCount: locked.length,
          rarityScore: getRarityScore(locked),
        });
      }
      return groups;
    }
    return [];
  }, [summary.achievements, groupMode]);

  // Expand groups by default when data changes
  useEffect(() => {
    setExpandedGroups(new Set(achievementGroups.map((g) => g.title)));
  }, [achievementGroups]);

  const handleCleanup = useCallback(async () => {
    if (!appIdStr || cleanupRunning) return;
    setCleanupRunning(true);
    setCleanupResult(null);
    try {
      if (cleanupDoneRef.current) {
        // Second click: confirm and delete
        const result2 = await cleanupAchievementOrphanImages({ appId: Number(appIdStr), dryRun: false });
        setCleanupResult(`Deleted ${result2.orphaned_count} orphan images. ${result2.actual_files - result2.orphaned_count} files remain.`);
        cleanupDoneRef.current = false;
      } else {
        // First click: dry run
        const result = await cleanupAchievementOrphanImages({ appId: Number(appIdStr), dryRun: true });
        setCleanupResult(`Dry run: ${result.expected_max} expected, ${result.actual_files} actual, ${result.orphaned_count} orphaned. Click again to delete.`);
        cleanupDoneRef.current = true;
      }
    } catch (err) {
      setCleanupResult(`Cleanup failed: ${err}`);
      cleanupDoneRef.current = false;
    }
    setCleanupRunning(false);
  }, [appIdStr, cleanupRunning]);

  const modal = (
    <div
      className="fixed inset-0 z-[9999] grid place-items-center bg-black/80 backdrop-blur-xl lf-modal-overlay"
      aria-modal="true"
      role="dialog"
      aria-label={`Achievements — ${summary.total} total`}
    >
      {/* Click outside overlay to close */}
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className="relative z-10 flex flex-col overflow-hidden rounded-2xl border border-(--surface-active-border) bg-(--color-bg) shadow-2xl lf-modal-panel"
        style={{ width: "min(920px, calc(100vw - 48px))", maxHeight: "86vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ===== HEADER ===== */}
        <div className="shrink-0 border-b border-(--surface-active-border)">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <div className="flex items-center gap-3 min-w-0">
              {resolvedGameIcon ? (
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10">
                  <img src={resolvedGameIcon} alt="" className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--color-accent)/10 ring-1 ring-(--color-accent)/20">
                  <Trophy className="h-5 w-5 text-(--color-accent)" />
                </div>
              )}
              <div className="min-w-0">
                <h2 className="text-base font-bold text-(--color-text) truncate">
                  {gameTitle || "Achievements"}
                </h2>
                <p className="text-[11px] text-(--color-muted) truncate">
                  {summary.progressAvailable
                    ? `${summary.unlocked} of ${summary.total} achievements earned`
                    : `${summary.total} achievements`}
                  {appIdStr ? <> &middot; App {appIdStr}</> : null}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {summary.progressAvailable && summary.total > 0 && (
                <div className="hidden sm:flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1">
                  <span className="text-xs font-bold text-emerald-400">{percent}%</span>
                </div>
              )}
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/5 p-1.5 text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:opacity-50"
                aria-label="Refresh achievements"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
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
                  {percent}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-(--color-accent) transition-all duration-700 ease-out"
                  style={{ width: `${percent}%`, boxShadow: "0 0 8px var(--color-accent)" }}
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

        {/* ===== TABS ===== */}
        <div className="flex shrink-0 items-center gap-1 border-b border-(--surface-active-border) px-5 py-2">
          <TabButton active={activeTab === "my-achievements"} onClick={() => setActiveTab("my-achievements")}>
            <Trophy className="h-3.5 w-3.5" />
            My Achievements
          </TabButton>
          <TabButton active={activeTab === "global-achievements"} onClick={() => setActiveTab("global-achievements")}>
            <Globe className="h-3.5 w-3.5" />
            Global Achievements
          </TabButton>
          <TabButton active={activeTab === "achievement-groups"} onClick={() => setActiveTab("achievement-groups")}>
            <Layers className="h-3.5 w-3.5" />
            Achievement Groups
          </TabButton>
        </div>

        {/* ===== CONTROLS BAR (My Achievements) ===== */}
        {activeTab === "my-achievements" && (
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
              </select>
            </div>

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
        )}

        {/* ===== CONTENT ===== */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
          {activeTab === "my-achievements" && (
            <MyAchievementsTab
              unlockedList={myAchievementsContent.unlockedList}
              lockedList={myAchievementsContent.lockedList}
              totalUnlocked={summary.achievements.filter((a) => a.unlocked).length}
              progressAvailable={summary.progressAvailable}
              search={search}
            />
          )}
          {activeTab === "global-achievements" && (
            <GlobalAchievementsTab list={globalAchievementsList} />
          )}
          {activeTab === "achievement-groups" && (
            <AchievementGroupsTab
              groups={achievementGroups}
              groupMode={groupMode}
              onGroupModeChange={setGroupMode}
              expandedGroups={expandedGroups}
              onToggleGroup={toggleGroup}
              progressAvailable={summary.progressAvailable}
            />
          )}
        </div>

        {/* ===== FOOTER ===== */}
        <div className="shrink-0 border-t border-(--surface-active-border) px-5 py-2 flex items-center justify-between text-[10px] text-(--color-muted)/60">
          <span>
            {summary.source === "steam-web-api" ? "Data from Steam Web API" : summary.source === "steam-appcache" ? "Data from local Steam cache" : summary.source === "local-cache" ? "Cached achievement data" : summary.source === "librarycache" ? "Progress from local Steam library cache" : summary.source === "schema-only" ? "Schema loaded — log in with Steam for progress" : summary.source === "global-percentages" ? "Global achievement rates from Steam" : "Achievement data unavailable"}
          </span>
          {import.meta.env.DEV && (
            <div className="flex items-center gap-2">
              {cleanupResult && (
                <span className="text-[9px] text-(--color-muted)/40 max-w-[240px] truncate">{cleanupResult}</span>
              )}
              <button
                type="button"
                onClick={handleCleanup}
                disabled={cleanupRunning}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-(--surface-active-border) px-2 py-0.5 text-[9px] text-(--color-muted) transition hover:bg-white/5 hover:text-(--color-text) disabled:opacity-50"
                aria-label="Cleanup orphan achievement images"
              >
                <Eraser className="h-3 w-3" />
                {cleanupRunning ? "..." : cleanupDoneRef.current ? "Confirm Delete" : "Cleanup Images"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-(--color-accent)/15 text-(--color-accent) shadow-xs"
          : "text-(--color-muted) hover:text-(--color-text) hover:bg-white/[0.04]"
      }`}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  My Achievements Tab                                                */
/* ------------------------------------------------------------------ */

function MyAchievementsTab({
  unlockedList, lockedList, totalUnlocked, progressAvailable, search,
}: {
  unlockedList: GameAchievement[];
  lockedList: GameAchievement[];
  totalUnlocked: number;
  progressAvailable: boolean;
  search: string;
}) {
  const showUnlocked = unlockedList.length > 0;
  const showLocked = lockedList.length > 0;

  if (!showUnlocked && !showLocked) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Trophy className="h-10 w-10 text-(--color-muted)/40" />
        <p className="mt-3 text-sm text-(--color-muted)">
          {search ? "No achievements match your search." : "No achievements to show."}
        </p>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1">
      {showUnlocked && (
        <>
          <SectionHeader
            icon={<Unlock className="h-3.5 w-3.5" />}
            title="Unlocked"
            count={unlockedList.length}
            total={totalUnlocked}
            accent
          />
          <div className="space-y-0.5">
            {unlockedList.map((ach) => (
              <AchievementRow key={ach.id} achievement={ach} progressAvailable={progressAvailable} />
            ))}
          </div>
        </>
      )}
      {showLocked && (
        <>
          <SectionHeader
            icon={<Lock className="h-3.5 w-3.5" />}
            title="Locked"
            count={lockedList.length}
          />
          <div className="space-y-0.5">
            {lockedList.map((ach) => (
              <AchievementRow key={ach.id} achievement={ach} progressAvailable={progressAvailable} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Global Achievements Tab                                            */
/* ------------------------------------------------------------------ */

function GlobalAchievementsTab({ list }: { list: GameAchievement[] }) {
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Globe className="h-10 w-10 text-(--color-muted)/40" />
        <p className="mt-3 text-sm text-(--color-muted)">No achievement data available.</p>
      </div>
    );
  }

  return (
    <div className="p-2">
      <div className="flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-wider text-(--color-muted)/50">
        <span>Achievement</span>
        <span>Global Rate</span>
      </div>
      <div className="space-y-0.5">
          {list.map((ach) => (
          <GlobalAchievementRow key={ach.id} achievement={ach} />
        ))}
      </div>
    </div>
  );
}

function GlobalAchievementRow({ achievement }: { achievement: GameAchievement }) {
  const isUnlocked = achievement.unlocked;
  const displayPct = achievement.rarityPercent != null ? achievement.rarityPercent.toFixed(1) : null;

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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className={`text-sm font-medium ${isUnlocked ? "text-(--color-text)" : "text-(--color-text)/80"}`}>
              {achievement.name}
            </span>
            {achievement.description && (
              <p className="mt-0.5 text-xs leading-relaxed text-(--color-muted)/80 line-clamp-1">
                {achievement.description}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold tabular-nums text-(--color-text)">
              {displayPct != null ? `${displayPct}%` : "N/A"}
            </div>
            <div className="text-[10px] text-(--color-muted)/50">of all players</div>
          </div>
        </div>
        {isUnlocked && (
          <div className="mt-1">
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
              <Unlock className="h-2.5 w-2.5" />
              Unlocked by you
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Achievement Groups Tab                                             */
/* ------------------------------------------------------------------ */

function AchievementGroupsTab({
  groups, groupMode, onGroupModeChange, expandedGroups, onToggleGroup, progressAvailable,
}: {
  groups: GroupInfo[];
  groupMode: GroupMode;
  onGroupModeChange: (m: GroupMode) => void;
  expandedGroups: Set<string>;
  onToggleGroup: (title: string) => void;
  progressAvailable: boolean;
}) {
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Layers className="h-10 w-10 text-(--color-muted)/40" />
        <p className="mt-3 text-sm text-(--color-muted)">No groups available.</p>
      </div>
    );
  }

  return (
    <div className="p-2">
      {/* Group mode selector */}
      <div className="flex items-center gap-2 px-1 pb-3">
        <span className="text-[11px] text-(--color-muted)">Group by:</span>
        <div className="flex overflow-hidden rounded-lg border border-(--surface-active-border)">
          {([
            { value: "dlc" as GroupMode, label: "Base / DLC" },
            { value: "rarity" as GroupMode, label: "Rarity" },
            { value: "status" as GroupMode, label: "Status" },
          ]).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onGroupModeChange(opt.value)}
              className={`cursor-pointer px-3 py-1 text-[11px] font-medium transition ${
                groupMode === opt.value
                  ? "bg-(--color-accent)/20 text-(--color-accent)"
                  : "text-(--color-muted) hover:text-(--color-text)"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {groups.map((group) => {
          const isExpanded = expandedGroups.has(group.title);
          const groupPercent = group.totalCount > 0 ? Math.round((group.unlockedCount / group.totalCount) * 100) : 0;

          return (
            <div key={group.title} className="rounded-xl border border-(--surface-active-border) overflow-hidden">
              <button
                type="button"
                onClick={() => onToggleGroup(group.title)}
                className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.02]"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-(--color-accent)/10">
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-(--color-accent)" /> : <ChevronRight className="h-3.5 w-3.5 text-(--color-accent)" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-(--color-text)">{group.title}</span>
                    <span className="text-[11px] text-(--color-muted)">
                      {group.unlockedCount} / {group.totalCount}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1 flex-1 max-w-[120px] overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-(--color-accent) transition-all"
                        style={{ width: `${groupPercent}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-(--color-muted)/60">{groupPercent}%</span>
                    {group.rarityScore != null && group.rarityScore > 0 && (
                      <span className="text-[10px] text-(--color-muted)/40">
                        avg {group.rarityScore.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              </button>
              {isExpanded && (
                <div className="border-t border-(--surface-active-border) p-2 space-y-0.5">
                  {group.achievements.map((ach) => (
                    <AchievementRow key={ach.id} achievement={ach} progressAvailable={progressAvailable} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared components                                                  */
/* ------------------------------------------------------------------ */

function SectionHeader({
  icon, title, count, total, accent,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  total?: number;
  accent?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold ${
      accent ? "text-emerald-400" : "text-(--color-muted)"
    }`}>
      {icon}
      <span>{title}</span>
      <span className="text-[11px] font-normal text-(--color-muted)/60">
        {total != null ? `${count} of ${total}` : count}
      </span>
    </div>
  );
}

function AchievementRow({ achievement, progressAvailable }: { achievement: GameAchievement; progressAvailable: boolean }) {
  const unlockTime = normalizeUnlockTime(achievement.unlockTime);
  const isUnlocked = achievement.unlocked;

  return (
    <div
      className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/[0.04] ${
        isUnlocked ? "bg-emerald-500/[0.03] border border-emerald-500/5" : "border border-transparent"
      }`}
    >
      <AchievementIcon
        iconUrl={achievement.iconUrl}
        iconGrayUrl={achievement.iconGrayUrl}
        unlocked={isUnlocked}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className={`text-sm font-medium ${isUnlocked ? "text-(--color-text)" : "text-(--color-text)/70"}`}>
              {achievement.name}
            </span>
            {achievement.description && (
              <p className={`mt-0.5 text-xs leading-relaxed line-clamp-2 ${
                isUnlocked ? "text-(--color-muted)/70" : "text-(--color-muted)/50"
              }`}>
                {achievement.description}
              </p>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
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
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-(--color-muted)/60">
          {unlockTime && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatAchievementDate(unlockTime)}
            </span>
          )}
          {achievement.rarityPercent != null && (
            <span className={`inline-flex items-center gap-1 ${
              isUnlocked ? "text-emerald-400/70" : ""
            }`}>
              <Star className="h-3 w-3" />
              {achievement.rarityPercent.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
