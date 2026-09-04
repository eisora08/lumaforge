import { useEffect, useMemo, useState } from "react";
import { Loader } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useSettings } from "../../context/SettingsContext";
import { resolveGameMediaUrl, resolveProviderMediaPreviewUrl } from "../../services/gameCacheService";
import {
  type DashboardDisplayGame,
  manualToDisplayGame,
  getCardImageCandidate,
  formatPlaytimeLong,
  formatLastAgo,
} from "../../services/dashboardManualGames";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";
import DashboardHorizontalRail from "./DashboardHorizontalRail";
import { getEffectiveCompletionStatus } from "../../features/console/consoleGameStats";
import { getManualGame } from "../../services/manualGameStore";
import type { LibraryGame } from "../../types/libraryGame";

type Props = {
  onNavigate?: (page: AppPage) => void;
  maxItems?: number;
};

function isInProgress(game: LibraryGame): boolean {
  // User-set override takes priority (manual, Steam, Debrid, Epic)
  if (game.completionStatus === "in-progress") return true;
  // Auto-compute from playtime + achievements
  const userStatus = game.source === "manual" && game.libraryId
    ? getManualGame(game.libraryId)?.completionStatus
    : undefined;
  return getEffectiveCompletionStatus(game, userStatus) === "in-progress";
}

export default function InProgressSection({ onNavigate, maxItems }: Props) {
  const { t } = useTranslation();
  const { games: libraryGames, initialLoading, setSelectedGame } = useLibraryGames();
  const { settings } = useSettings();
  const [mediaUrlMap, setMediaUrlMap] = useState<Record<string, string | null>>({});

  const displayGames = useMemo(() => {
    const inProgress = libraryGames.filter(isInProgress);
    const mapped = inProgress.map((g) => manualToDisplayGame(g, new Set()));
    mapped.sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
    return mapped.slice(0, maxItems ?? 12);
  }, [libraryGames, maxItems]);

  useEffect(() => {
    for (const game of displayGames) {
      if (game.appId) requestGameData(game.appId, LoadPriority.VIEWPORT);
    }
  }, [displayGames]);

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const urls: Record<string, string | null> = {};
      for (const game of displayGames) {
        if (cancelled) break;
        if (game.appId) {
          const imgPath = game._rolePaths?.landscapePath || game._rolePaths?.coverPath || game._rolePaths?.backgroundPath;
          urls[game.stableId] = imgPath ? await resolveGameMediaUrl(game.appId, imgPath) : null;
        } else if (game._libraryGame) {
          const rawPath = getCardImageCandidate(game._libraryGame);
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
  }, [displayGames]);

  if (displayGames.length === 0) {
    if (initialLoading) {
      return (
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-bold text-(--color-text)">{t("dashboard.in_progress", "In Progress")}</h2>
            <p className="mt-0.5 text-sm text-(--color-muted)">{t("dashboard.in_progress_desc", "Games you're currently playing")}</p>
          </div>
          <div className="flex snap-x gap-4 overflow-x-auto scroll-smooth pb-2 scrollbar-none">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="w-[min(75vw,260px)] shrink-0 snap-start animate-pulse">
                <div className="aspect-video rounded-xl bg-white/5" />
                <div className="mt-3 h-4 w-3/4 rounded bg-white/5" />
              </div>
            ))}
          </div>
        </section>
      );
    }
    return null;
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
            {t("dashboard.in_progress", "In Progress")}
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            {t("dashboard.in_progress_desc", "Games you're currently playing")}
          </p>
        </div>
      </div>

      <DashboardHorizontalRail gap={settings.dashboardGridGap}>
        {displayGames.map((game) => {
          const imgUrl = mediaUrlMap[game.stableId] ?? null;
          const lastAgoStr = formatLastAgo(game.lastPlayedAt);
          const playtimeStr = game.totalPlaytimeSeconds > 0 ? formatPlaytimeLong(game.totalPlaytimeSeconds) : null;

          return (
            <div
              key={"dashboard:in-progress:" + game.stableId}
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
                          <Loader className="h-6 w-6 text-amber-400/40" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/5">
                      <Loader className="h-6 w-6 text-amber-400/40" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" />
                </div>

                <div className="p-3">
                  <h3 className="lf-card-title line-clamp-1 text-sm font-medium text-(--color-text)">
                    {game.title}
                  </h3>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {playtimeStr && (
                      <span className="text-[11px] text-(--color-muted)">
                        {playtimeStr} played
                      </span>
                    )}
                    {lastAgoStr && (
                      <>
                        {playtimeStr && <span className="text-[11px] text-(--color-muted)">·</span>}
                        <span className="text-[11px] text-(--color-muted)">
                          Last {lastAgoStr}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </DashboardHorizontalRail>
    </section>
  );
}
