import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import type { NormalizedCatalogGame, CatalogStatus } from "../../services/globalCatalogService";
import {
  subscribeCatalogState,
  getCachedCatalog,
  loadNormalizedCatalog,
  getCatalogState,
} from "../../services/globalCatalogService";
import { setPendingStoreDetailAppId } from "../../services/storeNavigationService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";

type Props = {
  onNavigate?: (page: AppPage) => void;
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

export default function FeaturedPicksSection({ onNavigate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const [entries, setEntries] = useState<NormalizedCatalogGame[]>(() => getCachedCatalog());
  const [status, setStatus] = useState<CatalogStatus>(() => getCatalogState().status);

  // Subscribe to catalog state changes
  useEffect(() => {
    const unsub = subscribeCatalogState((s) => {
      setStatus(s.status);
    });
    return unsub;
  }, []);

  // Load normalized entries once catalog is ready
  useEffect(() => {
    let cancelled = false;
    const cached = getCachedCatalog();
    if (cached.length > 0) {
      setEntries(cached);
      return;
    }
    (async () => {
      const { entries: loaded } = await loadNormalizedCatalog(2000);
      if (cancelled) return;
      setEntries(loaded);
    })();
    return () => { cancelled = true; };
  }, []);

  // One-time readiness log
  const readyLogRef = useRef(false);
  useEffect(() => {
    if (readyLogRef.current) return;
    if (status === "ready" || status === "unavailable" || status === "empty" || status === "error") {
      readyLogRef.current = true;
      const state = getCatalogState();
      console.log(
        `[DASH][GLOBAL_CATALOG_READY] status=${status} total=${state.total} source=${state.source}`,
      );
    }
  }, [status]);

  const libraryAppIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of libraryGames) if (g.appId) set.add(g.appId);
    return set;
  }, [libraryGames]);

  const displayGames = useMemo(() => {
    if (status !== "ready") return [];
    const filtered = entries.filter(
      (g) => g.appId && g.title && !libraryAppIds.has(g.appId) && !isToolByTitle(g.title),
    );
    if (filtered.length === 0) return [];
    const withMedia = filtered.filter((g) => resolveBestMedia(g));
    const withoutMedia = filtered.filter((g) => !resolveBestMedia(g));
    const sorted = [...withMedia, ...withoutMedia];
    return sorted.slice(0, 10);
  }, [entries, status, libraryAppIds]);

  // Change-only diagnostic
  const featLogRef = useRef<string>("");
  useEffect(() => {
    const state = getCatalogState();
    const rendered = displayGames.length;
    const candidates = entries.filter((g) => g.appId && g.title && !isToolByTitle(g.title)).length;
    const source = "catalog-order";
    const key = `${rendered}|${candidates}|${source}`;

    if (status !== "ready") {
      if (featLogRef.current !== `loading|${status}`) {
        featLogRef.current = `loading|${status}`;
      }
      return;
    }

    if (candidates === 0 || rendered === 0) {
      if (featLogRef.current !== `skip|${key}`) {
        featLogRef.current = `skip|${key}`;
        const reason = entries.length === 0 ? "no-ready-catalog" : "all-candidates-filtered";
        console.log(`[DASH][SECTION_SKIP] section=FeaturedPicks reason=${reason} total=${state.total}`);
      }
      return;
    }

    if (featLogRef.current !== key) {
      featLogRef.current = key;
      const withMediaCount = displayGames.filter((g) => resolveBestMedia(g)).length;
      console.log(
        `[DASH][FEATURED] total=${state.total} candidates=${candidates} rendered=${rendered} withMedia=${withMediaCount} source=${source}`,
      );
    }
  }, [displayGames, entries, status]);

  if (status !== "ready" || displayGames.length === 0) return null;

  function scroll(direction: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.round(el.clientWidth * 0.85);
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  }

  function handleOpen(game: NormalizedCatalogGame) {
    if (!game.appId) return;
    const libGame = libraryGames.find((g) => g.appId === game.appId);
    const hasMedia = !!resolveBestMedia(game);
    console.log(`[DASH][GLOBAL_CLICK] section=FeaturedPicks appid=${game.appId} title="${game.title}" inLibrary=${!!libGame} hasMedia=${hasMedia}`);
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
            Curated games from the global catalog
          </p>
        </div>
      </div>

      <div className="group/row relative">
        <button
          type="button"
          onClick={() => scroll("left")}
          className="absolute -left-2 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-xl backdrop-blur transition hover:bg-black/80 group-hover/row:flex"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div
          ref={scrollRef}
          className="flex snap-x gap-4 overflow-x-auto scroll-smooth pb-2 scrollbar-none"
        >
          {displayGames.map((game) => {
            const imgSrc = resolveBestMedia(game);
            if (imgSrc) {
              console.log(`[DASH][GLOBAL_MEDIA] section=FeaturedPicks appid=${game.appId} src=${imgSrc.slice(0, 80)}`);
            }
            return (
              <div
                key={game.appId}
                className="w-[min(75vw,260px)] shrink-0 snap-start sm:w-56"
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
                  className="group/card cursor-pointer overflow-hidden rounded-xl border border-(--surface-active-border) bg-white/[0.02] transition hover:bg-white/[0.04]"
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
                    <h3 className="line-clamp-1 text-sm font-medium text-(--color-text)">
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
        </div>

        <button
          type="button"
          onClick={() => scroll("right")}
          className="absolute -right-2 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-xl backdrop-blur transition hover:bg-black/80 group-hover/row:flex"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </section>
  );
}
