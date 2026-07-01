import { Children, ReactNode, useRef } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type StoreHorizontalSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  onViewAll?: () => void;
};

export default function StoreHorizontalSection({
  title,
  description,
  children,
  onViewAll,
}: StoreHorizontalSectionProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  function handleScroll(direction: "left" | "right") {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    const amount = Math.round(element.clientWidth * 0.85);

    element.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  }

  const items = Children.toArray(children);

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-(--color-text)">
            {title}
          </h2>

          {description && (
            <p className="mt-1 text-sm text-(--color-muted)">
              {description}
            </p>
          )}
        </div>

        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
          >
            Ver todo
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="group/row relative">
        <button
          type="button"
          onClick={() => handleScroll("left")}
          className="absolute left-2 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-xl backdrop-blur transition hover:bg-black/80 group-hover/row:flex"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div
          ref={scrollRef}
          className="flex snap-x gap-4 overflow-x-auto scroll-smooth pb-2 scrollbar-none [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item, index) => (
            <div
              key={index}
              className="w-[min(82vw,420px)] shrink-0 snap-start md:w-95 xl:w-105 lf-fade-in"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              {item}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => handleScroll("right")}
          className="absolute right-2 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-xl backdrop-blur transition hover:bg-black/80 group-hover/row:flex"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </section>
  );
}