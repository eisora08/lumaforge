import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

const DEBUG_DASH_GLOBAL_MEDIA = false;
const DEBUG_DASH_FEATURED = false;
const DEBUG_DASH_SECTION_LOGS = false;
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

type Props = {
  onNavigate?: (page: AppPage) => void;
  maxItems?: number;
};

const TOOL_KEYWORDS = [
  "steamworks", "redistributable", "steam cloud", "steamvr",
  "proton", "runtime", "sdk", "tool", "directx", "vcredist",
  "framework", "driver", "utility",
];

function isToolByTitle(title: string): boolean {
  const lower = title.toLowerCase();
  for (const kw of TOOL_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

function resolveBestMedia(game: NormalizedCatalogGame): string | null {
  return game.media.capsuleImageV5 || game.media.headerImage || game.media.libraryHeroImage || game.media.capsuleImage || game.media.backgroundImage || null;
}

export default function FeaturedPicksSection({ onNavigate, maxItems }: Props) {
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { settings } = useSettings();
  const [sections, setSections] = useState(() => getCachedCatalogSections());

  // Subscribe to orchestrator section updates (canonical Store catalog sections)
  useEffect(() => {
    const unsub = subscribeCatalogSections((s) => setSections([...s]));
    return unsub;
  }, []);

  const libraryAppIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of libraryGames) if (g.appId) set.add(g.appId);
    return set;
  }, [libraryGames]);

  const displayGames = useMemo(() => {
    // Find canonical featured section from orchestrator (matches Store's "Featured" section)
    const featuredSection = sections.find(
      (s) => s.sectionId === "featured" || s.sectionId === "top-picks",
    );
    if (!featuredSection || featuredSection.games.length === 0) return [];

    // Map orchestrator games to card model via shared bridge
    const cards = featuredSection.games.map(mapStoreCatalogGameToCard);

    // Filter: non-library, non-tool, has appId+title
    const filtered = cards.filter(
      (g) => g.appId && g.title && !libraryAppIds.has(g.appId) && !isToolByTitle(g.title),
    );
    if (filtered.length === 0) return [];

    // Sort: games with media first
    const withMedia = filtered.filter((g) => resolveBestMedia(g));
    const withoutMedia = filtered.filter((g) => !resolveBestMedia(g));
    const sorted = [...withMedia, ...withoutMedia];
    return sorted.slice(0, maxItems ?? 10);
  }, [sections, libraryAppIds, maxItems]);

  // Change-only diagnostic
  const featLogRef = useRef<string>("");
  useEffect(() => {
    const rendered = displayGames.length;
    const featuredSection = sections.find(
      (s) => s.sectionId === "featured" || s.sectionId === "top-picks",
    );
    const candidates = featuredSection?.games.length ?? 0;
    const key = `${rendered}|${candidates}|orchestrator`;

    if (sections.length === 0) {
      if (featLogRef.current !== "loading") {
        featLogRef.current = "loading";
      }
      return;
    }

    if (candidates === 0 || rendered === 0) {
      if (featLogRef.current !== `skip|${key}`) {
        featLogRef.current = `skip|${key}`;
        if (DEBUG_DASH_SECTION_LOGS) {
          console.log(`[DASH][SECTION_SKIP] section=FeaturedPicks reason=no-canonical-section total=${candidates}`);
        }
      }
      return;
    }

    if (featLogRef.current !== key) {
      featLogRef.current = key;
      if (DEBUG_DASH_FEATURED) {
        const withMediaCount = displayGames.filter((g) => resolveBestMedia(g)).length;
        console.log(
          `[DASH][FEATURED] candidates=${candidates} rendered=${rendered} withMedia=${withMediaCount} source=orchestrator`,
        );
      }
    }
  }, [displayGames, sections]);

  if (sections.length === 0 || displayGames.length === 0) return null;

  function handleOpen(game: NormalizedCatalogGame) {
    if (!game.appId) return;
    const libGame = libraryGames.find((g) => g.appId === game.appId);
    const hasMedia = !!resolveBestMedia(game);
    if (DEBUG_DASH_SECTION_LOGS) {
      console.log(`[DASH][GLOBAL_CLICK] section=FeaturedPicks appid=${game.appId} title="${game.title}" inLibrary=${!!libGame} hasMedia=${hasMedia}`);
    }
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
            Featured Picks
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            Curated games from the store catalog
          </p>
        </div>
      </div>

      <DashboardHorizontalRail gap={settings.dashboardGridGap}>
        {deduplicateByAppId(displayGames).map((game) => {
          const imgSrc = resolveBestMedia(game);
          if (imgSrc && DEBUG_DASH_GLOBAL_MEDIA) {
            console.log(`[DASH][GLOBAL_MEDIA] section=FeaturedPicks appid=${game.appId} src=${imgSrc.slice(0, 80)}`);
          }
          return (
            <div
              key={"dashboard:featured:steam:" + game.appId}
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
                    Available
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
