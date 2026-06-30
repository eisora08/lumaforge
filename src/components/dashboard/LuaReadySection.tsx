import { useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, FileCode2, Package, Download } from "lucide-react";
import { getCachedSourceAvailabilityIndex } from "../../services/sourceAvailabilityCacheService";
import type { SourceAvailabilityGameEntry } from "../../services/sourceAvailabilityCacheService";
import { getCachedSnapshot } from "../../services/startupSnapshotService";
import type { SnapshotGame } from "../../services/startupSnapshotService";
import { localPathToUrl } from "../../services/gameCacheService";
import AsyncImage from "../common/AsyncImage";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import type { AppPage } from "../../types/navigation";

type Props = {
  onNavigate?: (page: AppPage) => void;
};

type LuaReadyEntry = {
  game: SnapshotGame;
  srcEntry: SourceAvailabilityGameEntry;
};

export default function LuaReadySection({ onNavigate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sourceIndex = getCachedSourceAvailabilityIndex();
  const snapshot = getCachedSnapshot();
  const { games: libraryGames, setSelectedGame } = useLibraryGames();

  const luaEntries = useMemo(() => {
    if (!sourceIndex || !snapshot) return [];
    const snapshotGames = snapshot.library.games;
    const snapshotMap = new Map(snapshotGames.map((g) => [g.appId, g]));

    const entries: LuaReadyEntry[] = [];
    for (const srcEntry of Object.values(sourceIndex.games)) {
      if (!srcEntry.luaReady || srcEntry.sourceCount <= 0) continue;
      const game = snapshotMap.get(srcEntry.appId);
      if (!game) continue;
      entries.push({ game, srcEntry });
    }

    entries.sort((a, b) => (b.srcEntry.updatedAt || 0) - (a.srcEntry.updatedAt || 0));
    return entries.slice(0, 10);
  }, [sourceIndex, snapshot]);

  if (luaEntries.length === 0) return null;

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
          {luaEntries.map(({ game, srcEntry }) => {
            const imgPath = game.media?.landscapePath || game.media?.coverPath;
            const imgUrl = imgPath ? localPathToUrl(imgPath) : null;
            const srcCount = srcEntry.sourceCount;
            const providerName =
              srcEntry.availableSources?.[0]?.name || "HubcapDB";
            const pkgType = srcEntry.availableSources?.[0]?.type || "zip";

            return (
              <div
                key={game.appId}
                className="w-52 shrink-0 snap-start sm:w-56"
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
                            <FileCode2 className="h-6 w-6 text-(--color-muted)/40" />
                          </div>
                        }
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white/5">
                        <FileCode2 className="h-6 w-6 text-(--color-muted)/40" />
                      </div>
                    )}
                  </div>

                  <div className="p-3">
                    <h3 className="line-clamp-1 text-xs font-medium text-(--color-text)">
                      {game.title}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-(--color-muted)">
                      <span className="inline-flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        {srcCount} src
                      </span>
                      <span>&middot;</span>
                      <span>{providerName}</span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase">
                        .{pkgType}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpen(game);
                      }}
                      className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded-lg bg-(--color-accent)/10 px-2.5 py-1 text-[11px] font-medium text-(--color-accent) transition hover:bg-(--color-accent)/20"
                    >
                      <Download className="h-3 w-3" />
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
