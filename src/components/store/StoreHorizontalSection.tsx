import { Children, memo, ReactNode, useEffect, useRef } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { countRender } from "../../services/perfCounters";

type StoreHorizontalSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  onViewAll?: () => void;
  /** When this value changes, auto-scroll to the far right of the container. */
  autoScrollToEndKey?: string | number | null;
  /** Optional prefix for composite keys: `${sectionKey}:steam:${index}` */
  sectionKey?: string;
  /** Show skeleton loading placeholders instead of children */
  loading?: boolean;
  /** Number of skeleton cards to show when loading (default 6) */
  skeletonCount?: number;
  /** Show accent line under section title */
  accent?: boolean;
};

function areSectionPropsEqual(
  a: StoreHorizontalSectionProps,
  b: StoreHorizontalSectionProps,
): boolean {
  // Section metadata — string changes trigger re-render
  if (a.title !== b.title) return false;
  if (a.description !== b.description) return false;
  if (a.sectionKey !== b.sectionKey) return false;
  if (a.loading !== b.loading) return false;
  if (a.accent !== b.accent) return false;
  if (a.skeletonCount !== b.skeletonCount) return false;
  // onViewAll handler identity (stable if useCallback-ed in parent)
  if (a.onViewAll !== b.onViewAll) return false;
  // autoScrollToEndKey
  if (a.autoScrollToEndKey !== b.autoScrollToEndKey) return false;
  // Skip children — PackageCard has its own memo, section re-render is cheap
  // if title/description/sectionKey haven't changed
  return true;
}

function StoreHorizontalSectionRaw({
  title,
  description,
  children,
  onViewAll,
  autoScrollToEndKey,
  sectionKey,
  loading = false,
  skeletonCount = 6,
  accent = false,
}: StoreHorizontalSectionProps) {
  countRender("StoreHorizontalSection");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [autoScrollToEndKey]);

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

  if (items.length === 0 && !loading) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className={`text-xl font-bold text-(--color-text) ${accent ? "lf-store-section-accent" : ""}`}>
            {title}
          </h2>

          {description && (
            <p className="mt-1 text-sm text-(--color-muted)">
              {description}
            </p>
          )}
        </div>

        {onViewAll && !loading && (
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
          {loading
            ? Array.from({ length: skeletonCount }, (_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="w-[min(82vw,420px)] shrink-0 snap-start md:w-95 xl:w-105"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="lf-store-skeleton-card aspect-[460/215] w-full" />
                  <div className="mt-2.5 space-y-1.5">
                    <div className="lf-store-skeleton-card h-4 w-3/4 rounded" />
                    <div className="lf-store-skeleton-card h-3 w-1/2 rounded" />
                  </div>
                </div>
              ))
            : items.map((item, index) => (
                <div
                  key={sectionKey ? `${sectionKey}:steam:${index}` : index}
                  className="w-[min(82vw,420px)] shrink-0 snap-start md:w-95 xl:w-105 lf-fade-in lf-store-card-glow"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  {item}
                </div>
              ))
          }
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

const StoreHorizontalSection = memo(StoreHorizontalSectionRaw, areSectionPropsEqual);
export default StoreHorizontalSection;
