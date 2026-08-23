import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Star,
} from "lucide-react";
import AsyncImage from "../common/AsyncImage";

import type { PackageGame } from "../../types/package";
import type { PackageInstallStatus } from "../../types/packageInstall";
import type { SteamAppMetadata } from "../../types/gameMetadata";
import type { SteamReviewSummary } from "../../types/gameReview";

export type StoreMoreLikeThisGame = {
  game: PackageGame;
  metadata?: SteamAppMetadata;
  reviewSummary?: SteamReviewSummary;
  installStatus?: PackageInstallStatus;
};


type StoreMoreLikeThisSectionProps = {
  games: StoreMoreLikeThisGame[];
  onOpenGame?: (game: PackageGame) => void;
};

function getTitle(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.name || game.title;
}

function getDeveloper(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.developer || game.developer || "Developer unknown";
}

function getImage(game: PackageGame, metadata?: SteamAppMetadata) {
  if (metadata?.header_image) return metadata.header_image;
  const id = parseInt(game.appId, 10);
  if (id > 0) return `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`;
  return undefined;
}

function getReviewLabel(summary?: SteamReviewSummary) {
  if (!summary) {
    return "Review summary unavailable";
  }

  if (!summary.resolved) {
    return "Review summary unavailable";
  }

  if (summary.resolved && summary.total_reviews === 0) {
    return "No reviews yet";
  }

  if (typeof summary.positive_percent === "number") {
    return `${summary.review_score_desc} · ${summary.positive_percent}%`;
  }

  return summary.review_score_desc || "N/A";
}

export default function StoreMoreLikeThisSection({
  games,
  onOpenGame,
}: StoreMoreLikeThisSectionProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const _lastScrollUpdate = useRef(0);
  const updateScrollState = useCallback(() => {
    const now = Date.now();
    if (now - _lastScrollUpdate.current < 100) return;
    _lastScrollUpdate.current = now;
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState]);

  useEffect(() => {
    updateScrollState();
  }, [games, updateScrollState]);

  const scroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.75;
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  };

  const btnClass =
    "absolute top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-xl backdrop-blur transition hover:bg-black/80 group-hover/row:flex disabled:opacity-30 disabled:cursor-not-allowed";

  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-(--color-text)">
            More Like This
          </h2>

          <p className="mt-1 text-sm text-(--color-muted)">
            Juegos relacionados desde secciones del Store, resultados y providers cargados.
          </p>
        </div>
      </div>

      {games.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-(--surface-active-border) bg-black/20 p-5 text-sm text-(--color-muted)">
          No hay recomendaciones disponibles todavía.
        </div>
      ) : (
        <div className="group/row relative mt-4">
          <button
            type="button"
            aria-label="Scroll More Like This left"
            disabled={!canScrollLeft}
            onClick={() => scroll("left")}
            className={`left-1 ${btnClass}`}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div
            ref={scrollRef}
            className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {games.map(({ game, metadata, reviewSummary }) => {
            const title = getTitle(game, metadata);
            const developer = getDeveloper(game, metadata);
            const imageUrl = getImage(game, metadata);
            const reviewLabel = getReviewLabel(reviewSummary);

            return (
              <button
                key={"store:more-like-this:steam:" + game.appId}
                type="button"
                onClick={() => onOpenGame?.(game)}
                className="group relative h-36 w-64 shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-(--surface-active-border) bg-black/25 text-left transition hover:bg-white/[0.04] hover:border-(--color-accent)/40"
              >
                <AsyncImage
                  src={imageUrl}
                  alt={title}
                  className="h-full w-full"
                  fallback={
                    <div className="flex h-full w-full items-center justify-center bg-white/5">
                      <Gamepad2 className="h-8 w-8 text-(--color-muted)" />
                    </div>
                  }
                />

                <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/35 to-transparent" />

                <div className="absolute bottom-3 left-3 right-3">
                  <h3 className="line-clamp-1 text-sm font-bold text-white">
                    {title}
                  </h3>

                  <p className="mt-0.5 line-clamp-1 text-[11px] text-white/65">
                    {developer}
                  </p>

                  <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-white/55">
                    <Star className="h-3 w-3 text-(--color-accent)" />
                    {reviewLabel}
                  </div>
                </div>
              </button>
            );
          })}
          </div>

          <button
            type="button"
            aria-label="Scroll More Like This right"
            disabled={!canScrollRight}
            onClick={() => scroll("right")}
            className={`right-1 ${btnClass}`}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}
    </section>
  );
}
