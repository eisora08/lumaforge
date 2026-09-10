import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListPlus } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useSettings } from "../../context/SettingsContext";
import { usePlayQueue } from "../../context/PlayQueueContext";
import { resolveProviderMediaPreviewUrl } from "../../services/gameCacheService";
import {
  type DashboardDisplayGame,
  manualToDisplayGame,
  getCardImageCandidate,
} from "../../services/dashboardManualGames";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";
import DashboardHorizontalRail from "./DashboardHorizontalRail";

type Props = {
  onNavigate?: (page: AppPage) => void;
  maxItems?: number;
};

function getQueueDisplayGames(
  queueGameIds: string[],
  libraryGames: LibraryGame[],
  maxItems: number,
): DashboardDisplayGame[] {
  const libGameById = new Map<string, LibraryGame>();
  const libGameByAppId = new Map<string, LibraryGame>();
  for (const lg of libraryGames) {
    libGameById.set(lg.id, lg);
    if (lg.appId) libGameByAppId.set(lg.appId, lg);
  }

  const result: DashboardDisplayGame[] = [];
  const seen = new Set<string>();

  for (const gameId of queueGameIds) {
    if (result.length >= maxItems) break;
    if (seen.has(gameId)) continue;
    seen.add(gameId);

    // Try to find by id first, then by appId
    const libGame = libGameById.get(gameId) ?? libGameByAppId.get(gameId);
    if (!libGame) continue;

    result.push(
      manualToDisplayGame(libGame, new Set(), libGame.source),
    );
  }

  return result;
}

export default function PlayNextSection({ onNavigate, maxItems = 12 }: Props) {
  const { t } = useTranslation();
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { settings } = useSettings();
  const { queue } = usePlayQueue();
  const [mediaUrlMap, setMediaUrlMap] = useState<Record<string, string | null>>({});

  const queueGameIds = useMemo(
    () => queue.map((e) => e.gameId),
    [queue],
  );

  const displayGames = useMemo(
    () => getQueueDisplayGames(queueGameIds, libraryGames, maxItems),
    [queueGameIds, libraryGames, maxItems],
  );

  useEffect(() => {
    for (const game of displayGames) {
      if (game.appId) {
        requestGameData(game.appId, LoadPriority.VIEWPORT);
      }
    }
  }, [displayGames]);

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const urls: Record<string, string | null> = {};
      for (const game of displayGames) {
        if (cancelled) break;
        if (game._libraryGame) {
          const rawPath = getCardImageCandidate(game._libraryGame);
          urls[game.stableId] = rawPath ? await resolveProviderMediaPreviewUrl(rawPath) : null;
        } else if (game.appId) {
          urls[game.stableId] = null;
        } else {
          urls[game.stableId] = null;
        }
      }
      if (cancelled) return;
      setMediaUrlMap((prev) => {
        if (
          Object.keys(prev).length === Object.keys(urls).length &&
          Object.entries(urls).every(([k, v]) => prev[k] === v)
        )
          return prev;
        return urls;
      });
    };
    resolve();
    return () => {
      cancelled = true;
    };
  }, [displayGames]);

  if (queue.length === 0) {
    return (
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-bold text-(--color-text)">
            {t("sidebar.play_next", "Play Next")}
          </h2>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-6 py-12 text-center">
          <ListPlus className="mb-3 h-8 w-8 text-(--color-muted)/30" />
          <p className="text-sm text-(--color-muted)">
            {t("sidebar.play_next_empty", "No games in queue")}
          </p>
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

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-(--color-text)">
            {t("sidebar.play_next", "Play Next")}
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            {t("sidebar.play_next_next_up", "Next Up")}
          </p>
        </div>
      </div>

      <DashboardHorizontalRail gap={settings.dashboardGridGap}>
        {displayGames.map((game, index) => {
          const imgUrl = mediaUrlMap[game.stableId] ?? null;

          return (
            <div
              key={`dashboard:playnext:${game.stableId}`}
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
                          <ListPlus className="h-6 w-6 text-(--color-muted)/40" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/5">
                      <ListPlus className="h-6 w-6 text-(--color-muted)/40" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" />
                  {/* Position badge */}
                  <div className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-[11px] font-bold text-white backdrop-blur-sm">
                    {index + 1}
                  </div>
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
