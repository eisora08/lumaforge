import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Heart } from "lucide-react";
import type { StartupSnapshot, SnapshotGame } from "../../services/startupSnapshotService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useFavorites } from "../../context/FavoritesContext";
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

export default function FavoritesSection({ snapshot, onNavigate, excludeAppIds }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { favoriteIds, toggleFavorite } = useFavorites();
  const [mediaUrlMap, setMediaUrlMap] = useState<Record<string, string | null>>({});
  const [titleMap, setTitleMap] = useState<Record<string, string>>({});

  const snapshotGames = useMemo(
    () => snapshot?.library?.games ?? [],
    [snapshot],
  );

  const displayGames = useMemo(() => {
    const exclude = new Set(excludeAppIds ?? []);
    return snapshotGames
      .filter((g) => g.appId && favoriteIds.has(g.appId) && !exclude.has(g.appId))
      .slice(0, 10);
  }, [snapshotGames, favoriteIds, excludeAppIds]);

  useEffect(() => {
    for (const game of displayGames) {
      if (game.appId) {
        requestGameData(game.appId, LoadPriority.VIEWPORT);
      }
    }
  }, [displayGames]);

  // Stable primitive key derived from display games — avoids infinite render loops
  // caused by unstable array references in the useMemo above.
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
      // Batch-resolve canonical names for all displayed games
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
          if (DEBUG_MEDIA_DASH) console.log(`[MEDIA][DASH] section=Favorites appid=${appId} selected=${selection} source=snapshot hasUrl=${!!urls[appId]}`);
        }
        if (DEBUG_NAME_DASH) console.log(`[NAME][DASH] section=Favorites appid=${appId} source=${resolvedTitles[appId]?.source ?? "snapshot"} title=${titles[appId]}`);
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

  if (displayGames.length === 0) {
    return (
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-(--color-text)">
              Favorites
            </h2>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-6 py-12 text-center">
          <Heart className="mb-3 h-8 w-8 text-(--color-muted)/30" />
          <p className="text-sm text-(--color-muted)">No favorite games yet.</p>
        </div>
      </section>
    );
  }

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
            Favorites
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            {displayGames.length} favorite{displayGames.length !== 1 ? "s" : ""}
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

            return (
              <div
                key={"dashboard:favorites:steam:" + game.appId}
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
                            <Heart className="h-6 w-6 text-(--color-muted)/40" />
                          </div>
                        }
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white/5">
                        <Heart className="h-6 w-6 text-(--color-muted)/40" />
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (game.appId) toggleFavorite(game.appId);
                      }}
                      className="absolute right-2 top-2 inline-flex cursor-pointer items-center justify-center rounded-full bg-black/60 px-1.5 py-1 text-rose-400/80 backdrop-blur-sm transition hover:bg-black/80 hover:text-rose-400"
                      title="Remove from favorites"
                    >
                      <Heart className="h-4 w-4" fill="currentColor" />
                    </button>
                  </div>

                  <div className="p-3">
                    <h3 className="line-clamp-1 text-sm font-medium text-(--color-text)">
                      {displayTitle}
                    </h3>
                    {game.installed && (
                      <span className="mt-1 inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                        Installed
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
