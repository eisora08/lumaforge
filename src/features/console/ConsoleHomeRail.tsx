import { useRef, useEffect, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import { deduplicateByStableId } from "../../services/gameCacheService";
import ConsoleGameCard from "./ConsoleGameCard";

type Props = {
  title: string;
  subtitle?: string;
  games: LibraryGame[];
  railIndex: number;
  focusedRail: number;
  focusedIndex: number;
  onSelectGame?: (game: LibraryGame) => void;
  onCardHover?: (game: LibraryGame) => void;
  onCardHoverEnd?: () => void;
  runningGameKeys?: Set<string>;
  cardCompact?: boolean;
  cardVariant?: "landscape" | "poster";
  cardWidth?: number;
  cardGap?: number;
  noCardLabels?: boolean;
  hideHeader?: boolean;
};

export default function ConsoleHomeRail({
  title,
  subtitle,
  games,
  railIndex,
  focusedRail,
  focusedIndex,
  onSelectGame,
  onCardHover,
  onCardHoverEnd,
  runningGameKeys,
  cardCompact,
  cardVariant = "landscape",
  cardWidth,
  cardGap,
  noCardLabels,
  hideHeader,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const deduped = useMemo(() => deduplicateByStableId(games), [games]);

  const isFocusedRail = focusedRail === railIndex;
  const focusedCardIndex = isFocusedRail ? focusedIndex : -1;

  useEffect(() => {
    if (focusedCardIndex < 0) return;
    const container = scrollRef.current;
    if (!container) return;
    const cards = container.children;
    const card = cards[focusedCardIndex] as HTMLElement | undefined;
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [focusedCardIndex]);

  const scroll = useCallback((direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.round(el.clientWidth * 0.85);
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  }, []);

  if (deduped.length === 0) return null;

  return (
    <section>
      {!hideHeader && (
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
      )}

      <div className="group/row relative">
        <button
          type="button"
          onClick={() => scroll("left")}
          className="absolute -left-2 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-xl backdrop-blur transition hover:bg-black/80 group-hover/row:flex"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {/*
          Outer wrapper provides VERTICAL padding so the focused card's
          translateY(-44px) and scale(1.18) do not get clipped by the scroll
          container's overflow.

          The inner scroll container has overflow-x:auto for horizontal
          scrolling but is wrapped in this overflow-visible parent so any
          vertical overflow from card transforms extends outside the scroll
          container boundaries and into the carousel stage (which itself has
          overflow-visible). This allows the focused card to visually float
          upward without being clipped.
        */}
        <div
          className="relative overflow-visible"
          style={{
            paddingTop: "76px",
            paddingBottom: "52px",
          }}
        >
          <div
            ref={scrollRef}
            className="flex snap-x overflow-x-auto overflow-y-visible scroll-smooth scrollbar-none"
            style={{ gap: `${cardGap ?? 16}px` }}
          >
            {deduped.map((game, i) => (
              <ConsoleGameCard
                key={"console:rail:" + (game.appId || game.id)}
                game={game}
                isFocused={isFocusedRail && focusedIndex === i}
                isRunning={runningGameKeys?.has(game.appId || game.id) ?? false}
                onClick={() => onSelectGame?.(game)}
                onHover={() => onCardHover?.(game)}
                onHoverEnd={() => onCardHoverEnd?.()}
                compact={cardCompact}
                variant={cardVariant}
                cardWidth={cardWidth}
                noTitle={noCardLabels}
              />
            ))}
          </div>
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
