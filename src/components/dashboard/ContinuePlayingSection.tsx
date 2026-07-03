import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Clock } from "lucide-react";
import type { StartupSnapshot, SnapshotGame } from "../../services/startupSnapshotService";
import { useGameSession } from "../../context/GameSessionContext";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { resolveGameMediaUrl, resolveDashboardTitles } from "../../services/gameCacheService";
import { getCachedPlaytimeStore } from "../../services/playtimeService";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";

type Props = {
  snapshot: StartupSnapshot | null;
  onNavigate?: (page: AppPage) => void;
  excludeAppId?: string;
};

function getContinueGames(
  snapshotGames: SnapshotGame[],
  sessions: Record<string, { appId?: string; state: string }>,
  excludeAppId?: string,
): SnapshotGame[] {
  const runningAppIds = new Set(
    Object.values(sessions)
      .filter((s) => s.state === "running" && s.appId)
      .map((s) => s.appId),
  );

  const running = snapshotGames.filter((g) => g.appId && runningAppIds.has(g.appId));

  // Build a map of appId -> lastPlayedAt from playtime store
  const playtimeStore = getCachedPlaytimeStore();
  const playtimeLastPlayed: Record<string, number> = {};
  if (playtimeStore) {
    for (const [, entry] of Object.entries(playtimeStore.games)) {
      if (entry.appId && entry.lastPlayedAt) {
        playtimeLastPlayed[entry.appId] = entry.lastPlayedAt * 1000;
      }
    }
  }

  const recent = snapshotGames
    .filter((g) => {
      if (g.lastPlayed) return true;
      if (g.appId && playtimeLastPlayed[g.appId]) return true;
      return false;
    })
    .sort((a, b) => {
      const aPlay = (a.appId ? playtimeLastPlayed[a.appId] : null) ?? (a.lastPlayed ? a.lastPlayed * 1000 : 0);
      const bPlay = (b.appId ? playtimeLastPlayed[b.appId] : null) ?? (b.lastPlayed ? b.lastPlayed * 1000 : 0);
      return bPlay - aPlay;
    });
  const installedFallback = snapshotGames
    .filter((g) => g.installed)
    .sort((a, b) => (b.playtime ?? 0) - (a.playtime ?? 0));

  const seen = new Set<string>();
  if (excludeAppId) seen.add(excludeAppId);
  const result: SnapshotGame[] = [];

  for (const g of [...running, ...recent, ...installedFallback]) {
    if (!g.appId || seen.has(g.appId)) continue;
    seen.add(g.appId);
    result.push(g);
    if (result.length >= 10) break;
  }

  return result;
}

function formatLastPlayed(ts: number | null): string | null {
  if (ts == null) return null;
  const diff = Date.now() - ts * 1000;
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export default function ContinuePlayingSection({ snapshot, onNavigate, excludeAppId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sessions } = useGameSession();
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const [mediaUrlMap, setMediaUrlMap] = useState<Record<string, string | null>>({});
  const [titleMap, setTitleMap] = useState<Record<string, string>>({});

  const games = useMemo(
    () => getContinueGames(snapshot?.library?.games || [], sessions, excludeAppId),
    [snapshot, sessions, excludeAppId],
  );

  useEffect(() => {
    for (const game of games) {
      if (game.appId) {
        requestGameData(game.appId, LoadPriority.VIEWPORT);
      }
    }
  }, [games]);

  // Stable primitive key derived from games — avoids infinite render loops
  // caused by unstable array references in the useMemo above.
  const gameIdsKey = useMemo(
    () => games.map(g => g.appId).filter(Boolean).sort().join(','),
    [games],
  );

  // Resolve media URLs and titles
  useEffect(() => {
    let cancelled = false;
    const ids = gameIdsKey ? gameIdsKey.split(',') : [];
    const gameById = new Map(games.map(g => [g.appId, g]));

    const resolve = async () => {
      const urls: Record<string, string | null> = {};
      const titles: Record<string, string> = {};
      const resolvedTitles = games.length > 0 ? await resolveDashboardTitles(games) : {};
      for (const appId of ids) {
        if (cancelled) break;
        const game = gameById.get(appId);
        if (!game) continue;
        const imgPath = game.media?.landscapePath || game.media?.backgroundPath;
        urls[appId] = imgPath ? await resolveGameMediaUrl(appId, imgPath) : null;
        titles[appId] = resolvedTitles[appId]?.title ?? game.title;
        if (imgPath && !cancelled) {
          const selection = game.media?.landscapePath ? "landscape" : "background";
          console.log(`[MEDIA][DASH] section=ContinuePlaying appid=${appId} selected=${selection} source=snapshot hasUrl=${!!urls[appId]}`);
        }
        console.log(`[NAME][DASH] section=ContinuePlaying appid=${appId} source=${resolvedTitles[appId]?.source ?? "snapshot"} title=${titles[appId]}`);
      }
      if (cancelled) return;
      setMediaUrlMap(prev => {
        if (Object.keys(prev).length === Object.keys(urls).length &&
            Object.entries(urls).every(([k, v]) => prev[k] === v)) return prev;
        return urls;
      });
      setTitleMap(prev => {
        if (Object.keys(prev).length === Object.keys(titles).length &&
            Object.entries(titles).every(([k, v]) => prev[k] === v)) return prev;
        return titles;
      });
    };
    resolve();
    return () => { cancelled = true; };
  }, [gameIdsKey]);

  if (games.length === 0) return null;

  function scroll(direction: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.round(el.clientWidth * 0.85);
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  }

  function handleOpen(game: SnapshotGame) {
    if (game.appId) {
      const libGame = libraryGames.find((g) => g.appId === game.appId);
      if (libGame) {
        setSelectedGame(libGame);
        onNavigate?.("library-game-detail");
      }
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-(--color-text)">
            Continue Playing
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            Jump back into your games
          </p>
        </div>
      </div>

      <div className="group/row relative">
        <button
          type="button"
          onClick={() => scroll("left")}
          className="absolute -left-2 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-xl backdrop-blur transition hover:bg-black/80 group-hover/row:flex"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div
          ref={scrollRef}
          className="flex snap-x gap-4 overflow-x-auto scroll-smooth pb-2 scrollbar-none"
        >
          {games.map((game) => {
            const imgUrl = game.appId ? (mediaUrlMap[game.appId] ?? null) : null;
            const displayTitle = game.appId ? (titleMap[game.appId] ?? game.title) : game.title;
            const lastPlayedStr = formatLastPlayed(game.lastPlayed);
            const isRunning = Object.values(sessions).some(
              (s) => s.state === "running" && s.appId === game.appId,
            );

            return (
              <div
                key={game.appId}
                className="w-[min(80vw,340px)] shrink-0 snap-start"
              >
                <div className="group/card relative cursor-pointer overflow-hidden rounded-xl border border-(--surface-active-border) bg-white/[0.02] transition hover:bg-white/[0.04]">
                  <div className="relative aspect-video overflow-hidden">
                    {imgUrl ? (
                      <AsyncImage
                        src={imgUrl}
                        alt={displayTitle}
                        className="h-full w-full object-cover"
                        fallback={
                          <div className="flex h-full w-full items-center justify-center bg-white/5">
                            <Clock className="h-6 w-6 text-(--color-muted)/40" />
                          </div>
                        }
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white/5">
                        <Clock className="h-6 w-6 text-(--color-muted)/40" />
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" />
                    {isRunning && (
                      <div className="absolute left-2 top-2 rounded-full bg-emerald-500/80 px-2 py-0.5 text-[10px] font-medium text-black backdrop-blur-sm">
                        Playing
                      </div>
                    )}
                  </div>

                  <div className="p-3">
                    <h3 className="line-clamp-1 text-sm font-medium text-(--color-text)">
                      {displayTitle}
                    </h3>
                    <div className="mt-1.5 flex items-center gap-2">
                      {lastPlayedStr && (
                        <span className="text-[11px] text-(--color-muted)">
                          {lastPlayedStr}
                        </span>
                      )}
                      {game.playtime != null && (
                        <span className="text-[11px] text-(--color-muted)">
                          {game.playtime}m
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleOpen(game)}
                      className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent)/10 px-3 py-1.5 text-xs font-medium text-(--color-accent) transition hover:bg-(--color-accent)/20"
                    >
                      <Play className="h-3 w-3" />
                      Play
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => scroll("right")}
          className="absolute -right-2 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-xl backdrop-blur transition hover:bg-black/80 group-hover/row:flex"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </section>
  );
}
