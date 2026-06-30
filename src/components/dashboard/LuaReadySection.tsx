import { useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, FileCode2, Package } from "lucide-react";
import { getCachedSourceAvailabilityIndex } from "../../services/sourceAvailabilityCacheService";
import { getCachedSnapshot } from "../../services/startupSnapshotService";
import type { SnapshotGame } from "../../services/startupSnapshotService";
import { localPathToUrl } from "../../services/gameCacheService";
import AsyncImage from "../common/AsyncImage";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import type { AppPage } from "../../types/navigation";

type Props = {
  onNavigate?: (page: AppPage) => void;
};

export default function LuaReadySection({ onNavigate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sourceIndex = getCachedSourceAvailabilityIndex();
  const snapshot = getCachedSnapshot();
  const { games: libraryGames, setSelectedGame } = useLibraryGames();

  const luaGames = useMemo(() => {
    if (!sourceIndex || !snapshot) return [];
    const snapshotGames = snapshot.library.games;
    const luaReadyAppIds = new Set(
      Object.values(sourceIndex.games)
        .filter((g) => g.luaReady && g.sourceCount > 0)
        .map((g) => g.appId),
    );
    return snapshotGames.filter((g) => g.appId && luaReadyAppIds.has(g.appId)).slice(0, 8);
  }, [sourceIndex, snapshot]);

  if (luaGames.length === 0) return null;

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
      } else {
        onNavigate?.("store");
      }
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-(--color-text)">
            Ready to Mod
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            Games with available Lua packages
          </p>
        </div>
        <button
          onClick={() => onNavigate?.("store")}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
        >
          Browse All
        </button>
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
          {luaGames.map((game) => {
            const imgPath = game.media?.coverPath || game.media?.landscapePath;
            const imgUrl = imgPath ? localPathToUrl(imgPath) : null;
            const srcEntry = sourceIndex?.games[game.appId!];
            const srcCount = srcEntry?.sourceCount || 0;
            const providerName =
              srcEntry?.availableSources?.[0]?.name || "HubcapDB";

            return (
              <div
                key={game.appId}
                className="w-44 shrink-0 snap-start sm:w-48"
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
                  <div className="aspect-[3/4] overflow-hidden">
                    {imgUrl ? (
                      <AsyncImage
                        src={imgUrl}
                        alt={game.title}
                        className="h-full w-full object-cover transition duration-300 group-hover/card:scale-105"
                        fallback={
                          <div className="flex h-full w-full items-center justify-center bg-white/5">
                            <FileCode2 className="h-6 w-6 text-(--color-accent)/40" />
                          </div>
                        }
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white/5">
                        <FileCode2 className="h-6 w-6 text-(--color-accent)/40" />
                      </div>
                    )}
                  </div>

                  <div className="p-2.5">
                    <h3 className="line-clamp-1 text-xs font-medium text-(--color-text)">
                      {game.title}
                    </h3>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-(--color-muted)">
                      <Package className="h-3 w-3" />
                      {srcCount} source{srcCount !== 1 ? "s" : ""} &middot;{" "}
                      {providerName}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpen(game);
                      }}
                      className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded-lg bg-purple-500/10 px-2.5 py-1 text-[11px] font-medium text-purple-300 transition hover:bg-purple-500/20"
                    >
                      <Package className="h-3 w-3" />
                      Get Package
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
