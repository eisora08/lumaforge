import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Search, RefreshCw, Trophy, X, Calendar, Star, Lock, Unlock,
  ChevronDown, ChevronRight, Layers, Globe, Eraser,
} from "lucide-react";
import type { GameAchievement, GameAchievementsSummary } from "../../types/gameAchievements";
import AchievementIcon from "../common/AchievementIcon";
import { achievementImageQueue, resolveImageSource, isResolvedUrl, nextGenerationId, ACHIEVEMENT_IMAGE_MIGRATION_AUTO, DEBUG_ACH_IMAGE_QUEUE, isImageResolved, markImageResolved } from "../../services/achievementImageQueue";
import { achievementAutoSyncService } from "../../services/achievementAutoSyncService";
import { achievementStore } from "../../services/achievementStore";
import { cleanupAchievementOrphanImages } from "../../services/tauri";
import { isInteractionBusy } from "../../services/perfCounters";

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

function isDlcAchievement(apiName: string, name: string): boolean {
  const upperApi = apiName.toUpperCase();
  const upperName = name.toUpperCase();

  if (upperApi.includes("DLC")) return true;
  if (upperApi.includes("EXPANSION")) return true;
  if (/^WORLD\d*DLC/i.test(apiName)) return true;

  if (/\bNEW\s*GAME\s*\+|\bNGPLUS\b|\bNEWGAMEPLUS\b/i.test(upperName)) return true;
  if (/\bUPDATE\b/i.test(upperApi)) return true;
  if (/\bISLE\s+IV\b/i.test(upperName)) return true;
  if (/DELICIOUS\s*LAST\s*COURSE/i.test(upperName)) return true;
  if (/MS\.?\s*CHALICE/i.test(upperName)) return true;

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
  return list.filter((a) =>
    a.name.toLowerCase().includes(q) ||
    a.description?.toLowerCase().includes(q) ||
    a.apiName.toLowerCase().includes(q)
  );
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
  summary: propSummary, appIdStr, gameTitle, gameIconUrl, onClose, onRefresh, refreshing,
}: Props) {
  const [summary, setSummary] = useState(propSummary);
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

  // Scroll to top when switching tabs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activeTab]);

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

  // Sync prop into local state
  useEffect(() => {
    setSummary(propSummary);
  }, [propSummary]);

  // Enqueue images with generation token (Part B3)
  // Phase 3: Enqueues for all visible achievements (modal shows full list)
  // Phase 4: Deferred during user interaction
  // Phase 5: Per-image logs gated behind DEBUG_ACH_IMAGE_QUEUE
  const modalGenRef = useRef<string>("");
  useEffect(() => {
    if (!summary.achievements?.length || !appIdStr) return;

    // Phase 5: Skip entirely when auto-download is disabled
    if (!ACHIEVEMENT_IMAGE_MIGRATION_AUTO) return;

    // Phase 4: Defer during interaction (navigation, scroll, click)
    if (isInteractionBusy()) return;

    const generationId = nextGenerationId(appIdStr, "achievements-modal");
    modalGenRef.current = generationId;

    const items: import("../../services/achievementImageQueue").ImageQueueItem[] = [];
    const startTime = performance.now();
    let cachedCount = 0;
    let skippedCount = 0;

    for (const a of summary.achievements) {
      // Phase 2+7: Session dedup — skip if already resolved this session
      if (a.iconUrl && !isResolvedUrl(a.iconUrl)) {
        if (isImageResolved(appIdStr, a.iconUrl, "icon")) {
          skippedCount++;
        } else {
          const resolved = resolveImageSource(a.iconUrl, appIdStr, "icon");
          if (resolved) {
            items.push({ appId: appIdStr, apiName: a.apiName, ...resolved, type: "icon", priority: "normal", caller: "achievements-modal", createdAt: Date.now(), generationId });
            markImageResolved(appIdStr, a.iconUrl, "icon");
          } else {
            cachedCount++;
          }
        }
      } else if (a.iconUrl) {
        cachedCount++;
      }

      if (a.iconGrayUrl && !isResolvedUrl(a.iconGrayUrl)) {
        if (isImageResolved(appIdStr, a.iconGrayUrl, "icon_gray")) {
          skippedCount++;
        } else {
          const resolved = resolveImageSource(a.iconGrayUrl, appIdStr, "icon_gray");
          if (resolved) {
            items.push({ appId: appIdStr, apiName: a.apiName, ...resolved, type: "icon_gray", priority: "normal", caller: "achievements-modal", createdAt: Date.now(), generationId });
            markImageResolved(appIdStr, a.iconGrayUrl, "icon_gray");
          } else {
            cachedCount++;
          }
        }
      } else if (a.iconGrayUrl) {
        cachedCount++;
      }
    }

    if (items.length > 0) {
      if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG] modal enqueued ${items.length} images for appid=${appIdStr}`);
      achievementImageQueue.enqueue(items);
    }
    const elapsedMs = Math.round(performance.now() - startTime);
    if (DEBUG_ACH_IMAGE_QUEUE) {
      console.debug(`[ACH][IMG_SUMMARY] appid=${appIdStr} requested=${summary.achievements.length * 2} cachedHits=${cachedCount} queued=${items.length} skipped=${skippedCount} elapsedMs=${elapsedMs}`);
    }
  }, [summary.achievements, appIdStr]);

  // Auto-sync: when modal is open, watch appId and call onRefresh on changes
  useEffect(() => {
    if (!appIdStr) return;
    const unsub = achievementAutoSyncService.subscribe((event) => {
      if (event.appId === appIdStr) {
        console.debug(`[ACH][AUTO_SYNC] modal detected change appid=${appIdStr}`);
        onRefresh();
      }
    });
    return unsub;
  }, [appIdStr, onRefresh]);

  // Store: fast-patch summary when store updates
  useEffect(() => {
    if (!appIdStr) return;
    const unsub = achievementStore.subscribe((appId, patched) => {
      if (appId !== appIdStr) return;
      setSummary(patched);
    });
    return unsub;
  }, [appIdStr]);

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
  const isPerfected = summary.total > 0 && summary.unlocked === summary.total && summary.progressAvailable !== false;

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

  // --- Tab: Achievement Groups ---
  const achievementGroups = useMemo((): GroupInfo[] => {
    let all = summary.achievements;

    // Apply search filter before grouping
    if (search.trim()) {
      all = filterBySearch(all, search);
    }
    if (all.length === 0) return [];

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
        const pct = a.rarityPercent;
        const tier = (pct != null && Number.isFinite(pct)) ? getRarityTier(pct) : "unknown";
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
  }, [summary.achievements, groupMode, search]);

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
      className="fixed inset-0 z-[9999] grid place-items-center bg-black/40"
      aria-modal="true"
      role="dialog"
      aria-label={`Achievements — ${summary.total} total`}
    >
      {/* Click outside overlay to close */}
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className="relative z-10 flex flex-col overflow-hidden rounded-2xl border border-(--surface-active-border) lf-surface shadow-2xl lf-modal-panel"
        style={{ width: "min(920px, calc(100vw - 48px))", height: "86vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ===== HEADER ===== */}
        <div className={`shrink-0 border-b ${isPerfected ? "border-amber-400/20" : "border-(--surface-active-border)"}`}>
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <div className="flex items-center gap-3 min-w-0">
              {resolvedGameIcon ? (
                <div className={`h-11 w-11 shrink-0 overflow-hidden rounded-xl ${isPerfected ? "ring-1 ring-amber-400/30" : "ring-1 ring-white/10"}`}>
                  <img src={resolvedGameIcon} alt="" className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isPerfected ? "bg-amber-500/15 ring-amber-400/30" : "bg-(--color-accent)/10 ring-(--color-accent)/20"} ring-1`}>
                  <Trophy className={`h-5 w-5 ${isPerfected ? "fill-amber-400 text-amber-400" : "text-(--color-accent)"}`} />
                </div>
              )}
              <div className="min-w-0">
                <h2 className={`text-base font-bold truncate ${isPerfected ? "text-amber-300" : "text-(--color-text)"}`}>
                  {isPerfected ? `${gameTitle || "Achievements"} · Perfected` : (gameTitle || "Achievements")}
                </h2>
                <p className={`text-[11px] truncate ${isPerfected ? "text-amber-400/80" : "text-(--color-muted)"}`}>
                  {isPerfected ? (
                    <span className="flex items-center gap-1">
                      <Trophy className="h-3 w-3 fill-amber-400" />
                      All {summary.total} achievements unlocked
                    </span>
                  ) : summary.progressAvailable ? (
                    `${summary.unlocked} of ${summary.total} achievements earned`
                  ) : (
                    `${summary.total} achievements`
                  )}
                  {appIdStr ? <> &middot; App {appIdStr}</> : null}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {summary.progressAvailable && summary.total > 0 && (
                <div className={`hidden sm:flex items-center gap-1.5 rounded-lg px-2.5 py-1 ${isPerfected ? "bg-amber-500/15" : "bg-emerald-500/10"}`}>
                  {isPerfected ? (
                    <>
                      <Trophy className="h-3 w-3 fill-amber-400 text-amber-400" />
                      <span className="text-xs font-bold text-amber-400">Perfected</span>
                    </>
                  ) : (
                    <span className="text-xs font-bold text-emerald-400">{percent}%</span>
                  )}
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
            <div className={`px-5 pb-3 ${isPerfected ? "relative" : ""}`}>
              {isPerfected && (
                <div className="absolute inset-x-5 bottom-3 h-1.5 rounded-full bg-amber-400/10 blur-md" />
              )}
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className={`font-medium ${isPerfected ? "text-amber-400" : "text-(--color-text)"}`}>
                  {isPerfected ? (
                    <span className="flex items-center gap-1.5">
                      <Trophy className="h-3.5 w-3.5 fill-amber-400" />
                      Perfected
                    </span>
                  ) : (
                    `${summary.unlocked} / ${summary.total}`
                  )}
                </span>
                <span className={isPerfected ? "text-amber-400/80" : "text-(--color-muted)"}>
                  {isPerfected ? "100%" : `${percent}%`}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${
                    isPerfected
                      ? "bg-gradient-to-r from-amber-400 to-yellow-300"
                      : "bg-(--color-accent)"
                  }`}
                  style={{
                    width: `${percent}%`,
                    boxShadow: isPerfected ? "0 0 14px rgba(251,191,36,0.5)" : "0 0 8px var(--color-accent)",
                  }}
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
            <div className="lf-tab-panel-in">
              <MyAchievementsTab
                unlockedList={myAchievementsContent.unlockedList}
                lockedList={myAchievementsContent.lockedList}
                totalUnlocked={summary.achievements.filter((a) => a.unlocked).length}
                progressAvailable={summary.progressAvailable}
                search={search}
                appIdStr={appIdStr}
              />
            </div>
          )}
          {activeTab === "global-achievements" && (
            <div className="lf-tab-panel-in">
              <GlobalAchievementsTab achievements={summary.achievements} appIdStr={appIdStr} />
            </div>
          )}
          {activeTab === "achievement-groups" && (
            <div className="lf-tab-panel-in">
              <AchievementGroupsTab
                groups={achievementGroups}
                groupMode={groupMode}
                onGroupModeChange={setGroupMode}
                expandedGroups={expandedGroups}
                onToggleGroup={toggleGroup}
                progressAvailable={summary.progressAvailable}
                appIdStr={appIdStr}
                search={search}
              />
            </div>
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
  unlockedList, lockedList, totalUnlocked, progressAvailable, search, appIdStr,
}: {
  unlockedList: GameAchievement[];
  lockedList: GameAchievement[];
  totalUnlocked: number;
  progressAvailable: boolean;
  search: string;
  appIdStr?: string;
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
              <AchievementRow key={ach.id} achievement={ach} progressAvailable={progressAvailable} appId={appIdStr} />
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
              <AchievementRow key={ach.id} achievement={ach} progressAvailable={progressAvailable} appId={appIdStr} />
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

type GlobalFilterMode = "all" | "unlocked" | "locked" | "ultra-rare" | "rare" | "unknown";

const GLOBAL_FILTERS: { key: GlobalFilterMode; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unlocked", label: "Unlocked" },
  { key: "locked", label: "Locked" },
  { key: "ultra-rare", label: "Ultra Rare" },
  { key: "rare", label: "Rare" },
  { key: "unknown", label: "Missing" },
];

function getRarityLabel(pct: number | undefined | null): string {
  const tier = getRarityTier(pct);
  return RARITY_LABELS[tier].label;
}

function getRarityColor(pct: number | undefined | null): string {
  const tier = getRarityTier(pct);
  return RARITY_LABELS[tier].color;
}

function formatRarityPercent(pct: number | undefined | null): string | null {
  if (pct == null) return null;
  if (!Number.isFinite(pct)) return null;
  return pct.toFixed(1);
}

function GlobalAchievementsTab({
  achievements, appIdStr,
}: {
  achievements: GameAchievement[];
  appIdStr?: string;
}) {
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalFilter, setGlobalFilter] = useState<GlobalFilterMode>("all");

  const filteredSorted = useMemo(() => {
    let result = sortGlobalAchievements(achievements);

    if (globalFilter === "unlocked") result = result.filter((a) => a.unlocked);
    else if (globalFilter === "locked") result = result.filter((a) => !a.unlocked);
    else if (globalFilter === "ultra-rare") result = result.filter((a) => a.rarityPercent != null && a.rarityPercent < 10);
    else if (globalFilter === "rare") result = result.filter((a) => a.rarityPercent != null && a.rarityPercent >= 10 && a.rarityPercent < 25);
    else if (globalFilter === "unknown") result = result.filter((a) => a.rarityPercent == null);

    if (globalSearch.trim()) {
      result = filterBySearch(result, globalSearch);
    }

    return result;
  }, [achievements, globalSearch, globalFilter]);

  const totalCount = achievements.length;
  const rarityKnown = achievements.filter((a) => a.rarityPercent != null && Number.isFinite(a.rarityPercent)).length;
  const rarityMissing = totalCount - rarityKnown;
  const ultraRareCount = achievements.filter((a) => a.rarityPercent != null && a.rarityPercent < 10).length;
  const rareCount = achievements.filter((a) => a.rarityPercent != null && a.rarityPercent >= 10 && a.rarityPercent < 25).length;
  const unlockedByUser = achievements.filter((a) => a.unlocked).length;

  if (import.meta.env.DEV) {
    console.debug(`[ACH][GLOBAL] appid=? total=${totalCount} rarityKnown=${rarityKnown} rarityMissing=${rarityMissing}`);
  }

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Globe className="h-10 w-10 text-(--color-muted)/40" />
        <p className="mt-3 text-sm text-(--color-muted)">No achievement data available.</p>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-2">
      {/* Summary header */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.02] border border-(--surface-active-border)">
        <div className="flex items-center gap-1.5 text-[10px] text-(--color-muted)/70">
          <span className="font-semibold text-(--color-text) text-xs">{totalCount}</span>
          achievements
        </div>
        <span className="text-(--color-muted)/20">|</span>
        <div className="flex items-center gap-1.5 text-[10px] text-(--color-muted)/70">
          <span className="font-semibold text-(--color-accent) text-xs">{rarityKnown}</span>
          with global rarity
        </div>
        {ultraRareCount > 0 && (
          <>
            <span className="text-(--color-muted)/20">|</span>
            <div className="flex items-center gap-1.5 text-[10px] text-(--color-muted)/70">
              <span className="font-semibold text-yellow-400 text-xs">{ultraRareCount}</span>
              ultra rare
            </div>
          </>
        )}
        {rareCount > 0 && (
          <>
            <span className="text-(--color-muted)/20">|</span>
            <div className="flex items-center gap-1.5 text-[10px] text-(--color-muted)/70">
              <span className="font-semibold text-purple-400 text-xs">{rareCount}</span>
              rare
            </div>
          </>
        )}
        {unlockedByUser > 0 && (
          <>
            <span className="text-(--color-muted)/20">|</span>
            <div className="flex items-center gap-1.5 text-[10px] text-(--color-muted)/70">
              <span className="font-semibold text-emerald-400 text-xs">{unlockedByUser}</span>
              unlocked by you
            </div>
          </>
        )}
      </div>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        {/* Filter */}
        <div className="flex overflow-hidden rounded-lg border border-(--surface-active-border)">
          {GLOBAL_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setGlobalFilter(f.key)}
              className={`cursor-pointer px-2.5 py-1 text-[10px] font-medium transition ${
                globalFilter === f.key
                  ? "bg-(--color-accent)/20 text-(--color-accent)"
                  : "text-(--color-muted) hover:text-(--color-text)"
              }`}
              aria-pressed={globalFilter === f.key}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative ml-auto min-w-0">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--color-muted)" />
          <input
            type="text"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search..."
            className="h-7 w-32 rounded-lg border border-(--surface-active-border) bg-white/5 pl-7 pr-2 text-[11px] text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent) focus:w-44 transition-all"
            aria-label="Search global achievements"
          />
        </div>
      </div>

      {filteredSorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Globe className="h-8 w-8 text-(--color-muted)/30" />
          <p className="mt-2 text-xs text-(--color-muted)">No achievements match your criteria.</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {filteredSorted.map((ach) => (
            <GlobalAchievementRow key={ach.id} achievement={ach} appId={appIdStr} />
          ))}
        </div>
      )}
    </div>
  );
}

function GlobalAchievementRow({ achievement, appId }: { achievement: GameAchievement; appId?: string }) {
  const isUnlocked = achievement.unlocked;
  const displayPct = formatRarityPercent(achievement.rarityPercent);
  const tierLabel = getRarityLabel(achievement.rarityPercent);
  const tierColor = getRarityColor(achievement.rarityPercent);

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
        appId={appId}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${isUnlocked ? "text-(--color-text)" : "text-(--color-text)/80"}`}>
                {achievement.name}
              </span>
              {!isUnlocked && (
                <Lock className="h-3 w-3 shrink-0 text-(--color-muted)/40" />
              )}
            </div>
            {achievement.description && (
              <p className="mt-0.5 text-xs leading-relaxed text-(--color-muted)/80 line-clamp-1">
                {achievement.description}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="flex items-center gap-1.5 justify-end">
              {displayPct != null ? (
                <>
                  <span className="text-sm font-semibold tabular-nums text-(--color-text)">
                    {displayPct}%
                  </span>
                  <span className={`text-[9px] font-medium ${tierColor}`}>
                    {tierLabel}
                  </span>
                </>
              ) : (
                <span className="text-sm text-(--color-muted)/50">N/A</span>
              )}
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
        {!isUnlocked && achievement.progress != null && achievement.maxProgress != null && achievement.maxProgress > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-(--color-accent) transition-all duration-500"
                style={{ width: `${Math.min(100, Math.round((achievement.progress / achievement.maxProgress) * 100))}%` }}
              />
            </div>
            <span className="shrink-0 text-[10px] tabular-nums text-(--color-muted)/70">
              {achievement.progress}/{achievement.maxProgress}
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
  groups, groupMode, onGroupModeChange, expandedGroups, onToggleGroup, progressAvailable, search, appIdStr,
}: {
  groups: GroupInfo[];
  groupMode: GroupMode;
  onGroupModeChange: (m: GroupMode) => void;
  expandedGroups: Set<string>;
  onToggleGroup: (title: string) => void;
  progressAvailable: boolean;
  search: string;
  appIdStr?: string;
}) {
  if (import.meta.env.DEV && groups.length > 0) {
    const total = groups.reduce((s, g) => s + g.totalCount, 0);
    console.debug(`[ACH][GROUPS] mode=${groupMode} groups=${groups.length} total=${total}`);
  }

  const showNoResults = groups.length === 0 && search.trim().length > 0;

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Layers className="h-10 w-10 text-(--color-muted)/40" />
        <p className="mt-3 text-sm text-(--color-muted)">
          {showNoResults ? "No achievements match your search." : "No groups available."}
        </p>
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

      {/* Grouped content keyed on groupMode for fade transition */}
      <div key={groupMode} className="space-y-2 lf-tab-panel-in">
        {groups.map((group) => {
          const isExpanded = expandedGroups.has(group.title);
          const groupPercent = group.totalCount > 0 ? Math.round((group.unlockedCount / group.totalCount) * 100) : 0;
          const isStatusGroup = groupMode === "status";

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
                    {isStatusGroup ? (
                      <span className="text-[11px] text-(--color-muted)">
                        {group.totalCount} {group.totalCount === 1 ? "achievement" : "achievements"}
                      </span>
                    ) : (
                      <span className="text-[11px] text-(--color-muted)">
                        {group.unlockedCount} / {group.totalCount}
                      </span>
                    )}
                    {!isStatusGroup && groupPercent > 0 && (
                      <span className="text-[10px] font-medium text-emerald-400/80">
                        &middot; {groupPercent}%
                      </span>
                    )}
                    {group.rarityScore != null && group.rarityScore > 0 && (
                      <span className="text-[10px] text-(--color-muted)/40">
                        &middot; avg {group.rarityScore.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  {!isStatusGroup && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1 flex-1 max-w-[100px] overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-(--color-accent) transition-all duration-500 ease-out"
                          style={{ width: `${groupPercent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </button>

              {/* Smooth collapse/expand */}
              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                  isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  {isExpanded && (
                    <div className="border-t border-(--surface-active-border) p-2 space-y-0.5">
                      {renderGroupAchievements(group.achievements, groupMode, progressAvailable, appIdStr)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderGroupAchievements(list: GameAchievement[], groupMode: GroupMode, progressAvailable: boolean, appIdStr?: string) {
  const result: React.ReactNode[] = [];

  // Rarity groups: sort by rarity ascending inside the tier
  if (groupMode === "rarity") {
    const sorted = [...list].sort((a, b) => {
      const ar = a.rarityPercent ?? 101;
      const br = b.rarityPercent ?? 101;
      if (ar !== br) return ar - br;
      return a.name.localeCompare(b.name);
    });
    for (const ach of sorted) {
      result.push(<AchievementRow key={ach.id} achievement={ach} progressAvailable={progressAvailable} appId={appIdStr} />);
    }
    return result;
  }

  // DLC / Status groups: unlocked first by date desc, then locked by rarity asc
  const unlocked = list.filter((a) => a.unlocked);
  const locked = list.filter((a) => !a.unlocked);

  if (unlocked.length > 0) {
    for (const ach of buildSortedUnlocked(unlocked)) {
      result.push(<AchievementRow key={ach.id} achievement={ach} progressAvailable={progressAvailable} appId={appIdStr} />);
    }
  }
  if (locked.length > 0) {
    for (const ach of buildSortedLocked(locked)) {
      result.push(<AchievementRow key={ach.id} achievement={ach} progressAvailable={progressAvailable} appId={appIdStr} />);
    }
  }

  return result;
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

function AchievementRow({ achievement, progressAvailable, appId }: { achievement: GameAchievement; progressAvailable: boolean; appId?: string }) {
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
        appId={appId}
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
