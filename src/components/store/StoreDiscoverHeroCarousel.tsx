import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Gamepad2,
} from "lucide-react";
import AsyncImage from "../common/AsyncImage";
import { setAmbientSource, clearAmbientSource } from "../../services/ambientBackgroundStore";
import { subscribeHeroTransition, getHeroTransitionSnapshot } from "../../services/heroTransitionStore";
import { useCrossfadeSrc } from "../../hooks/useCrossfadeSrc";

import type { PackageGame } from "../../types/package";
import type { SteamAppMetadata } from "../../types/gameMetadata";
type StoreDiscoverHeroCarouselProps = {
  games: PackageGame[];
  storeMetadataByAppId: Record<number, SteamAppMetadata>;
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
): string | undefined {
  const meta = metadataByAppId[Number(game.appId)];

  return (
    meta?.header_image ||
    meta?.capsule_image ||
    meta?.capsule_image_v5 ||
    game.imageUrl ||
    undefined
  );
}

export default function StoreDiscoverHeroCarousel({
  games,
  storeMetadataByAppId,
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
  const ambientImage = activeGame
    ? getGameImage(activeGame, storeMetadataByAppId)
    : undefined;

  // Selectable hero/background transition (Settings → Animaciones). Crossfade
  // (default) uses the two-layer fade — the previous image stays mounted with
  // fade-out while the new one fades in on each auto-advance/manual click.
  useSyncExternalStore(subscribeHeroTransition, getHeroTransitionSnapshot, getHeroTransitionSnapshot);
  const heroTransition = getHeroTransitionSnapshot().id;
  const { prevSrc } = useCrossfadeSrc(ambientImage);

  // Feed the ambient background with the current hero artwork. Emitted on every
  // image change (manual clicks + 7s auto-advance). The single _detail slot
  // model means this wins while the carousel is mounted; it is cleared on
  // unmount so the store-details feed / context fallback can take over.
  useEffect(() => {
    setAmbientSource("store-hero", ambientImage ?? null);
  }, [ambientImage]);
  useEffect(() => () => clearAmbientSource("store-hero"), []);

  useEffect(() => {
    if (onIndexChange) {
      onIndexChange(activeIndex);
    }
  }, [activeIndex, onIndexChange]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isPaused || games.length <= 1) {
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
  const currentImage = getGameImage(current, storeMetadataByAppId);
  const railGames = games.slice(0, 5);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_260px]">
      <section
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        className="group relative overflow-hidden rounded-3xl border border-(--surface-active-border) bg-white/5"
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
          className="relative aspect-[21/9] cursor-pointer overflow-hidden bg-white/5"
        >
          {heroTransition === "crossfade" ? (
            <>
              {prevSrc && prevSrc !== currentImage && (
                <AsyncImage
                  src={prevSrc}
                  alt=""
                  className="absolute inset-0 animate-hero-media-out"
                  loading="eager"
                  fallback={<div className="h-full w-full" />}
                />
              )}
              <AsyncImage
                src={currentImage}
                alt={current.title}
                className="absolute inset-0 animate-hero-crossfade-in"
                loading="eager"
                fallback={
                  <div className="flex h-full w-full items-center justify-center">
                    <Gamepad2 className="h-16 w-16 text-(--color-muted)" />
                  </div>
                }
              />
            </>
          ) : (
            <AsyncImage
              src={currentImage}
              alt={current.title}
              className={`absolute inset-0 ${
                heroTransition === "kenburns"
                  ? "animate-hero-kenburns-in"
                  : "animate-hero-focus-in"
              }`}
              loading="eager"
              fallback={
                <div className="flex h-full w-full items-center justify-center">
                  <Gamepad2 className="h-16 w-16 text-(--color-muted)" />
                </div>
              }
            />
          )}

          <div className="absolute inset-0 bg-linear-to-r from-black/75 via-black/35 to-transparent" />
          <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent" />

          <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-8">
            <h2 className="max-w-xl text-2xl font-black text-white lg:text-3xl">
              {current.title}
            </h2>

            <div className="mt-4 flex flex-wrap gap-2 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100 md:absolute md:bottom-0 md:left-0 md:right-0 md:p-6 md:lg:p-8">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenGame(current);
                }}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-(--color-accent-text) transition hover:opacity-90"
              >
                Details
              </button>

              {hasAvailableSource && onDownload && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownload(current);
                  }}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
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
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/15 hover:text-white"
                >
                  Source
                </button>
              )}
            </div>
          </div>

          {games.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrev();
                }}
                className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur transition hover:bg-black/70"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNext();
                }}
                className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur transition hover:bg-black/70"
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
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveIndex(idx);
                  }}
                  className={`h-2 cursor-pointer rounded-full transition-all ${
                    idx === safeIndex
                      ? "w-6 bg-(--color-accent)"
                      : "w-2 bg-white/40 hover:bg-white/60"
                  }`}
                />
              ))}
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
              const railImage = getGameImage(game, storeMetadataByAppId);

              return (
                <button
                  key={"store:hero-rail:steam:" + game.appId}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-xl p-2 text-left transition ${
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
