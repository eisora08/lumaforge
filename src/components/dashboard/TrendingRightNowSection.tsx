import { useEffect, useMemo, useRef, useState } from "react";
import { Zap } from "lucide-react";

import type { NormalizedCatalogGame } from "../../services/globalCatalogService";
import { mapStoreCatalogGameToCard } from "../../services/globalCatalogService";
import { useSettings } from "../../context/SettingsContext";
import { deduplicateByAppId } from "../../services/gameCacheService";
import { getBestStoreImage } from "../../services/storeImageCache";
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
  if (game.appId) {
    const storeImage = getBestStoreImage(game.appId, ["capsule", "header", "hero"]);
    if (storeImage) return storeImage;
  }
  return game.media.capsuleImageV5 || game.media.headerImage || game.media.libraryHeroImage || game.media.capsuleImage || game.media.backgroundImage || null;
}

function formatReleaseDate(date?: string | null): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 0) return null;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function TrendingRightNowSection({ onNavigate, maxItems }: Props) {
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { settings } = useSettings();
  const [sections, setSections] = useState(() => getCachedCatalogSections());

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
    const noteworthySection = sections.find((s) => s.sectionId === "new-noteworthy");
    if (!noteworthySection || noteworthySection.games.length === 0) return [];

    const cards = noteworthySection.games.map(mapStoreCatalogGameToCard);

    const filtered = cards.filter(
      (g) => g.appId && g.title && !libraryAppIds.has(g.appId) && !isToolByTitle(g.title),
    );
    if (filtered.length === 0) return [];

    const withMedia = filtered.filter((g) => resolveBestMedia(g));
    const withoutMedia = filtered.filter((g) => !resolveBestMedia(g));
    const sorted = [...withMedia, ...withoutMedia];
    return sorted.slice(0, maxItems ?? 8);
  }, [sections, libraryAppIds, maxItems]);

  const logRef = useRef<string>("");
  useEffect(() => {
    const rendered = displayGames.length;
    const noteworthySection = sections.find((s) => s.sectionId === "new-noteworthy");
    const candidates = noteworthySection?.games.length ?? 0;
    const key = `${rendered}|${candidates}|orchestrator`;

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
  }, [displayGames, sections]);

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
            Trending Right Now
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            New and noteworthy releases
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
                      New
                    </span>
                    {formatReleaseDate(game.releaseDate) && (
                      <span className="text-[10px] text-(--color-muted)">
                        {formatReleaseDate(game.releaseDate)}
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
