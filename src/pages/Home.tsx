import { useEffect, useMemo, useRef, useState } from "react";
import { countRender } from "../services/perfCounters";
import { Activity } from "lucide-react";
import GameHero from "../components/dashboard/GameHero";
import ContinuePlayingSection from "../components/dashboard/ContinuePlayingSection";
import FavoritesSection from "../components/dashboard/FavoritesSection";
import RecommendedSection from "../components/dashboard/RecommendedSection";
import TopPlayedSection from "../components/dashboard/TopPlayedSection";
import StoreHighlightsSection from "../components/dashboard/StoreHighlightsSection";
import FeaturedPicksSection from "../components/dashboard/FeaturedPicksSection";
import NewNoteworthySection from "../components/dashboard/NewNoteworthySection";
import TrendingRightNowSection from "../components/dashboard/TrendingRightNowSection";
import QuickActionsCompact from "../components/dashboard/QuickActionsCompact";
import { getCachedSnapshot, subscribeSnapshotUpdated } from "../services/startupSnapshotService";
import type { StartupSnapshot } from "../services/startupSnapshotService";
import { importSnapshotPlaytime } from "../services/playtimeService";
import { useGameActivity } from "../context/GameActivityContext";
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

type DedupedActivity = {
  id: string;
  title: string;
  count: number;
  createdAt: number;
};

/* ================================================================== */
/*  DEFERRED SECTION WRAPPER                                           */
/* ================================================================== */

function DeferredSection({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (isVisible) return <>{children}</>;

  return (
    <div ref={sentinelRef} className="min-h-[80px]">
      <div className="flex snap-x gap-4 overflow-x-auto scroll-smooth pb-2 scrollbar-none">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="w-[min(75vw,260px)] shrink-0 snap-start sm:w-56 animate-pulse"
          >
            <div className="aspect-video rounded-xl bg-white/5" />
            <div className="mt-3 h-4 w-3/4 rounded bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

function formatTimestamp(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function deduplicateActivities(activities: { id: string; title: string; createdAt: number }[]): DedupedActivity[] {
  const seen = new Map<string, DedupedActivity>();
  for (const a of activities) {
    const key = a.title;
    const existing = seen.get(key);
    if (existing) {
      existing.count++;
    } else {
      seen.set(key, { id: a.id, title: a.title, count: 1, createdAt: a.createdAt });
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3);
}

function isSectionVisible(sectionId: string, visibility: Record<string, boolean>): boolean {
  if (sectionId in visibility) return visibility[sectionId];
  return true;
}

function getSectionLimit(sectionId: string, limits: Record<string, number>, fallback: number = 12): number {
  if (sectionId in limits) return Math.max(2, limits[sectionId]);
  return fallback;
}

/* ================================================================== */
/*  SECTION WRAPPER                                                    */
/* ================================================================== */

/**
 * Wraps a section with optional deferred rendering.
 * When `deferred` is false or `eager` is true, renders immediately.
 * Otherwise, uses IntersectionObserver to render on scroll.
 */
function SectionWrap({
  deferred,
  eager,
  children,
}: {
  deferred: boolean;
  eager: boolean;
  children: React.ReactNode;
}) {
  if (!deferred || eager) return <>{children}</>;
  return <DeferredSection>{children}</DeferredSection>;
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function Home({ onNavigate }: Props) {
  countRender("Home");
  const [snapshot, setSnapshot] = useState<StartupSnapshot | null>(() => getCachedSnapshot());
  const { activities } = useGameActivity();
  const { sessions } = useGameSession();
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>(() => getCatalogState().status);
  const [orchestratorHasData, setOrchestratorHasData] = useState(() => getCachedCatalogSections().length > 0);
  const { settings } = useSettings();

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
  const deferredRendering = settings.dashboardDeferredRendering ?? false;
  const initialVisibleSections = settings.dashboardInitialVisibleSections ?? 0;
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
    const snapshotGames = snapshot?.library?.games || [];
    const ids = new Set<string>();
    for (const g of snapshotGames) {
      if (g.appId && (g.lastPlayed || g.installed)) {
        ids.add(g.appId);
      }
    }
    if (runningAppId) ids.add(runningAppId);
    return ids;
  }, [snapshot, runningAppId]);

  const dedupedActivity = useMemo(() => deduplicateActivities(activities), [activities]);

  const installedCount = snapshot?.library?.games?.filter((g) => g.installed).length ?? 0;
  const lastSync = snapshot?.updatedAt
    ? new Date(snapshot.updatedAt * 1000).toLocaleString()
    : null;

  const maxWidth = settings.useExpandedDashboard ? undefined : settings.dashboardContentWidth;

  // Counter for tracking which sections should be eager (first N)
  // We compute the eager set outside render to avoid side effects during render
  const eagerSections = useMemo(() => {
    if (!deferredRendering || initialVisibleSections <= 0) return new Set<string>();
    const order = [
      "continue-playing",
      "favorites",
      "recommended",
      "trending-right-now",
      "featured-picks",
      "new-noteworthy",
      "top-played",
      "store-highlights",
    ];
    return new Set(order.slice(0, initialVisibleSections));
  }, [deferredRendering, initialVisibleSections]);

  return (
    <div className="mx-auto w-full px-6 py-6 lg:px-8 xl:px-10 lf-fade-in" style={{ maxWidth: maxWidth ? `${maxWidth}px` : undefined }}>
      <div className="space-y-8">
        {/* ── Hero ──────────────────────────────────────────────── */}
        {heroEnabled && <GameHero onNavigate={onNavigate} />}

        {/* ── Library sections ──────────────────────────────────── */}
        {isSectionVisible("continue-playing", sectionVisibility) && (
          <SectionWrap deferred={deferredRendering} eager={eagerSections.has("continue-playing")}>
            <ContinuePlayingSection
              snapshot={snapshot}
              onNavigate={onNavigate}
              excludeAppId={runningAppId}
              maxItems={getSectionLimit("continue-playing", sectionLimits, 12)}
            />
          </SectionWrap>
        )}

        {isSectionVisible("favorites", sectionVisibility) && (
          <SectionWrap deferred={deferredRendering} eager={eagerSections.has("favorites")}>
            <FavoritesSection
              snapshot={snapshot}
              onNavigate={onNavigate}
              excludeAppIds={[runningAppId].filter(Boolean) as string[]}
              maxItems={getSectionLimit("favorites", sectionLimits, 12)}
            />
          </SectionWrap>
        )}

        {isSectionVisible("recommended", sectionVisibility) && (
          <SectionWrap deferred={deferredRendering} eager={eagerSections.has("recommended")}>
            <RecommendedSection
              onNavigate={onNavigate}
              continuePlayingAppIds={continuePlayingAppIds}
              maxItems={getSectionLimit("recommended", sectionLimits, 12)}
            />
          </SectionWrap>
        )}

        {/* ── Catalog discovery sections ────────────────────────── */}
        {!dashboardDiscoveryReady && (
          <section>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-(--color-text)">
                  Discovering games
                </h2>
                <p className="mt-0.5 text-sm text-(--color-muted)">
                  Loading global catalog&hellip;
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
          <SectionWrap deferred={deferredRendering} eager={eagerSections.has("trending-right-now")}>
            <TrendingRightNowSection onNavigate={onNavigate} />
          </SectionWrap>
        )}

        {dashboardDiscoveryReady && isSectionVisible("featured-picks", sectionVisibility) && (
          <SectionWrap deferred={deferredRendering} eager={eagerSections.has("featured-picks")}>
            <FeaturedPicksSection
              onNavigate={onNavigate}
              maxItems={getSectionLimit("featured-picks", sectionLimits, 12)}
            />
          </SectionWrap>
        )}

        {dashboardDiscoveryReady && isSectionVisible("new-noteworthy", sectionVisibility) && (
          <SectionWrap deferred={deferredRendering} eager={eagerSections.has("new-noteworthy")}>
            <NewNoteworthySection
              onNavigate={onNavigate}
              maxItems={getSectionLimit("new-noteworthy", sectionLimits, 12)}
            />
          </SectionWrap>
        )}

        {/* ── Bottom sections ──────────────────────────────────── */}
        {isSectionVisible("top-played", sectionVisibility) && (
          <SectionWrap deferred={deferredRendering} eager={eagerSections.has("top-played")}>
            <TopPlayedSection
              snapshot={snapshot}
              onNavigate={onNavigate}
              excludeAppIds={[runningAppId].filter(Boolean) as string[]}
              maxItems={getSectionLimit("top-played", sectionLimits, 12)}
            />
          </SectionWrap>
        )}

        {isSectionVisible("store-highlights", sectionVisibility) && (
          <SectionWrap deferred={deferredRendering} eager={eagerSections.has("store-highlights")}>
            <StoreHighlightsSection onNavigate={onNavigate} />
          </SectionWrap>
        )}

        <QuickActionsCompact onNavigate={onNavigate} />

        {/* Compact system strip */}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-5 py-3">
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
        </div>
      </div>
    </div>
  );
}
