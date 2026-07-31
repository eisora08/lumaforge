import { useEffect, useMemo, useState } from "react";
import { Heart } from "lucide-react";
import type { StartupSnapshot } from "../../services/startupSnapshotService";
import type { LibraryGame } from "../../types/libraryGame";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useFavorites } from "../../context/FavoritesContext";
import { useSettings } from "../../context/SettingsContext";
import { resolveProviderMediaPreviewUrl, resolveGameMediaUrl, getFavoriteKey } from "../../services/gameCacheService";
import {
  type DashboardDisplayGame,
  snapshotToDisplayGame,
  getCardImageCandidate,
  getIconCandidate,
  resolveCanonicalGameIdentity,
} from "../../services/dashboardManualGames";
import { resolvePlaytimeKey, getPlaytimeEntryByGameKey } from "../../services/playtimeService";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";
import DashboardHorizontalRail from "./DashboardHorizontalRail";

const DEBUG_DASHBOARD_MEDIA = false;

type Props = {
  snapshot: StartupSnapshot | null;
  onNavigate?: (page: AppPage) => void;
  excludeAppIds?: string[];
  maxItems?: number;
};

export default function FavoritesSection({ snapshot, onNavigate, excludeAppIds, maxItems }: Props) {
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { settings } = useSettings();
  const [mediaUrlMap, setMediaUrlMap] = useState<Record<string, string | null>>({});

  // Build a DashboardDisplayGame directly from a canonical LibraryGame.
  // Replaces manualToDisplayGame for Epic/manual favorites — no intermediary needed.
  function buildFavoriteDisplayGame(game: LibraryGame): DashboardDisplayGame {
    const ptKey = resolvePlaytimeKey(game);
    const ptEntry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
    return {
      stableId: game.libraryId || game.id,
      libraryId: game.libraryId,
      source: game.source ?? "manual",
      title: game.title,
      imageUrl: null, // resolved async by media effect below
      iconUrl: getIconCandidate(game),
      totalPlaytimeSeconds: ptEntry?.totalPlaytimeSeconds ?? 0,
      lastPlayedAt: ptEntry?.lastPlayedAt ?? null,
      isRunning: false,
      installed: game.isInstalled ?? true,
      playable: game.isPlayable,
      updatedAt: 0,
      _libraryGame: game,
      _rolePaths: {
        backgroundPath: game.backgroundPath ?? null,
        landscapePath: game.landscapePath ?? null,
        coverPath: game.coverPath ?? null,
        logoPath: game.logoPath ?? null,
        iconPath: game.iconPath ?? null,
      },
    };
  }

  const displayGames = useMemo(() => {
    const exclude = new Set(excludeAppIds ?? []);
    const result: DashboardDisplayGame[] = [];
    const seen = new Set<string>();

    // Build canonical identity → LibraryGame lookup from ALL libraryGames.
    // Multiple keys per game ensure any favoriteId format resolves correctly:
    //   Steam:  "268910"       (appId)
    //   Epic:   "epic:AppName" (libraryId)
    //   Manual: "manual:uuid"  (libraryId)
    const identityMap = new Map<string, LibraryGame>();
    for (const g of libraryGames) {
      const canonical = resolveCanonicalGameIdentity(g);
      if (canonical) identityMap.set(canonical, g);
      if (g.appId) identityMap.set(g.appId, g);
      if (g.libraryId) identityMap.set(g.libraryId, g);
    }

    // Resolve each favoriteId against the canonical identity map
    for (const favId of favoriteIds) {
      if (seen.has(favId)) continue;
      const libGame = identityMap.get(favId);
      if (!libGame) continue;
      const stableId = libGame.libraryId || libGame.id;
      if (stableId && seen.has(stableId)) continue;
      if (exclude.has(libGame.appId || "")) continue;
      if (!libGame.title) continue;
      seen.add(favId);
      if (stableId) seen.add(stableId);

      // Check if this game also exists in the snapshot (Steam games)
      const snapshotGame = libGame.appId
        ? (snapshot?.library?.games ?? []).find((sg) => sg.appId === libGame.appId)
        : undefined;

      if (snapshotGame) {
        result.push(snapshotToDisplayGame(snapshotGame as any, new Set()));
      } else {
        result.push(buildFavoriteDisplayGame(libGame));
      }
    }

    return result.slice(0, maxItems ?? 10);
  }, [snapshot, libraryGames, favoriteIds, excludeAppIds, maxItems]);

  useEffect(() => {
    for (const game of displayGames) {
      if (game.appId) {
        requestGameData(game.appId, LoadPriority.VIEWPORT);
      }
    }
  }, [displayGames]);

  // Depend on displayGames directly — when libraryGames state changes (e.g. Epic
  // scan populates coverPath/landscapePath), identityMap recomputes →
  // displayGames gets new reference → this effect re-runs with fresh _libraryGame paths.
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const urls: Record<string, string | null> = {};
      for (const game of displayGames) {
        if (cancelled) break;
        try {
          if (game._snapshotGame) {
            const m = game._snapshotGame.media;
            const imgPath = m?.landscapePath || m?.backgroundPath || m?.coverPath;
            urls[game.stableId] = (game.appId && imgPath)
              ? await resolveGameMediaUrl(game.appId, imgPath)
              : null;
          } else if (game._libraryGame) {
            const rawPath = getCardImageCandidate(game._libraryGame);
            const resolved = rawPath ? await resolveProviderMediaPreviewUrl(rawPath) : null;
            urls[game.stableId] = resolved;
            if (DEBUG_DASHBOARD_MEDIA) {
              console.log(`[DASHBOARD_MEDIA][FAVORITE_CARD] stableId=${game.stableId} source=${game.source} rolePaths=${JSON.stringify(game._rolePaths ?? {})} rawPath=${rawPath} resolvedUrl=${!!resolved}`);
            }
          } else {
            urls[game.stableId] = null;
          }
        } catch {
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
  }, [displayGames]);

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
    // 1. Direct LibraryGame reference (Epic, Manual, or from context) — always works
    if (game._libraryGame) {
      if (DEBUG_DASHBOARD_MEDIA) {
        console.log(`[DASH][FAVORITE_CLICK] stableId=${game.stableId} source=${game.source} method=direct-libraryGame`);
      }
      setSelectedGame(game._libraryGame);
      onNavigate?.("library-game-detail");
      return;
    }
    // 2. Steam snapshot: find by appId in current library games
    if (game.appId) {
      const libGame = libraryGames.find((g) => g.appId === game.appId);
      if (libGame) {
        if (DEBUG_DASHBOARD_MEDIA) {
          console.log(`[DASH][FAVORITE_CLICK] stableId=${game.stableId} source=${game.source} method=app-id-lookup appId=${game.appId}`);
        }
        setSelectedGame(libGame);
        onNavigate?.("library-game-detail");
        return;
      }
    }
    // 3. Fallback: find any game by stableId (covers edge cases)
    if (game.stableId) {
      const found = libraryGames.find((g) => (g.libraryId || g.id) === game.stableId);
      if (found) {
        if (DEBUG_DASHBOARD_MEDIA) {
          console.log(`[DASH][FAVORITE_CLICK] stableId=${game.stableId} source=${game.source} method=stableId-lookup`);
        }
        setSelectedGame(found);
        onNavigate?.("library-game-detail");
      } else if (DEBUG_DASHBOARD_MEDIA) {
        console.log(`[DASH][FAVORITE_CLICK] stableId=${game.stableId} source=${game.source} method=NONE game-not-found-in-library`);
      }
    }
  }

  function handleToggleFavorite(game: DashboardDisplayGame) {
    const fk = getFavoriteKey(game) ?? game.stableId;
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
                className="lf-dash-card group/card cursor-pointer overflow-hidden rounded-xl border border-(--surface-active-border) bg-white/[0.02] transition hover:bg-white/[0.04]"
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
                  <h3 className="lf-card-title line-clamp-1 text-sm font-medium text-(--color-text)">
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
