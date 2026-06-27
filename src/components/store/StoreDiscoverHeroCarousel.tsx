import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Gamepad2,
} from "lucide-react";

import type { PackageGame } from "../../types/package";
import type { PackageInstallStatus } from "../../types/packageInstall";
import type { SteamAppMetadata } from "../../types/gameMetadata";

type StoreDiscoverHeroCarouselProps = {
  games: PackageGame[];
  storeMetadataByAppId: Record<number, SteamAppMetadata>;
  installedStatusByAppId: Map<string, PackageInstallStatus>;
  onOpenGame: (game: PackageGame) => void;
  onOpenSteam: (appId: string) => void;
};

const AUTO_ADVANCE_MS = 7000;

function getGameImage(
  game: PackageGame,
  metadataByAppId: Record<number, SteamAppMetadata>
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
  installedStatusByAppId,
  onOpenGame,
  onOpenSteam,
}: StoreDiscoverHeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
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

  const currentInstallStatus = installedStatusByAppId.get(current.appId);
  const hasAvailableSource = current.sources.some((s) => s.available);
  const currentImage = getGameImage(current, storeMetadataByAppId);
  const railGames = games.slice(0, 5);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_260px]">
      <section
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        className="relative overflow-hidden rounded-3xl border border-(--surface-active-border) bg-white/5"
      >
        <div className="relative aspect-[21/9] overflow-hidden bg-white/5">
          {currentImage ? (
            <img
              src={currentImage}
              alt={current.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Gamepad2 className="h-16 w-16 text-(--color-muted)" />
            </div>
          )}

          <div className="absolute inset-0 bg-linear-to-r from-black/80 via-black/45 to-transparent" />
          <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent" />

          <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-8">
            <h2 className="max-w-xl text-2xl font-black text-white lg:text-3xl">
              {current.title}
            </h2>

            {current.developer && (
              <p className="mt-1.5 text-sm text-white/70">
                {current.developer}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {currentInstallStatus === "active" && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Installed
                </span>
              )}

              {hasAvailableSource && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
                  Lua Ready
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onOpenGame(current)}
                className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-black transition hover:opacity-90"
              >
                Details
              </button>

              <button
                type="button"
                onClick={() => onOpenSteam(current.appId)}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
              >
                <ExternalLink className="h-4 w-4" />
                Steam
              </button>
            </div>
          </div>

          {games.length > 1 && (
            <>
              <button
                type="button"
                onClick={handlePrev}
                className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur transition hover:bg-black/70"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              <button
                type="button"
                onClick={handleNext}
                className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur transition hover:bg-black/70"
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
                  onClick={() => setActiveIndex(idx)}
                  className={`h-2 rounded-full transition-all ${
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
              const railInstalled = installedStatusByAppId.get(game.appId);

              return (
                <button
                  key={game.appId}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition ${
                    isActive
                      ? "bg-(--color-accent)/10 ring-1 ring-(--color-accent)/30"
                      : "hover:bg-white/5"
                  }`}
                >
                  <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-white/5">
                    {railImage ? (
                      <img
                        src={railImage}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Gamepad2 className="h-5 w-5 text-(--color-muted)" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-medium text-(--color-text)">
                      {game.title}
                    </p>

                    {railInstalled === "active" && (
                      <p className="mt-0.5 text-[11px] text-emerald-300">
                        Installed
                      </p>
                    )}
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
