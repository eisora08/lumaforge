import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import type { StartupSnapshot, SnapshotGame } from "../../services/startupSnapshotService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { getCachedPlaytimeStore } from "../../services/playtimeService";
import { resolveGameMediaUrl, resolveDashboardTitles, deduplicateByAppId } from "../../services/gameCacheService";

const DEBUG_MEDIA_DASH = false;
const DEBUG_NAME_DASH = false;
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";

type Props = {
  snapshot: StartupSnapshot | null;
  onNavigate?: (page: AppPage) => void;
  excludeAppIds?: string[];
};

function getTopPlayed(
  snapshotGames: SnapshotGame[],
  excludeAppIds?: string[],
): SnapshotGame[] {
  const exclude = new Set(excludeAppIds ?? []);

  const playtimeStore = getCachedPlaytimeStore();
  const playtimeMap: Record<string, number> = {};
  if (playtimeStore) {
    for (const [, entry] of Object.entries(playtimeStore.games)) {
      if (entry.appId) {
        playtimeMap[entry.appId] = entry.totalPlaytimeSeconds;
      }
    }
  }

  const scored = snapshotGames
    .filter((g) => g.appId && !exclude.has(g.appId))
    .map((g) => {
      const totalSeconds = playtimeMap[g.appId!] ?? (g.playtime ? g.playtime * 60 : 0);
      const sessionCount = playtimeStore?.games[`app-${g.appId}`]?.sessions?.length ?? 0;
      return { game: g, totalSeconds, sessionCount };
    })
    .sort((a, b) => {
      if (b.totalSeconds !== a.totalSeconds) return b.totalSeconds - a.totalSeconds;
      if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount;
      return 0;
    });

  return scored.slice(0, 10).map((s) => s.game);
}

export default function TopPlayedSection({ snapshot, onNavigate, excludeAppIds }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const [mediaUrlMap, setMediaUrlMap] = useState<Record<string, string | null>>({});
  const [titleMap, setTitleMap] = useState<Record<string, string>>({});

  const snapshotGames = useMemo(
    () => snapshot?.library?.games ?? [],
    [snapshot],
  );

  const displayGames = useMemo(
    () => getTopPlayed(snapshotGames, excludeAppIds),
    [snapshotGames, excludeAppIds],
  );

  useEffect(() => {
    for (const game of displayGames) {
      if (game.appId) {
        requestGameData(game.appId, LoadPriority.VIEWPORT);
      }
    }
  }, [displayGames]);

  // Stable primitive key derived from displayGames — avoids infinite render loops
  const gameIdsKey = useMemo(
    () => displayGames.map(g => g.appId).filter(Boolean).sort().join(','),
    [displayGames],
  );

  // Resolve media URLs and titles
  useEffect(() => {
    let cancelled = false;
    const ids = gameIdsKey ? gameIdsKey.split(',') : [];
    const gameById = new Map(displayGames.map(g => [g.appId, g]));

    const resolve = async () => {
      const urls: Record<string, string | null> = {};
      const titles: Record<string, string> = {};
      const resolvedTitles = displayGames.length > 0 ? await resolveDashboardTitles(displayGames) : {};
      for (const appId of ids) {
        if (cancelled) break;
        const game = gameById.get(appId);
        if (!game) continue;
        const imgPath = game.media?.landscapePath || game.media?.coverPath || game.media?.backgroundPath;
        urls[appId] = imgPath ? await resolveGameMediaUrl(appId, imgPath) : null;
        titles[appId] = resolvedTitles[appId]?.title ?? game.title;
        if (imgPath && !cancelled) {
          const selection = game.media?.landscapePath ? "landscape" : game.media?.coverPath ? "cover" : "background";
          if (DEBUG_MEDIA_DASH) console.log(`[MEDIA][DASH] section=TopPlayed appid=${appId} selected=${selection} source=snapshot hasUrl=${!!urls[appId]}`);
        }
        if (DEBUG_NAME_DASH) console.log(`[NAME][DASH] section=TopPlayed appid=${appId} source=${resolvedTitles[appId]?.source ?? "snapshot"} title=${titles[appId]}`);
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

  if (displayGames.length === 0) return null;

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

  function formatPlaytime(seconds: number): string {
    if (seconds <= 0) return "";
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    if (rem === 0) return `${hours}h`;
    return `${hours}h ${rem}m`;
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-(--color-text)">
            Top 10 Most Played
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            Your most played games
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
          {deduplicateByAppId(displayGames).map((game) => {
            const imgUrl = game.appId ? (mediaUrlMap[game.appId] ?? null) : null;
            const displayTitle = game.appId ? (titleMap[game.appId] ?? game.title) : game.title;
            const totalSeconds =
              getCachedPlaytimeStore()?.games[`app-${game.appId}`]?.totalPlaytimeSeconds ?? 0;
            const totalStr = formatPlaytime(totalSeconds);

            return (
              <div
                key={"dashboard:topplayed:steam:" + game.appId}
                className="w-[min(75vw,260px)] shrink-0 snap-start sm:w-56"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpen(game)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleOpen(game);
                    }
                  }}
                  className="group/card cursor-pointer overflow-hidden rounded-xl border border-(--surface-active-border) bg-white/[0.02] transition hover:bg-white/[0.04]"
                >
                  <div className="relative aspect-video overflow-hidden">
                    {imgUrl ? (
                      <AsyncImage
                        src={imgUrl}
                        alt={displayTitle}
                        className="h-full w-full object-cover"
                        fallback={
                          <div className="flex h-full w-full items-center justify-center bg-white/5">
                            <Trophy className="h-6 w-6 text-(--color-muted)/40" />
                          </div>
                        }
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white/5">
                        <Trophy className="h-6 w-6 text-(--color-muted)/40" />
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" />
                  </div>

                  <div className="p-3">
                    <h3 className="line-clamp-1 text-sm font-medium text-(--color-text)">
                      {displayTitle}
                    </h3>
                    {totalStr && (
                      <span className="mt-1 inline-block text-[11px] text-(--color-muted)">
                        {totalStr} played
                      </span>
                    )}
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
