import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import type { NormalizedCatalogGame, CatalogStatus } from "../../services/globalCatalogService";
import {
  subscribeCatalogState,
  getCachedCatalog,
  getCatalogState,
  loadNormalizedCatalog,
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

export default function NewNoteworthySection({ onNavigate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const [entries, setEntries] = useState<NormalizedCatalogGame[]>(() => getCachedCatalog());
  const [status, setStatus] = useState<CatalogStatus>(() => getCatalogState().status);

  useEffect(() => {
    const unsub = subscribeCatalogState((s) => {
      setStatus(s.status);
    });
    return unsub;
  }, []);

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

      // Log sample of first 5 entries with date field inspection
      if (loaded.length > 0) {
        const sample = loaded.slice(0, 5).map((g) => ({
          title: g.title,
          appId: g.appId,
          releaseDate: g.releaseDate,
          releaseTimestamp: g.releaseTimestamp,
          isNew: g.isNew,
        }));
        console.log("[DASH][CATALOG_NORMALIZE_SAMPLE]", JSON.stringify(sample));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const libraryAppIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of libraryGames) if (g.appId) set.add(g.appId);
    return set;
  }, [libraryGames]);

  const dateCandidates = useMemo(() => {
    if (status !== "ready") return [];
    return entries.filter(
      (g) =>
        g.appId &&
        g.title &&
        !libraryAppIds.has(g.appId) &&
        !isToolByTitle(g.title) &&
        (g.releaseTimestamp > 0 || g.isNew),
    );
  }, [entries, status, libraryAppIds]);

  const displayGames = useMemo(() => {
    if (dateCandidates.length === 0) return [];
    const sorted = [...dateCandidates].sort((a, b) => {
      if (b.releaseTimestamp !== a.releaseTimestamp) return b.releaseTimestamp - a.releaseTimestamp;
      return a.title.localeCompare(b.title);
    });
    return sorted.slice(0, 10);
  }, [dateCandidates]);

  // Diagnostic — change-only with field breakdown
  const newLogRef = useRef<string>("");
  useEffect(() => {
    if (status !== "ready") return;

    const state = getCatalogState();
    const candidates = entries.filter((g) => g.appId && g.title && !isToolByTitle(g.title)).length;
    const withReleaseDate = entries.filter((g) => g.releaseTimestamp > 0).length;
    const withNewFlag = entries.filter((g) => g.isNew).length;
    const rendered = displayGames.length;

    const key = `${rendered}|${withReleaseDate}|${withNewFlag}`;

    if (withReleaseDate === 0 && withNewFlag === 0) {
      if (newLogRef.current !== `skip|${key}`) {
        newLogRef.current = `skip|${key}`;
        console.log(
          `[DASH][SECTION_SKIP] section=NewNoteworthy reason=no-date-or-new-fields total=${state.total}`,
        );
        console.log(
          `[DASH][NEW] catalogTotal=${state.total} candidates=${candidates} withReleaseDate=${withReleaseDate} withCatalogDate=0 withNewFlag=${withNewFlag} rendered=${rendered}`,
        );
      }
      return;
    }

    if (newLogRef.current !== key) {
      newLogRef.current = key;
      console.log(
        `[DASH][NEW] catalogTotal=${state.total} candidates=${candidates} withReleaseDate=${withReleaseDate} withCatalogDate=0 withNewFlag=${withNewFlag} rendered=${rendered}`,
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
    console.log(`[DASH][GLOBAL_CLICK] section=NewNoteworthy appid=${game.appId} title="${game.title}" inLibrary=${!!libGame} hasMedia=${hasMedia}`);
    if (libGame) {
      setSelectedGame(libGame);
      onNavigate?.("library-game-detail");
    } else {
      setPendingStoreDetailAppId(game.appId);
      onNavigate?.("store");
    }
  }

  function formatDate(ts: number): string {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-(--color-text)">
            New & Noteworthy
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            Recently released games
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
              console.log(`[DASH][GLOBAL_MEDIA] section=NewNoteworthy appid=${game.appId} src=${imgSrc.slice(0, 80)}`);
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
                    {game.releaseTimestamp > 0 && (
                      <span className="mt-1 inline-block rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-(--color-muted)">
                        {formatDate(game.releaseTimestamp)}
                      </span>
                    )}
                    {game.isNew && game.releaseTimestamp === 0 && (
                      <span className="mt-1 inline-block rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-(--color-muted)">
                        New
                      </span>
                    )}
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
