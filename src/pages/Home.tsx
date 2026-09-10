import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { countRender } from "../services/perfCounters";

import GameHero from "../components/dashboard/GameHero";
import ContinuePlayingSection from "../components/dashboard/ContinuePlayingSection";
import InProgressSection from "../components/dashboard/InProgressSection";
import CompletedSection from "../components/dashboard/CompletedSection";
import FavoritesSection from "../components/dashboard/FavoritesSection";
import RecommendedSection from "../components/dashboard/RecommendedSection";
import TopPlayedSection from "../components/dashboard/TopPlayedSection";
import PlayNextSection from "../components/dashboard/PlayNextSection";

import FeaturedPicksSection from "../components/dashboard/FeaturedPicksSection";
import TopPicksDashboardSection from "../components/dashboard/TopPicksDashboardSection";
import TrendingRightNowSection from "../components/dashboard/TrendingRightNowSection";
import LazySectionWrapper from "../components/store/LazySectionWrapper";

import { getCachedSnapshot, subscribeSnapshotUpdated } from "../services/startupSnapshotService";
import type { StartupSnapshot } from "../services/startupSnapshotService";
import { importSnapshotPlaytime, getCachedPlaytimeStore, subscribePlaytimeStore } from "../services/playtimeService";
import { useLibraryGames } from "../context/LibraryGamesContext";

import { useGameSession } from "../context/GameSessionContext";
import { useSettings } from "../context/SettingsContext";
import { subscribeCatalogState, getCatalogState, discoverGlobalCatalog } from "../services/globalCatalogService";
import { subscribeCatalogSections, getCachedCatalogSections } from "../services/storeCatalogOrchestrator";
import type { AppPage } from "../types/navigation";
import type { CatalogStatus } from "../services/globalCatalogService";

const DEBUG_HOME_CATALOG = false;

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

type Props = {
  onNavigate?: (page: AppPage) => void;
};


/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */



function isSectionVisible(sectionId: string, visibility: Record<string, boolean>): boolean {
  if (sectionId in visibility) return visibility[sectionId];
  return true;
}

function getSectionLimit(sectionId: string, limits: Record<string, number>, fallback: number = 12): number {
  if (sectionId in limits) return Math.max(2, limits[sectionId]);
  return fallback;
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function Home({ onNavigate }: Props) {
  countRender("Home");
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<StartupSnapshot | null>(() => getCachedSnapshot());
  
  const { sessions } = useGameSession();
  const { games: libraryGames } = useLibraryGames();
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>(() => getCatalogState().status);
  const [orchestratorHasData, setOrchestratorHasData] = useState(() => getCachedCatalogSections().length > 0);
  const { settings } = useSettings();
  const [playtimeVersion, setPlaytimeVersion] = useState(0);

  // Recompute continuePlayingAppIds when playtime store updates
  useEffect(() => {
    return subscribePlaytimeStore(() => setPlaytimeVersion((v) => v + 1));
  }, []);

  // Re-read snapshot when it's written/updated (one-shot check after boot)
  useEffect(() => {
    return subscribeSnapshotUpdated(() => {
      const fresh = getCachedSnapshot();
      setSnapshot((prev) => {
        if (fresh && (!prev || fresh.updatedAt !== prev.updatedAt)) return fresh;
        return prev;
      });
    });
  }, []);

  const heroEnabled = settings.dashboardHeroEnabled ?? true;
  const sectionVisibility = settings.dashboardSectionVisibility ?? {};
  const sectionLimits = settings.dashboardSectionLimits ?? {};

  // Track catalog readiness
  useEffect(() => {
    const unsub = subscribeCatalogState((s) => setCatalogStatus(s.status));
    return unsub;
  }, []);

  // Track orchestrator readiness (canonical Store catalog sections)
  const orchLogRef = useRef<string>("");
  useEffect(() => {
    if (DEBUG_HOME_CATALOG && !orchLogRef.current) {
      const cached = getCachedCatalogSections();
      console.log(`[HOME][CATALOG] mount orchestratorCached=${cached.length > 0} cachedSections=${cached.length} catalogStatus=${catalogStatus}`);
    }
    const unsub = subscribeCatalogSections((sections) => {
      const hasData = sections.length > 0;
      setOrchestratorHasData(hasData);
      if (DEBUG_HOME_CATALOG) {
        const sectionIds = sections.map((s) => s.sectionId).join(",");
        const totalGames = sections.reduce((n, s) => n + s.games.length, 0);
        const key = `${hasData}|${sectionIds}|${totalGames}`;
        if (orchLogRef.current !== key) {
          orchLogRef.current = key;
          console.log(`[HOME][CATALOG] orchestratorReady=${hasData} sections=${sectionIds} totalGames=${totalGames} catalogStatus=${catalogStatus} discoveryReady=${catalogStatus === "ready" || catalogStatus === "unavailable" || catalogStatus === "empty" || catalogStatus === "error" || hasData}`);
        }
      }
    });
    return unsub;
  }, [catalogStatus]);

  useEffect(() => {
    const idle = () => discoverGlobalCatalog().catch(() => {});
    if ("requestIdleCallback" in window) {
      (window as any).requestIdleCallback(idle, { timeout: 5000 });
    } else {
      setTimeout(idle, 0);
    }
  }, []);

  const sourceLogRef = useRef(false);
  useEffect(() => {
    if (sourceLogRef.current) return;
    if (catalogStatus !== "loading") {
      sourceLogRef.current = true;
    }
  }, [catalogStatus]);

  const dashboardDiscoveryReady = catalogStatus === "ready" || catalogStatus === "unavailable" || catalogStatus === "empty" || catalogStatus === "error" || orchestratorHasData;

  const discoveryLogRef = useRef(false);
  useEffect(() => {
    if (dashboardDiscoveryReady && !discoveryLogRef.current) {
      discoveryLogRef.current = true;
      if (DEBUG_HOME_CATALOG) {
        console.log(`[HOME][CATALOG] discoveryReady=true catalogStatus=${catalogStatus} orchestratorHasData=${orchestratorHasData}`);
      }
    }
  }, [dashboardDiscoveryReady, catalogStatus, orchestratorHasData]);

  useEffect(() => {
    if (snapshot?.library?.games) {
      const games = snapshot.library.games;
      const idle = () => importSnapshotPlaytime(games).catch(() => {});
      if ("requestIdleCallback" in window) {
        (window as any).requestIdleCallback(idle, { timeout: 5000 });
      } else {
        setTimeout(idle, 0);
      }
    }
  }, [snapshot]);

  const runningAppId = useMemo(() => {
    const running = Object.values(sessions).find((s) => s.state === "running");
    return running?.appId;
  }, [sessions]);

  const continuePlayingAppIds = useMemo(() => {
    const ids = new Set<string>();

    // From snapshot: games with lastPlayed or installed
    const snapshotGames = snapshot?.library?.games || [];
    for (const g of snapshotGames) {
      if (g.appId && (g.lastPlayed || g.installed)) {
        ids.add(g.appId);
      }
    }

    // From playtime store: games with any playtime
    const ptStore = getCachedPlaytimeStore();
    if (ptStore) {
      for (const [key, entry] of Object.entries(ptStore.games)) {
        if (entry.totalPlaytimeSeconds > 0) {
          // Extract appId from key formats: "app-{appId}", "steam-{id}", etc.
          const appId = key.startsWith("app-") ? key.slice(4) : null;
          if (appId) ids.add(appId);
        }
      }
    }

    // From libraryGames: installed non-Steam games (Epic/Debrid/Manual)
    for (const g of libraryGames) {
      if (g.appId && g.isInstalled && g.source !== "steam" && g.source !== "lua") {
        ids.add(g.appId);
      }
    }

    if (runningAppId) ids.add(runningAppId);
    return ids;
  }, [snapshot, runningAppId, libraryGames, playtimeVersion]);

  

  const maxWidth = settings.useExpandedDashboard ? undefined : settings.dashboardContentWidth;

  return (
    <div className="mx-auto w-full px-6 py-6 lg:px-8 xl:px-10 lf-page-in" data-card-scope="dashboard" style={{ maxWidth: maxWidth ? `${maxWidth}px` : undefined }}>
      <div className="space-y-8">
        {/* ── Hero ──────────────────────────────────────────────── */}
        {heroEnabled && <GameHero onNavigate={onNavigate} />}

        {/* ── Library sections ──────────────────────────────────── */}
        {isSectionVisible("continue-playing", sectionVisibility) && (
          <LazySectionWrapper sectionId="continue-playing" immediate>
            <ContinuePlayingSection
              snapshot={snapshot}
              onNavigate={onNavigate}
              excludeAppId={runningAppId}
              maxItems={getSectionLimit("continue-playing", sectionLimits, 12)}
            />
          </LazySectionWrapper>
        )}

        {isSectionVisible("play-next", sectionVisibility) && (
          <LazySectionWrapper sectionId="play-next">
            <PlayNextSection
              onNavigate={onNavigate}
              maxItems={getSectionLimit("play-next", sectionLimits, 12)}
            />
          </LazySectionWrapper>
        )}

        {isSectionVisible("in-progress", sectionVisibility) && (
          <LazySectionWrapper sectionId="in-progress" immediate>
            <InProgressSection
              onNavigate={onNavigate}
              maxItems={getSectionLimit("in-progress", sectionLimits, 12)}
            />
          </LazySectionWrapper>
        )}

        {isSectionVisible("completed", sectionVisibility) && (
          <LazySectionWrapper sectionId="completed">
            <CompletedSection
              onNavigate={onNavigate}
              maxItems={getSectionLimit("completed", sectionLimits, 12)}
            />
          </LazySectionWrapper>
        )}

        {isSectionVisible("favorites", sectionVisibility) && (
          <LazySectionWrapper sectionId="favorites">
            <FavoritesSection
              snapshot={snapshot}
              onNavigate={onNavigate}
              excludeAppIds={[runningAppId].filter(Boolean) as string[]}
              maxItems={getSectionLimit("favorites", sectionLimits, 12)}
            />
          </LazySectionWrapper>
        )}

        {isSectionVisible("recommended", sectionVisibility) && (
          <LazySectionWrapper sectionId="recommended">
            <RecommendedSection
              onNavigate={onNavigate}
              continuePlayingAppIds={continuePlayingAppIds}
              maxItems={getSectionLimit("recommended", sectionLimits, 12)}
            />
          </LazySectionWrapper>
        )}

        {/* ── Catalog discovery sections ────────────────────────── */}
        {!dashboardDiscoveryReady && (
          <section>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-(--color-text)">
                  {t("dashboard.discover_games", "Discovering games")}
                </h2>
                <p className="mt-0.5 text-sm text-(--color-muted)">
                  {t("dashboard.loading_catalog", "Loading global catalog\u2026")}
                </p>
              </div>
            </div>
            <div className="flex snap-x gap-4 overflow-x-auto scroll-smooth pb-2 scrollbar-none">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="w-[min(75vw,260px)] shrink-0 snap-start sm:w-56 animate-pulse"
                >
                  <div className="aspect-video rounded-xl bg-white/5" />
                  <div className="mt-3 h-4 w-3/4 rounded bg-white/5" />
                </div>
              ))}
            </div>
          </section>
        )}

        {dashboardDiscoveryReady && isSectionVisible("trending-right-now", sectionVisibility) && (
          <LazySectionWrapper sectionId="trending-right-now">
            <TrendingRightNowSection onNavigate={onNavigate} maxItems={getSectionLimit("trending-right-now", sectionLimits, 8)} />
          </LazySectionWrapper>
        )}

        {dashboardDiscoveryReady && isSectionVisible("featured-picks", sectionVisibility) && (
          <LazySectionWrapper sectionId="featured-picks">
            <FeaturedPicksSection
              onNavigate={onNavigate}
              maxItems={getSectionLimit("featured-picks", sectionLimits, 12)}
            />
          </LazySectionWrapper>
        )}

        {dashboardDiscoveryReady && isSectionVisible("top-picks", sectionVisibility) && (
          <LazySectionWrapper sectionId="top-picks">
            <TopPicksDashboardSection
              onNavigate={onNavigate}
              maxItems={getSectionLimit("top-picks", sectionLimits, 12)}
            />
          </LazySectionWrapper>
        )}

        {/* ── Bottom sections ──────────────────────────────────── */}
        {isSectionVisible("top-played", sectionVisibility) && (
          <LazySectionWrapper sectionId="top-played">
            <TopPlayedSection
              snapshot={snapshot}
              onNavigate={onNavigate}
              excludeAppIds={[runningAppId].filter(Boolean) as string[]}
              maxItems={getSectionLimit("top-played", sectionLimits, 12)}
            />
          </LazySectionWrapper>
        )}

        {/* <QuickActionsCompact onNavigate={onNavigate} /> */}

        {/* Compact system strip */}
        {/* <div className="flex flex-wrap items-center gap-4 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-xs text-(--color-muted)">System Ready</span>
          </div>

          {lastSync && (
            <span className="text-xs text-(--color-muted)/60">
              Last sync: {lastSync}
            </span>
          )}

          <span className="text-xs text-(--color-muted)/60">
            {installedCount} game{installedCount !== 1 ? "s" : ""} installed
          </span>

          {dedupedActivity.length > 0 && (
            <div className="flex items-center gap-3 border-l border-(--surface-active-border) pl-4">
              <Activity className="h-3.5 w-3.5 text-(--color-muted)/60" />
              {dedupedActivity.map((a) => (
                <div key={a.id} className="flex items-center gap-1.5">
                  <span className="line-clamp-1 max-w-[160px] text-xs text-(--color-muted)/80">
                    {a.count > 1 ? `${a.title} \u00b7 ${a.count}x` : a.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-(--color-muted)/40">
                    {formatTimestamp(a.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div> */}
      </div>
    </div>
  );
}
