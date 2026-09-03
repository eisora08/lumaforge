import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  Award, Trophy, RefreshCw, Search, ChevronRight,
} from "lucide-react";
import { useLibraryGames } from "../context/LibraryGamesContext";
import { useSettings } from "../context/SettingsContext";
import { achievementStore } from "../services/achievementStore";
import { resolveSteamAchievements } from "../services/steamAchievementsResolver";
import { achievementImageQueue, resolveImageSource, isResolvedUrl, nextGenerationId } from "../services/achievementImageQueue";
import AchievementsModal from "../components/library/AchievementsModal";
import type { LibraryGame } from "../types/libraryGame";
import type { GameAchievementsSummary } from "../types/gameAchievements";

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

function resolveGameIconUrl(appId: string | undefined, game?: LibraryGame): string | undefined {
  if (!appId) return undefined;
  // Epic/manual/debrid games: use the game's own imageUrl
  if (game?.source && game.source !== "steam") {
    return game.imageUrl;
  }
  return `${STEAM_CDN}/${appId}/${appId}.jpg`;
}

/**
 * Given the composite-keyed map from getAllSummaries(), produce an appId-keyed map
 * with one entry per game — the summary with the most unlocks (ties favor no-platform suffix).
 */
function deduplicateByAppId(
  compositeMap: Map<string, GameAchievementsSummary>,
): Map<string, GameAchievementsSummary> {
  const result = new Map<string, GameAchievementsSummary>();
  for (const [key, summary] of compositeMap) {
    const colonIdx = key.indexOf(":");
    const appId = colonIdx > 0 ? key.slice(0, colonIdx) : key;
    const hasPlatform = colonIdx > 0;
    const existing = result.get(appId);
    if (!existing) {
      result.set(appId, summary);
      continue;
    }
    // Prefer higher unlock count
    const incomingUnlocked = summary.unlocked ?? 0;
    const existingUnlocked = existing.unlocked ?? 0;
    if (incomingUnlocked > existingUnlocked) {
      result.set(appId, summary);
    } else if (incomingUnlocked === existingUnlocked && !hasPlatform) {
      // Tie-break: prefer the no-platform-suffix entry (platform-unknown = authoritative)
      result.set(appId, summary);
    }
  }
  return result;
}

export default function Achievements() {
  const { games } = useLibraryGames();
  const { settings } = useSettings();

  const [storeSummaries, setStoreSummaries] = useState<Map<string, GameAchievementsSummary>>(new Map());
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  const [selectedGame, setSelectedGame] = useState<LibraryGame | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<GameAchievementsSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  // Subscribe to store for reactive updates
  useEffect(() => {
    setStoreSummaries(deduplicateByAppId(achievementStore.getAllSummaries()));
    const unsub = achievementStore.subscribe((appId, summary, _platform) => {
      setStoreSummaries((prev) => {
        const next = new Map(prev);
        const existing = next.get(appId);
        // Only overwrite if the new summary has more unlocks (or prev is empty)
        if (!existing || (summary.unlocked ?? 0) > (existing.unlocked ?? 0)) {
          next.set(appId, summary);
        }
        return next;
      });
    });
    return unsub;
  }, []);

  // Filter to games with achievements support or Steam source
  const achievementGames = useMemo(() => {
    return games
      .filter((g) => g.appId && (g.achievementsSupported || g.source === "steam"))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [games]);

  // Filter by search
  const filteredGames = useMemo(() => {
    if (!search.trim()) return achievementGames;
    const q = search.toLowerCase();
    return achievementGames.filter((g) => g.title.toLowerCase().includes(q));
  }, [achievementGames, search]);

  // Aggregate stats
  const stats = useMemo(() => {
    let totalUnlocked = 0;
    let totalAchievements = 0;
    let gamesWithProgress = 0;
    for (const [, summary] of storeSummaries) {
      if (summary.progressAvailable && summary.total > 0) {
        totalUnlocked += summary.unlocked ?? 0;
        totalAchievements += summary.total;
        gamesWithProgress++;
      }
    }
    return { totalUnlocked, totalAchievements, gamesWithProgress, totalGames: achievementGames.length };
  }, [storeSummaries, achievementGames.length]);

  // Resolve achievements for a game if not in store
  const ensureResolved = useCallback(async (game: LibraryGame) => {
    const appId = game.appId!;
    if (storeSummaries.has(appId)) return;
    if (resolving.has(appId)) return;

    setResolving((prev) => new Set(prev).add(appId));
    try {
      const summary = await resolveSteamAchievements({
        appId: Number(appId),
        steamWebApiKey: settings.steamWebApiKey || undefined,
        steamId64: settings.steamId64 || undefined,
        accountId: settings.steamAccountId || undefined,
        steamPath: settings.steamRoot || undefined,
        steamAchievementsEnabled: settings.steamAchievementsEnabled,
        achievementSchemaPath: settings.achievementSchemaPath || undefined,
      });
      achievementStore.setSummary(appId, summary);
      setStoreSummaries((prev) => {
        const next = new Map(prev);
        next.set(appId, summary);
        return next;
      });
    } catch (err) {
      console.warn(`[ACH][PAGE] resolve failed appid=${appId} reason=${err}`);
    } finally {
      setResolving((prev) => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
    }
  }, [storeSummaries, resolving, settings]);

  // Open game in modal
  const handleOpenGame = useCallback(async (game: LibraryGame) => {
    const appId = game.appId!;
    const summary = storeSummaries.get(appId);
    if (summary) {
      setSelectedGame(game);
      setSelectedSummary(summary);
    } else {
      setSelectedGame(game);
      setSelectedSummary(null);
      await ensureResolved(game);
      const resolved = achievementStore.getSummary(appId);
      setSelectedSummary(resolved ?? null);
    }
  }, [storeSummaries, ensureResolved]);

  const handleRefreshModal = useCallback(async () => {
    if (!selectedGame?.appId) return;
    setRefreshing(true);
    try {
      const summary = await resolveSteamAchievements({
        appId: Number(selectedGame.appId),
        steamWebApiKey: settings.steamWebApiKey || undefined,
        steamId64: settings.steamId64 || undefined,
        accountId: settings.steamAccountId || undefined,
        steamPath: settings.steamRoot || undefined,
        steamAchievementsEnabled: settings.steamAchievementsEnabled,
        achievementSchemaPath: settings.achievementSchemaPath || undefined,
        forceRefresh: true,
      });
      achievementStore.setSummary(selectedGame.appId, summary);
      setSelectedSummary(summary);
    } catch (err) {
      console.warn(`[ACH][PAGE] refresh failed appid=${selectedGame.appId} reason=${err}`);
    } finally {
      setRefreshing(false);
    }
  }, [selectedGame, settings]);

  return (
    <div className="flex h-full flex-col lf-page-in">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-6">
          {/* Header */}
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/15 bg-(--color-accent)/8 px-3 py-1 text-xs text-(--color-accent)">
              <Award className="h-3.5 w-3.5" />
              Achievements
            </div>
            <h1 className="text-3xl font-bold text-(--color-text)">Logros</h1>
            <p className="mt-1 text-sm text-(--color-muted)">
              Achievement progress across your Steam library.
            </p>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
              <p className="text-[10px] font-medium uppercase tracking-wider text-(--color-muted)">Games</p>
              <p className="mt-1 text-2xl font-bold text-(--color-text)">{stats.totalGames}</p>
            </div>
            <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
              <p className="text-[10px] font-medium uppercase tracking-wider text-(--color-muted)">With Progress</p>
              <p className="mt-1 text-2xl font-bold text-(--color-text)">{stats.gamesWithProgress}</p>
            </div>
            <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
              <p className="text-[10px] font-medium uppercase tracking-wider text-(--color-muted)">Unlocked</p>
              <p className="mt-1 text-2xl font-bold text-emerald-400">{stats.totalUnlocked}</p>
            </div>
            <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
              <p className="text-[10px] font-medium uppercase tracking-wider text-(--color-muted)">Total</p>
              <p className="mt-1 text-2xl font-bold text-(--color-text)">{stats.totalAchievements}</p>
            </div>
          </div>

          {/* Search */}
          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted)" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search games..."
              className="h-9 w-full rounded-xl border border-(--surface-active-border) bg-white/5 pl-10 pr-3 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent) transition"
              aria-label="Search games"
            />
          </div>

          {/* Game list */}
          {filteredGames.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Trophy className="h-12 w-12 text-(--color-muted)/40" />
              <p className="mt-3 text-sm text-(--color-muted)">
                {search ? "No games match your search." : "No games with achievements found."}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredGames.map((game) => (
                <GameAchievementCard
                  key={game.id}
                  game={game}
                  summary={storeSummaries.get(game.appId!) ?? null}
                  isResolving={resolving.has(game.appId!)}
                  onOpen={() => handleOpenGame(game)}
                  onResolve={() => ensureResolved(game)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Achievements Modal */}
      {selectedGame && selectedSummary && (
        <AchievementsModal
          summary={selectedSummary}
          appIdStr={selectedGame.appId}
          gameTitle={selectedGame.title}
          gameIconUrl={resolveGameIconUrl(selectedGame.appId, selectedGame)}
          onClose={() => { setSelectedGame(null); setSelectedSummary(null); }}
          onRefresh={handleRefreshModal}
          refreshing={refreshing}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Game Achievement Card                                              */
/* ------------------------------------------------------------------ */

function GameAchievementCard({
  game, summary, isResolving, onOpen, onResolve,
}: {
  game: LibraryGame;
  summary: GameAchievementsSummary | null;
  isResolving: boolean;
  onOpen: () => void;
  onResolve: () => void;
}) {
  const appId = game.appId!;
  const genRef = useRef(nextGenerationId(appId, "achievements-page"));

  // Try to use summary first, fall back to game-level fields
  const unlocked = summary?.unlocked ?? game.achievementUnlocked ?? 0;
  const total = summary?.total ?? game.achievementTotal ?? 0;
  const progressAvailable = summary?.progressAvailable ?? false;
  const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0;
  const hasData = summary || (game.achievementUnlocked != null && game.achievementTotal != null);

  // Enqueue image
  useEffect(() => {
    if (!summary?.achievements?.length) return;
    const generationId = genRef.current;
    const items: import("../services/achievementImageQueue").ImageQueueItem[] = [];
    for (const a of summary.achievements) {
      if (a.iconUrl && !isResolvedUrl(a.iconUrl)) {
        const resolved = resolveImageSource(a.iconUrl, appId, "icon");
        if (resolved) items.push({ appId, apiName: a.apiName, ...resolved, type: "icon", priority: "low", caller: "user-request", createdAt: Date.now(), generationId });
      }
      if (a.iconGrayUrl && !isResolvedUrl(a.iconGrayUrl)) {
        const resolved = resolveImageSource(a.iconGrayUrl, appId, "icon_gray");
        if (resolved) items.push({ appId, apiName: a.apiName, ...resolved, type: "icon_gray", priority: "low", caller: "user-request", createdAt: Date.now(), generationId });
      }
    }
    if (items.length > 0) {
      achievementImageQueue.enqueue(items);
    }
  }, [summary?.achievements, appId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  }, [onOpen]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      className="flex w-full cursor-pointer items-center gap-4 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3 text-left transition hover:bg-white/[0.04] hover:border-(--color-accent)/20"
    >
      {/* Game icon */}
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10">
        {game.imageUrl ? (
          <img src={game.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Trophy className="h-5 w-5 text-(--color-muted)/40" />
          </div>
        )}
      </div>

      {/* Game info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-(--color-text) truncate">{game.title}</span>
          {isResolving && (
            <RefreshCw className="h-3 w-3 shrink-0 animate-spin text-(--color-muted)" />
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-(--color-muted)/60">
          <span>App {appId}</span>
          {game.achievementsSupported === false && (
            <span className="text-amber-400/60">(achievements not confirmed)</span>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="shrink-0 flex flex-col items-end gap-1">
        {progressAvailable && total > 0 ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold tabular-nums text-(--color-text)">
                {percent}%
              </span>
              <span className="text-[10px] text-(--color-muted)">
                {unlocked}/{total}
              </span>
            </div>
            <div className="h-1 w-24 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-(--color-accent) transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          </>
        ) : hasData && total > 0 ? (
          <span className="text-xs text-(--color-muted)/60">{unlocked}/{total}</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onResolve(); }}
              className="text-[10px] font-medium text-(--color-accent) hover:underline"
            >
              Load
            </button>
            <span className="text-[10px] text-(--color-muted)/40">no data</span>
          </div>
        )}
      </div>

      {/* Arrow */}
      <ChevronRight className="h-4 w-4 shrink-0 text-(--color-muted)/30" />
    </div>
  );
}
