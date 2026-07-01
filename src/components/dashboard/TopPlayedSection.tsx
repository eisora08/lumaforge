import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import type { StartupSnapshot, SnapshotGame } from "../../services/startupSnapshotService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { getCachedPlaytimeStore } from "../../services/playtimeService";
import { localPathToUrl } from "../../services/gameCacheService";
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

  const snapshotGames = snapshot?.library?.games || [];

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
          {displayGames.map((game) => {
            const imgPath = game.media?.landscapePath || game.media?.coverPath || game.media?.backgroundPath;
            const imgUrl = imgPath ? localPathToUrl(imgPath) : null;
            const totalSeconds =
              getCachedPlaytimeStore()?.games[`app-${game.appId}`]?.totalPlaytimeSeconds ?? 0;
            const totalStr = formatPlaytime(totalSeconds);

            return (
              <div
                key={game.appId}
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
                  <div className="aspect-video overflow-hidden">
                    {imgUrl ? (
                      <AsyncImage
                        src={imgUrl}
                        alt={game.title}
                        className="h-full w-full object-cover transition duration-300 group-hover/card:scale-105"
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
                  </div>

                  <div className="p-3">
                    <h3 className="line-clamp-1 text-sm font-medium text-(--color-text)">
                      {game.title}
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
