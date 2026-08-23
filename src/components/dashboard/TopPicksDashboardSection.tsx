import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

const DEBUG_DASH_TOP_PICKS = false;
import type { NormalizedCatalogGame } from "../../services/globalCatalogService";
import { mapStoreCatalogGameToCard } from "../../services/globalCatalogService";
import { useSettings } from "../../context/SettingsContext";
import { deduplicateByAppId } from "../../services/gameCacheService";
import { setPendingStoreDetailAppId } from "../../services/storeNavigationService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";
import DashboardHorizontalRail from "./DashboardHorizontalRail";
import { subscribeCatalogSections, getCachedCatalogSections } from "../../services/storeCatalogOrchestrator";
import { getCatalogSectionWithFallback, filterAndSortCatalogGames, resolveBestMedia } from "./dashboardSectionHelpers";

type Props = {
  onNavigate?: (page: AppPage) => void;
  maxItems?: number;
};

export default function TopPicksDashboardSection({ onNavigate, maxItems }: Props) {
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
    const found = sections.find((s) => s.sectionId === "top-picks");
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
    getCatalogSectionWithFallback(sections, "top-picks").then((games) => {
      if (!cancelled) setCuratedFallback(games);
    });
    return () => { cancelled = true; };
  }, [orchestratorGames, sections]);

  const displayGames = useMemo(() => {
    const source = orchestratorGames ?? curatedFallback;
    if (!source) return [];
    return filterAndSortCatalogGames(source, libraryAppIds, maxItems ?? 10);
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
      if (DEBUG_DASH_TOP_PICKS) {
        const withMediaCount = displayGames.filter((g) => resolveBestMedia(g)).length;
        console.log(
          `[DASH][TOP_PICKS] candidates=${candidates} rendered=${rendered} withMedia=${withMediaCount} source=${source}`,
        );
      }
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
            Top Picks
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            Trending games from the catalog
          </p>
        </div>
      </div>

      <DashboardHorizontalRail gap={settings.dashboardGridGap}>
        {deduplicateByAppId(displayGames).map((game) => {
          const imgSrc = resolveBestMedia(game);
          if (imgSrc && DEBUG_DASH_TOP_PICKS) {
            console.log(`[DASH][TOP_PICKS_MEDIA] appid=${game.appId} src=${imgSrc.slice(0, 80)}`);
          }
          return (
            <div
              key={"dashboard:toppicks:steam:" + game.appId}
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
                          <Sparkles className="h-6 w-6 text-(--color-muted)/40" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/5">
                      <Sparkles className="h-6 w-6 text-(--color-muted)/40" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" />
                </div>

                <div className="p-3">
                  <h3 className="lf-card-title line-clamp-1 text-sm font-medium text-(--color-text)">
                    {game.title}
                  </h3>
                  <span className="mt-1 inline-block rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-(--color-muted)">
                    Top Rated
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </DashboardHorizontalRail>
    </section>
  );
}
