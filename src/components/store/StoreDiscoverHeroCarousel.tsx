import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Gamepad2,
  Star,
} from "lucide-react";
import AsyncImage from "../common/AsyncImage";
import { setAmbientSource, clearAmbientSource } from "../../services/ambientBackgroundStore";
import { subscribeHeroTransition, getHeroTransitionSnapshot } from "../../services/heroTransitionStore";
import { useCrossfadeSrc } from "../../hooks/useCrossfadeSrc";

import type { PackageGame } from "../../types/package";
import type { SteamAppMetadata } from "../../types/gameMetadata";
import type { SteamReviewSummary } from "../../types/gameReview";
import type { SgdbArtworkData } from "../../services/storeArtworkResolver";
type StoreDiscoverHeroCarouselProps = {
  games: PackageGame[];
  storeMetadataByAppId: Record<number, SteamAppMetadata>;
  reviewSummaryByAppId?: Record<number, SteamReviewSummary>;
  sgdbArtworkByAppId?: Record<string, SgdbArtworkData>;
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
  onOpenGame: (game: PackageGame) => void;
  onDownload?: (game: PackageGame) => void;
  onOpenSourceSelector?: (game: PackageGame) => void;
};

const AUTO_ADVANCE_MS = 7000;

function getGameImage(
  game: PackageGame,
  metadataByAppId: Record<number, SteamAppMetadata>,
  sgdbArtworkByAppId?: Record<string, SgdbArtworkData>,
): string | undefined {
  const sgdb = sgdbArtworkByAppId?.[game.appId];
  if (sgdb?.sgdbHeroUrl) return sgdb.sgdbHeroUrl;

  const meta = metadataByAppId[Number(game.appId)];
  const id = parseInt(game.appId, 10);
  const cdnFallback = id > 0 ? `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg` : undefined;

  return (
    meta?.library_hero_image ||
    meta?.hero_image ||
    meta?.header_image ||
    meta?.capsule_image ||
    meta?.capsule_image_v5 ||
    (game.imageUrl && !/storepagebackground|store_page_background/i.test(game.imageUrl) ? game.imageUrl : undefined) ||
    cdnFallback
  );
}

export default function StoreDiscoverHeroCarousel({
  games,
  storeMetadataByAppId,
  reviewSummaryByAppId,
  sgdbArtworkByAppId,
  initialIndex = 0,
  onIndexChange,
  onOpenGame,
  onDownload,
  onOpenSourceSelector,
}: StoreDiscoverHeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [isPaused, setIsPaused] = useState(false);
  const indexRef = useRef(activeIndex);
  indexRef.current = activeIndex;

  const activeGame =
    games.length > 0 ? games[Math.min(activeIndex, games.length - 1)] : undefined;
  const resolvedImage = activeGame
    ? getGameImage(activeGame, storeMetadataByAppId, sgdbArtworkByAppId)
    : undefined;

  // Selectable hero/background transition (Settings → Animaciones). Crossfade
  // (default) uses the two-layer fade — the previous image stays mounted with
  // fade-out while the new one fades in on each auto-advance/manual click.
  useSyncExternalStore(subscribeHeroTransition, getHeroTransitionSnapshot, getHeroTransitionSnapshot);
  const heroTransition = getHeroTransitionSnapshot().id;
  const { prevSrc } = useCrossfadeSrc(resolvedImage);

  // Feed the ambient background with the current hero artwork. Emitted on every
  // image change (manual clicks + 7s auto-advance). The single _detail slot
  // model means this wins while the carousel is mounted; it is cleared on
  // unmount so the store-details feed / context fallback can take over.
  useEffect(() => {
    setAmbientSource("store-hero", resolvedImage ?? null);
  }, [resolvedImage]);
  useEffect(() => () => clearAmbientSource("store-hero"), []);

  useEffect(() => {
    if (onIndexChange) {
      onIndexChange(activeIndex);
    }
  }, [activeIndex, onIndexChange]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isPaused || document.hidden || games.length <= 1) {
      return;
    }

    intervalRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % games.length);
    }, AUTO_ADVANCE_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPaused, games.length]);

  if (games.length === 0) {
    return null;
  }

  const safeIndex = Math.min(activeIndex, games.length - 1);
  const current = games[safeIndex];

  function handlePrev() {
    setActiveIndex((prev) => (prev - 1 + games.length) % games.length);
  }

  function handleNext() {
    setActiveIndex((prev) => (prev + 1) % games.length);
  }

  const hasAvailableSource = current.sources.some((s) => s.available);
  const currentImage = resolvedImage ?? getGameImage(current, storeMetadataByAppId, sgdbArtworkByAppId);
  const railGames = games;

  // Dev-only: verify hero slides, pagination, and sidebar always match
  if (import.meta.env.DEV && railGames.length !== games.length) {
    console.warn(
      `[HERO_SYNC] Mismatch: hero=${games.length} sidebar=${railGames.length} — both must derive from the same featuredGames array`,
    );
  }

  const currentMeta = storeMetadataByAppId[Number(current.appId)];
  const currentReview = reviewSummaryByAppId?.[Number(current.appId)];
  const developer = currentMeta?.developer || current.developer;
  const genres = currentMeta?.genres?.slice(0, 3) ?? [];
  const shortDesc = currentMeta?.short_description;

  return (
    <div className="grid grid-cols-1 gap-4 px-4 sm:px-6 lg:px-8 xl:grid-cols-[1fr_260px] xl:px-10">
      <section
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        aria-roledescription="carousel"
        aria-label="Featured games"
        className="group relative min-h-[300px] sm:min-h-[380px] lg:min-h-[440px] xl:min-h-[480px] overflow-hidden rounded-3xl border border-(--surface-active-border) bg-white/5"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpenGame(current)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              onOpenGame(current);
            }
          }}
          className="absolute inset-0 cursor-pointer overflow-hidden bg-white/5"
        >
          {heroTransition === "crossfade" ? (
            <>
              {prevSrc && prevSrc !== currentImage && (
                <div className="absolute inset-0 animate-hero-media-out">
                  <AsyncImage
                    src={prevSrc}
                    alt=""
                    className="h-full w-full"
                    loading="eager"
                    fallback={<div className="h-full w-full" />}
                  />
                </div>
              )}
              <div key={safeIndex} className="absolute inset-0 animate-hero-crossfade-in">
                <div
                  className={`h-full w-full ${isPaused ? "" : "animate-hero-slow-zoom"}`}
                  style={isPaused ? undefined : { animationDuration: `${AUTO_ADVANCE_MS}ms` }}
                >
                  <AsyncImage
                    src={currentImage}
                    alt={current.title}
                    className="h-full w-full"
                    loading="eager"
                    fallback={
                      <div className="flex h-full w-full items-center justify-center">
                        <Gamepad2 className="h-16 w-16 text-(--color-muted)" />
                      </div>
                    }
                  />
                </div>
              </div>
            </>
          ) : heroTransition === "kenburns" ? (
            <div className="absolute inset-0 animate-hero-kenburns-in">
              <AsyncImage
                src={currentImage}
                alt={current.title}
                className="h-full w-full"
                loading="eager"
                fallback={
                  <div className="flex h-full w-full items-center justify-center">
                    <Gamepad2 className="h-16 w-16 text-(--color-muted)" />
                  </div>
                }
              />
            </div>
          ) : (
            <div className="absolute inset-0 animate-hero-focus-in">
              <div
                className={`h-full w-full ${isPaused ? "" : "animate-hero-slow-zoom"}`}
                style={isPaused ? undefined : { animationDuration: `${AUTO_ADVANCE_MS}ms` }}
              >
                <AsyncImage
                  src={currentImage}
                  alt={current.title}
                  className="h-full w-full"
                  loading="eager"
                  fallback={
                    <div className="flex h-full w-full items-center justify-center">
                      <Gamepad2 className="h-16 w-16 text-(--color-muted)" />
                    </div>
                  }
                />
              </div>
            </div>
          )}

          <div className="absolute inset-0 bg-linear-to-r from-black/80 via-black/40 to-transparent" />
          <div className="absolute inset-0 bg-linear-to-t from-black/65 via-black/10 to-transparent" />

          <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-8">
            <h2 aria-live="polite" className="max-w-xl text-2xl font-black text-white lg:text-3xl">
              {current.title}
            </h2>

            {(developer || (currentReview?.positive_percent != null && currentReview.positive_percent > 0)) && (
              <div className="mt-1.5 flex items-center gap-2.5">
                {developer && (
                  <span className="text-sm text-white/60">{developer}</span>
                )}
                {currentReview?.positive_percent != null && currentReview.positive_percent > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-xs font-medium backdrop-blur-sm">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    <span className="text-white">{Math.round(currentReview.positive_percent)}%</span>
                  </span>
                )}
              </div>
            )}

            {genres.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {genres.map((g) => (
                  <span
                    key={g}
                    className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/80 backdrop-blur-sm"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            {shortDesc && (
              <p
                className="mt-2.5 hidden max-w-lg text-sm leading-relaxed text-white/50 line-clamp-2 xl:block"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: shortDesc }}
              />
            )}

            {(hasAvailableSource || current.sources.length > 0) && (
              <div className="mt-4 flex items-center gap-3 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                {hasAvailableSource && onDownload && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(current);
                    }}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-black/30 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition duration-150 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.97]"
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </button>
                )}

                {current.sources.length > 0 && onOpenSourceSelector && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSourceSelector(current);
                    }}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-black/30 px-5 py-2.5 text-sm font-medium text-white/80 backdrop-blur-sm transition hover:bg-white/15 hover:text-white"
                  >
                    Source
                  </button>
                )}
              </div>
            )}
          </div>

          {games.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous slide"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrev();
                }}
                className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur transition duration-150 hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.95]"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              <button
                type="button"
                aria-label="Next slide"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNext();
                }}
                className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur transition duration-150 hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.95]"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}

          {games.length > 1 && (
            <div className="absolute bottom-4 right-6 z-10 flex gap-2">
              {games.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={`Go to slide ${idx + 1}: ${games[idx].title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveIndex(idx);
                  }}
                  className={`h-2 cursor-pointer rounded-full transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                    idx === safeIndex
                      ? "w-6 bg-(--color-accent)"
                      : "w-2 bg-white/40 hover:bg-white/60"
                  }`}
                />
              ))}
            </div>
          )}

          {games.length > 1 && (
            <div
              key={`progress-${safeIndex}`}
              className="absolute bottom-0 left-0 right-0 z-20 h-[2px] overflow-hidden bg-white/10"
            >
              <div
                className={`h-full bg-(--color-accent) ${isPaused ? "" : "animate-hero-progress"}`}
                style={isPaused ? { transform: "scaleX(1)" } : { animationDuration: `${AUTO_ADVANCE_MS}ms` }}
              />
            </div>
          )}
        </div>
      </section>

      {railGames.length > 0 && (
        <div className="hidden space-y-3 xl:block">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
            Featured
          </h3>

          <div className="space-y-2">
            {railGames.map((game, idx) => {
              const isActive = idx === safeIndex;
              const railImage = getGameImage(game, storeMetadataByAppId, sgdbArtworkByAppId);

              return (
                <button
                  key={"store:hero-rail:steam:" + game.appId}
                  type="button"
                  aria-label={`Select ${game.title}`}
                  onClick={() => setActiveIndex(idx)}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-xl p-2 text-left transition duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) ${
                    isActive
                      ? "bg-(--color-accent)/10 ring-1 ring-(--color-accent)/30"
                      : "hover:bg-white/5"
                  }`}
                >
                  <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-white/5">
                    <AsyncImage
                      src={railImage}
                      alt=""
                      className="h-full w-full"
                      fallback={
                        <div className="flex h-full w-full items-center justify-center">
                          <Gamepad2 className="h-5 w-5 text-(--color-muted)" />
                        </div>
                      }
                    />
                  </div>

                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-medium text-(--color-text)">
                      {game.title}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
