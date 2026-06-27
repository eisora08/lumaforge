import {
  CheckCircle2,
  Gamepad2,
  Star,
} from "lucide-react";

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
  return (
    metadata?.header_image ||
    metadata?.capsule_image ||
    metadata?.capsule_image_v5 ||
    game.imageUrl
  );
}

function getReviewLabel(summary?: SteamReviewSummary) {
  if (!summary || !summary.resolved || summary.total_reviews === 0) {
    return "No reviews";
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
        <div className="mt-4 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {games.map(({ game, metadata, reviewSummary, installStatus }) => {
            const title = getTitle(game, metadata);
            const developer = getDeveloper(game, metadata);
            const imageUrl = getImage(game, metadata);
            const reviewLabel = getReviewLabel(reviewSummary);
            const hasSources = game.sources.some((source) => source.available);

            return (
              <button
                key={game.appId}
                type="button"
                onClick={() => onOpenGame?.(game)}
                className="group relative h-36 w-64 shrink-0 overflow-hidden rounded-2xl border border-(--surface-active-border) bg-black/25 text-left transition hover:border-(--color-accent)/40"
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={title}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/5">
                    <Gamepad2 className="h-8 w-8 text-(--color-muted)" />
                  </div>
                )}

                <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/35 to-transparent" />

                <div className="absolute left-3 right-3 top-3 flex flex-wrap gap-1.5">
                  {installStatus === "active" && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      Installed
                    </span>
                  )}

                  {hasSources && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-2 py-0.5 text-[10px] text-(--color-accent)">
                      Lua Ready
                    </span>
                  )}
                </div>

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
      )}
    </section>
  );
}