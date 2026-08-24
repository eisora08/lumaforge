import { useEffect, useMemo, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { NormalizedCatalogGame } from "../../services/globalCatalogService";
import { useSettings } from "../../context/SettingsContext";
import { deduplicateByAppId } from "../../services/gameCacheService";
import { setPendingStoreDetailAppId } from "../../services/storeNavigationService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";
import DashboardHorizontalRail from "./DashboardHorizontalRail";
import { subscribeCatalogSections, getCachedCatalogSections } from "../../services/storeCatalogOrchestrator";
import { mapStoreCatalogGameToCard } from "../../services/globalCatalogService";
import { getCatalogSectionWithFallback, filterAndSortCatalogGames, resolveBestMedia } from "./dashboardSectionHelpers";

type Props = {
  onNavigate?: (page: AppPage) => void;
  maxItems?: number;
};

function formatReleaseDate(date: string | null | undefined, t: (key: string, options?: Record<string, unknown>) => string): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 0) return null;
  if (diffDays === 0) return t("store.dates.today", { defaultValue: "Today" });
  if (diffDays === 1) return t("store.dates.yesterday", { defaultValue: "Yesterday" });
  if (diffDays < 7) return t("store.dates.days_ago", { count: diffDays });
  if (diffDays < 30) return t("store.dates.weeks_ago", { count: Math.floor(diffDays / 7) });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function TrendingRightNowSection({ onNavigate, maxItems }: Props) {
  const { t } = useTranslation();
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { settings } = useSettings();
  const [sections, setSections] = useState(() => getCachedCatalogSections());
  const [curatedFallback, setCuratedFallback] = useState<NormalizedCatalogGame[] | null>(null);

  useEffect(() => {
    const unsub = subscribeCatalogSections((s) => setSections([...s]));
    return unsub;
  }, []);

  const libraryAppIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of libraryGames) if (g.appId) set.add(g.appId);
    return set;
  }, [libraryGames]);

  // Synchronous orchestrator lookup (fast path)
  const orchestratorGames = useMemo(() => {
    const found = sections.find((s) => s.sectionId === "new-noteworthy");
    if (!found || found.games.length === 0) return null;
    return found.games.map(mapStoreCatalogGameToCard);
  }, [sections]);

  // Async curated fallback (only when orchestrator has no data for this section)
  useEffect(() => {
    if (orchestratorGames !== null) {
      setCuratedFallback(null);
      return;
    }
    if (sections.length === 0) return;

    let cancelled = false;
    getCatalogSectionWithFallback(sections, "new-noteworthy").then((games) => {
      if (!cancelled && games && orchestratorGames === null) {
        setCuratedFallback(games);
      }
    });
    return () => { cancelled = true; };
  }, [orchestratorGames, sections]);

  const displayGames = useMemo(() => {
    const source = orchestratorGames ?? curatedFallback;
    if (!source) return [];
    return filterAndSortCatalogGames(source, libraryAppIds, maxItems ?? 8);
  }, [orchestratorGames, curatedFallback, libraryAppIds, maxItems]);

  const logRef = useRef<string>("");
  useEffect(() => {
    const rendered = displayGames.length;
    const candidates = orchestratorGames?.length ?? curatedFallback?.length ?? 0;
    const source = orchestratorGames ? "orchestrator" : curatedFallback ? "curated" : "none";
    const key = `${rendered}|${candidates}|${source}`;

    if (sections.length === 0) {
      if (logRef.current !== "loading") logRef.current = "loading";
      return;
    }

    if (candidates === 0 || rendered === 0) {
      if (logRef.current !== `skip|${key}`) {
        logRef.current = `skip|${key}`;
      }
      return;
    }

    if (logRef.current !== key) {
      logRef.current = key;
    }
  }, [displayGames, sections, orchestratorGames, curatedFallback]);

  if (sections.length === 0 || displayGames.length === 0) return null;

  function handleOpen(game: NormalizedCatalogGame) {
    if (!game.appId) return;
    const libGame = libraryGames.find((g) => g.appId === game.appId);
    if (libGame) {
      setSelectedGame(libGame);
      onNavigate?.("library-game-detail");
    } else {
      setPendingStoreDetailAppId(game.appId);
      onNavigate?.("store");
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-(--color-text)">
            {t("store.sections.trending_right_now", "Trending Right Now")}
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            {t("store.sections.trending_right_now_desc", "New and noteworthy releases")}
          </p>
        </div>
      </div>

      <DashboardHorizontalRail gap={settings.dashboardGridGap}>
        {deduplicateByAppId(displayGames).map((game) => {
          const imgSrc = resolveBestMedia(game);
          return (
            <div
              key={"dashboard:trending:steam:" + game.appId}
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
                  {imgSrc ? (
                    <AsyncImage
                      src={imgSrc}
                      alt={game.title}
                      className="h-full w-full object-cover"
                      fallback={
                        <div className="flex h-full w-full items-center justify-center bg-white/5">
                          <Zap className="h-6 w-6 text-(--color-muted)/40" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/5">
                      <Zap className="h-6 w-6 text-(--color-muted)/40" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" />
                </div>

                <div className="p-3">
                  <h3 className="lf-card-title line-clamp-1 text-sm font-medium text-(--color-text)">
                    {game.title}
                  </h3>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="inline-block rounded-full bg-orange-400/15 px-2 py-0.5 text-[10px] font-medium text-orange-400">
                      {t("store.badges.new", "New")}
                    </span>
                    {formatReleaseDate(game.releaseDate, t) && (
                      <span className="text-[10px] text-(--color-muted)">
                        {formatReleaseDate(game.releaseDate, t)}
                      </span>
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
