import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, Heart, Sparkles } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useFavorites } from "../../context/FavoritesContext";
import { getCachedPlaytimeStore } from "../../services/playtimeService";
import { getRecommendedGames } from "../../services/recommendationService";
import { localPathToUrl } from "../../services/gameCacheService";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import { isHttpUrl, isLocalPath } from "../../services/libraryLocalCacheService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";

type Props = {
  onNavigate?: (page: AppPage) => void;
  continuePlayingAppIds: Set<string>;
};

function resolveImageSrc(src: string | undefined): string | undefined {
  if (!src) return undefined;
  if (isHttpUrl(src)) return src;
  if (isLocalPath(src)) return localPathToUrl(src) ?? undefined;
  return src;
}

export default function RecommendedSection({ onNavigate, continuePlayingAppIds }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { favoriteIds, toggleFavorite } = useFavorites();

  const playtimeStore = useMemo(() => getCachedPlaytimeStore(), []);

  const displayGames = useMemo(
    () => getRecommendedGames(libraryGames, favoriteIds, playtimeStore, continuePlayingAppIds, 10),
    [libraryGames, favoriteIds, playtimeStore, continuePlayingAppIds],
  );

  useEffect(() => {
    for (const game of displayGames) {
      if (game.appId) {
        requestGameData(game.appId, LoadPriority.VIEWPORT);
      }
    }
  }, [displayGames]);

  const hasUserData = useMemo(() => {
    if (favoriteIds.size > 0) return true;
    if (playtimeStore) {
      for (const entry of Object.values(playtimeStore.games)) {
        if (entry.totalPlaytimeSeconds > 0) return true;
      }
    }
    return false;
  }, [favoriteIds, playtimeStore]);

  if (displayGames.length === 0 && !hasUserData) {
    return (
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-(--color-text)">
              Recommended for You
            </h2>
            <p className="mt-0.5 text-sm text-(--color-muted)">
              Personalized game suggestions
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-6 py-12 text-center">
          <Sparkles className="mb-3 h-8 w-8 text-(--color-muted)/30" />
          <p className="text-sm text-(--color-muted)">
            Play some games or add favorites to get recommendations.
          </p>
        </div>
      </section>
    );
  }

  if (displayGames.length === 0) return null;

  function scroll(direction: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.round(el.clientWidth * 0.85);
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  }

  function handleOpen(game: LibraryGame) {
    if (game.appId) {
      setSelectedGame(game);
      onNavigate?.("library-game-detail");
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-(--color-text)">
            Recommended for You
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            {hasUserData
              ? "Based on your favorites and playtime"
              : "Popular games you might like"}
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
            const imgSrc = resolveImageSrc(
              game.imageUrl || game.metadata?.header_image || game.metadata?.capsule_image || undefined,
            );

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
                    {imgSrc ? (
                      <AsyncImage
                        src={imgSrc}
                        alt={game.title}
                        className="h-full w-full object-cover transition duration-300 group-hover/card:scale-105"
                        fallback={
                          <div className="flex h-full w-full items-center justify-center bg-white/5">
                            <Sparkles className="h-6 w-6 text-(--color-muted)/40" />
                          </div>
                        }
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white/5">
                        <Sparkles className="h-6 w-6 text-(--color-muted)/40" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (game.appId) toggleFavorite(game.appId);
                      }}
                      className="absolute right-2 top-2 inline-flex cursor-pointer items-center justify-center rounded-lg bg-black/50 p-1.5 text-yellow-400 backdrop-blur-sm transition hover:bg-black/70"
                      title={favoriteIds.has(game.appId!) ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Heart
                        className="h-4 w-4"
                        fill={favoriteIds.has(game.appId!) ? "currentColor" : "none"}
                      />
                    </button>
                  </div>

                  <div className="p-3">
                    <h3 className="line-clamp-1 text-sm font-medium text-(--color-text)">
                      {game.title}
                    </h3>
                    {game.metadata?.genres && game.metadata.genres.length > 0 && (
                      <span className="mt-1 inline-block text-[11px] text-(--color-muted)">
                        {game.metadata.genres.slice(0, 2).join(", ")}
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
