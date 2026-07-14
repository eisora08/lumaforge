import { useEffect, useMemo, useState } from "react";
import { Heart } from "lucide-react";
import type { StartupSnapshot } from "../../services/startupSnapshotService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useFavorites } from "../../context/FavoritesContext";
import { useSettings } from "../../context/SettingsContext";
import { resolveProviderMediaPreviewUrl, resolveGameMediaUrl } from "../../services/gameCacheService";
import {
  type DashboardDisplayGame,
  snapshotToDisplayGame,
  manualToDisplayGame,
  getManualGamesForDashboard,
} from "../../services/dashboardManualGames";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";
import DashboardHorizontalRail from "./DashboardHorizontalRail";

type Props = {
  snapshot: StartupSnapshot | null;
  onNavigate?: (page: AppPage) => void;
  excludeAppIds?: string[];
};

export default function FavoritesSection({ snapshot, onNavigate, excludeAppIds }: Props) {
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { settings } = useSettings();
  const [mediaUrlMap, setMediaUrlMap] = useState<Record<string, string | null>>({});

  const manualGames = useMemo(() => getManualGamesForDashboard(libraryGames), [libraryGames]);

  const displayGames = useMemo(() => {
    const exclude = new Set(excludeAppIds ?? []);
    const result: DashboardDisplayGame[] = [];
    const seen = new Set<string>();

    // Snapshot games that are favorited
    for (const sg of (snapshot?.library?.games ?? [])) {
      if (!sg.appId || exclude.has(sg.appId) || seen.has(sg.appId)) continue;
      if (!favoriteIds.has(sg.appId)) continue;
      seen.add(sg.appId);
      result.push(snapshotToDisplayGame(sg as any, new Set()));
    }

    // Manual games that are favorited
    for (const mg of manualGames) {
      const favKey = mg.libraryId || mg.id;
      if (seen.has(favKey)) continue;
      if (!favoriteIds.has(favKey)) continue;
      seen.add(favKey);
      const fakeLibGame = { ...mg, source: "manual" as const, libraryId: mg.libraryId } as any;
      result.push(manualToDisplayGame(fakeLibGame, new Set()));
    }

    return result.slice(0, 10);
  }, [snapshot, manualGames, favoriteIds, excludeAppIds]);

  useEffect(() => {
    for (const game of displayGames) {
      if (game.appId) {
        requestGameData(game.appId, LoadPriority.VIEWPORT);
      }
    }
  }, [displayGames]);

  const displayIdsKey = useMemo(
    () => displayGames.map(g => g.stableId).sort().join(','),
    [displayGames],
  );

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const urls: Record<string, string | null> = {};
      for (const game of displayGames) {
        if (cancelled) break;
        if (game._snapshotGame) {
          const m = game._snapshotGame.media;
          const imgPath = m?.landscapePath || m?.coverPath || m?.backgroundPath;
          urls[game.stableId] = (game.appId && imgPath)
            ? await resolveGameMediaUrl(game.appId, imgPath)
            : null;
        } else if (game._libraryGame) {
          const rawPath = game._libraryGame.imageUrl;
          urls[game.stableId] = rawPath ? await resolveProviderMediaPreviewUrl(rawPath) : null;
        } else {
          urls[game.stableId] = null;
        }
      }
      if (cancelled) return;
      setMediaUrlMap(prev => {
        if (Object.keys(prev).length === Object.keys(urls).length &&
            Object.entries(urls).every(([k, v]) => prev[k] === v)) return prev;
        return urls;
      });
    };
    resolve();
    return () => { cancelled = true; };
  }, [displayIdsKey]);

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

  function handleOpen(game: DashboardDisplayGame) {
    if (game._libraryGame) {
      setSelectedGame(game._libraryGame);
      onNavigate?.("library-game-detail");
    } else if (game.appId) {
      const libGame = libraryGames.find((g) => g.appId === game.appId);
      if (libGame) {
        setSelectedGame(libGame);
        onNavigate?.("library-game-detail");
      }
    }
  }

  function handleToggleFavorite(game: DashboardDisplayGame) {
    const fk = game.appId || game.libraryId || game.stableId;
    if (fk) toggleFavorite(fk);
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

      <DashboardHorizontalRail gap={settings.dashboardGridGap}>
        {displayGames.map((game) => {
          const imgUrl = mediaUrlMap[game.stableId] ?? null;

          return (
            <div
              key={"dashboard:favorites:" + game.stableId}
              className="shrink-0 snap-start"
              style={{ width: `min(75vw, ${settings.dashboardCardSize}px)` }}
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
                      alt={game.title}
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
                  {game.installed && (
                    <span className="absolute left-2 top-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 backdrop-blur-sm">
                      Installed
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFavorite(game);
                    }}
                    className="absolute right-2 top-2 inline-flex cursor-pointer items-center justify-center rounded-full bg-black/60 px-1.5 py-1 text-rose-400/80 backdrop-blur-sm transition hover:bg-black/80 hover:text-rose-400"
                    title="Remove from favorites"
                  >
                    <Heart className="h-4 w-4" fill="currentColor" />
                  </button>
                </div>

                <div className="p-3">
                  <h3 className="line-clamp-1 text-sm font-medium text-(--color-text)">
                    {game.title}
                  </h3>
                </div>
              </div>
            </div>
          );
        })}
      </DashboardHorizontalRail>
    </section>
  );
}
