import { memo, useState } from "react";
import type { StoreGame } from "../../services/storeDiscoverCache";

type GenreCollectionCardProps = {
  genre: string;
  games: StoreGame[];
  onClick: () => void;
};

function GenreCollectionCardInner({ genre, games, onClick }: GenreCollectionCardProps) {
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());

  const handleError = (appId: string) => {
    setImgErrors((prev) => {
      const next = new Set(prev);
      next.add(appId);
      return next;
    });
  };

  const cells = [0, 1, 2, 3];

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-[200px] shrink-0 cursor-pointer overflow-hidden rounded-xl border border-white/[0.06] transition-all duration-200 hover:scale-[1.02] hover:border-[var(--color-accent)]/40 hover:shadow-lg hover:shadow-[var(--color-accent)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/60 lf-fade-in"
    >
      {/* 2×2 mosaic grid */}
      <div className="grid h-[160px] grid-cols-2 grid-rows-2 gap-0">
        {cells.map((i) => {
          const game = games[i];
          const imgUrl = game?.imageUrl;
          const hasError = game ? imgErrors.has(game.appId) : true;
          const showImg = imgUrl && !hasError;

          return (
            <div key={i} className="relative h-full w-full overflow-hidden bg-white/[0.04]">
              {showImg ? (
                <img
                  src={imgUrl}
                  alt=""
                  loading="lazy"
                  onError={() => game && handleError(game.appId)}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-white/[0.08] to-white/[0.02]" />
              )}
            </div>
          );
        })}
      </div>

      {/* Dark overlay for label readability */}
      <div className="pointer-events-none absolute inset-0 bg-black/40 transition-colors duration-200 group-hover:bg-black/25" />

      {/* Genre label centered */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="rounded-lg bg-black/50 px-3 py-1.5 text-sm font-bold text-white shadow-lg backdrop-blur-sm transition-transform duration-200 group-hover:scale-105">
          {genre}
        </span>
      </div>
    </button>
  );
}

export const GenreCollectionCard = memo(GenreCollectionCardInner);
