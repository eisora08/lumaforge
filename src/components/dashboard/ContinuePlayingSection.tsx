import { useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, Play, Clock } from "lucide-react";
import type { StartupSnapshot, SnapshotGame } from "../../services/startupSnapshotService";
import { useGameSession } from "../../context/GameSessionContext";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { localPathToUrl } from "../../services/gameCacheService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";

type Props = {
  snapshot: StartupSnapshot | null;
  onNavigate?: (page: AppPage) => void;
};

function getContinueGames(
  snapshotGames: SnapshotGame[],
  sessions: Record<string, { appId?: string; state: string }>,
): SnapshotGame[] {
  const runningAppIds = new Set(
    Object.values(sessions)
      .filter((s) => s.state === "running" && s.appId)
      .map((s) => s.appId),
  );

  const running = snapshotGames.filter((g) => g.appId && runningAppIds.has(g.appId));
  const recent = snapshotGames
    .filter((g) => g.lastPlayed)
    .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));

  const seen = new Set<string>();
  const result: SnapshotGame[] = [];

  for (const g of [...running, ...recent]) {
    if (!g.appId || seen.has(g.appId)) continue;
    seen.add(g.appId);
    result.push(g);
    if (result.length >= 6) break;
  }

  return result;
}

export default function ContinuePlayingSection({ snapshot, onNavigate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sessions } = useGameSession();
  const { games: libraryGames, setSelectedGame } = useLibraryGames();

  const games = useMemo(
    () => getContinueGames(snapshot?.library?.games || [], sessions),
    [snapshot, sessions],
  );

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
            const imgPath = game.media?.landscapePath || game.media?.backgroundPath;
            const imgUrl = imgPath ? localPathToUrl(imgPath) : null;
            const lastPlayedStr =
              game.lastPlayed != null
                ? new Date(game.lastPlayed * 1000).toLocaleDateString()
                : null;

            return (
              <div
                key={game.appId}
                className="w-[min(80vw,340px)] shrink-0 snap-start"
              >
                <div className="group/card relative overflow-hidden rounded-xl border border-(--surface-active-border) bg-white/[0.02] transition hover:bg-white/[0.04]">
                  <div className="aspect-video overflow-hidden">
                    {imgUrl ? (
                      <AsyncImage
                        src={imgUrl}
                        alt={game.title}
                        className="h-full w-full object-cover transition duration-300 group-hover/card:scale-105"
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
                  </div>

                  <div className="p-3">
                    <h3 className="line-clamp-1 text-sm font-medium text-(--color-text)">
                      {game.title}
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
