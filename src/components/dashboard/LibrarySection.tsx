import { useEffect, useMemo, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useSettings } from "../../context/SettingsContext";
import { resolveGameMediaUrl, resolveDashboardTitles, deduplicateByAppId } from "../../services/gameCacheService";

const DEBUG_MEDIA_DASH = false;
const DEBUG_NAME_DASH = false;
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";
import DashboardHorizontalRail from "./DashboardHorizontalRail";

type Props = {
  snapshot?: any;
  onNavigate?: (page: AppPage) => void;
  excludeAppIds?: string[];
};

export default function LibrarySection({ snapshot, onNavigate, excludeAppIds }: Props) {
  const { t } = useTranslation();
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { settings } = useSettings();
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string | null>>({});

  const [titleMap, setTitleMap] = useState<Record<string, string>>({});

  const displayGames = useMemo(() => {
    const exclude = new Set(excludeAppIds ?? []);
    const installed = libraryGames.filter((g) => g.isInstalled && g.appId && !exclude.has(g.appId));
    if (installed.length > 0) return installed.slice(0, 10);
    const remaining = libraryGames.filter((g) => g.appId && !exclude.has(g.appId));
    return remaining.slice(0, 10);
  }, [libraryGames, excludeAppIds]);

  useEffect(() => {
    for (const game of displayGames) {
      if (game.appId) {
        requestGameData(game.appId, LoadPriority.VIEWPORT);
      }
    }
  }, [displayGames]);

  // Stable primitive key derived from displayGames — avoids infinite render loops
  const gameIdsKey = useMemo(
    () => displayGames.map(g => g.appId).filter(Boolean).sort().join(','),
    [displayGames],
  );

  // Resolve media URLs and titles
  useEffect(() => {
    let cancelled = false;
    const ids = gameIdsKey ? gameIdsKey.split(',') : [];
    const gameById = new Map(displayGames.map(g => [g.appId, g]));

    const resolveAll = async () => {
      const urls: Record<string, string | null> = {};
      const titles: Record<string, string> = {};
      const resolvedTitles = displayGames.length > 0 ? await resolveDashboardTitles(displayGames) : {};
      for (const appId of ids) {
        if (cancelled) break;
        const game = gameById.get(appId);
        if (!game) continue;
        const imgPath = game.landscapePath || game.coverPath || game.backgroundPath || game.iconPath;
        urls[appId] = imgPath ? await resolveGameMediaUrl(appId, imgPath) : null;
        titles[appId] = resolvedTitles[appId]?.title ?? game.title;
        if (imgPath && !cancelled) {
          const selection = game.landscapePath ? "landscape" : game.coverPath ? "cover" : game.backgroundPath ? "background" : "icon";
          if (DEBUG_MEDIA_DASH) console.log(`[MEDIA][DASH] section=Library appid=${appId} selected=${selection} source=snapshot hasUrl=${!!urls[appId]}`);
        }
        if (DEBUG_NAME_DASH) console.log(`[NAME][DASH] section=Library appid=${appId} source=${resolvedTitles[appId]?.source ?? "snapshot"} title=${titles[appId]}`);
      }
      if (cancelled) return;
      setResolvedUrls(prev => {
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
    resolveAll();
    return () => { cancelled = true; };
  }, [gameIdsKey]);

  if (displayGames.length === 0) return null;

  function handleOpen(game: any) {
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
            {t("dashboard.from_your_library", "From Your Library")}
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            {t("dashboard.installed_games", { count: displayGames.filter((g) => g.isInstalled).length, defaultValue: "{{count}} installed games" })}
          </p>
        </div>
        <button
          onClick={() => onNavigate?.("library")}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
        >
          {t("dashboard.view_library", "View Library")}
        </button>
      </div>

      <DashboardHorizontalRail gap={settings.dashboardGridGap}>
        {deduplicateByAppId(displayGames).map((game) => {
          const imgUrl = game.appId ? (resolvedUrls[game.appId] ?? null) : null;
          const displayTitle = game.appId ? (titleMap[game.appId] ?? game.title) : game.title;

          return (
            <div
              key={"dashboard:library:steam:" + (game.appId ?? "unknown")}
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
                      alt={displayTitle}
                      className="h-full w-full object-cover"
                      fallback={
                        <div className="flex h-full w-full items-center justify-center bg-white/5">
                          <Gamepad2 className="h-6 w-6 text-(--color-muted)/40" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/5">
                      <Gamepad2 className="h-6 w-6 text-(--color-muted)/40" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" />
                  {game.isInstalled && (
                    <span className="absolute left-2 top-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 backdrop-blur-sm">
                      {t("dashboard.installed", "Installed")}
                    </span>
                  )}
                </div>

                <div className="p-3">
                  <h3 className="lf-card-title line-clamp-1 text-sm font-medium text-(--color-text)">
                    {displayTitle}
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
