import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DashboardHorizontalRailProps {
  children: React.ReactNode;
  gap: number;
}

export default function DashboardHorizontalRail({ children, gap }: DashboardHorizontalRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [overflow, setOverflow] = useState(false);

  const _lastScrollUpdate = useRef(0);
  const updateScrollState = useCallback(() => {
    const now = Date.now();
    if (now - _lastScrollUpdate.current < 100) return;
    _lastScrollUpdate.current = now;
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 4;
    const has = el.scrollWidth > el.clientWidth + threshold;
    setOverflow(has);
    setCanScrollLeft(el.scrollLeft > threshold);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - threshold);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState]);

  const childCount = Array.isArray(children) ? children.length : 1;
  useEffect(() => {
    updateScrollState();
  }, [childCount, gap, updateScrollState]);

  function scroll(direction: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.round(el.clientWidth * 0.85);
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  }

  return (
    <div className="group/row relative">
      <div
        ref={scrollRef}
        className="flex snap-x overflow-x-auto scroll-smooth pb-2 scrollbar-none"
        style={{ gap: `${gap}px` }}
      >
        {children}
      </div>

      {overflow && (
        <button
          type="button"
          onClick={() => scroll("left")}
          className={`absolute -left-2 top-1/2 z-30 h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-xl backdrop-blur transition-all duration-150 hover:bg-black/80 hover:scale-105 ${
            canScrollLeft ? "group-hover/row:flex" : ""
          } hidden`}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}

      {overflow && (
        <button
          type="button"
          onClick={() => scroll("right")}
          className={`absolute -right-2 top-1/2 z-30 h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-xl backdrop-blur transition-all duration-150 hover:bg-black/80 hover:scale-105 ${
            canScrollRight ? "group-hover/row:flex" : ""
          } hidden`}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
