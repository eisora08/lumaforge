import { useRef, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import { deduplicateByAppId } from "../../services/gameCacheService";
import ConsoleGameCard from "./ConsoleGameCard";

type Props = {
  title: string;
  subtitle?: string;
  games: LibraryGame[];
  onSelectGame?: (game: LibraryGame) => void;
};

export default function ConsoleHomeRail({ title, subtitle, games, onSelectGame }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const deduped = useMemo(() => deduplicateByAppId(games), [games]);

  function scroll(direction: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.round(el.clientWidth * 0.85);
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  }

  if (deduped.length === 0) return null;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-(--color-text)">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-sm text-(--color-muted)">
              {subtitle}
            </p>
          )}
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
          {deduped.map((game) => (
            <div
              key={"console:rail:" + game.appId}
              onClick={() => onSelectGame?.(game)}
            >
              <ConsoleGameCard game={game} />
            </div>
          ))}
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
