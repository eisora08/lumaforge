import { useCallback, useRef, useState, useEffect } from "react";
import { Play, Image, ChevronLeft, ChevronRight } from "lucide-react";
import type { StoreMediaItem } from "../../types/store";

const RAIL_SCROLL_AMOUNT = 320;

type Props = {
  items: StoreMediaItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  focusedIndex?: number;
};

export default function ConsoleMediaGallery({ items, selectedIndex, onSelect, focusedIndex }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateRailScrollState = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateRailScrollState);
    const ro = new ResizeObserver(updateRailScrollState);
    ro.observe(el);
    updateRailScrollState();
    return () => { el.removeEventListener("scroll", updateRailScrollState); ro.disconnect(); };
  }, [items.length, updateRailScrollState]);

  useEffect(() => {
    const btn = thumbRefs.current.get(selectedIndex);
    if (btn) btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [selectedIndex]);

  const handleRailScroll = useCallback((dir: "left" | "right") => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -RAIL_SCROLL_AMOUNT : RAIL_SCROLL_AMOUNT, behavior: "smooth" });
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="relative">
      {canScrollLeft && (
        <button type="button" onClick={() => handleRailScroll("left")}
          className="absolute -left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/70 p-1 text-white/60 backdrop-blur-sm shadow-lg transition hover:bg-black/90 hover:text-white">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}
      {canScrollRight && (
        <button type="button" onClick={() => handleRailScroll("right")}
          className="absolute -right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/70 p-1 text-white/60 backdrop-blur-sm shadow-lg transition hover:bg-black/90 hover:text-white">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}

      <div
        ref={railRef}
        className="flex gap-2 overflow-x-auto rounded-xl bg-(--color-surface)/20 p-2 scrollbar-thin scrollbar-thumb-(--color-border)/30"
      >
        {items.map((item, idx) => {
          const isSelected = idx === selectedIndex;
          const isFocused = focusedIndex === idx;
          const thumbSrc = item.type === "trailer"
            ? (item.poster || item.thumbnail)
            : (item.thumbnail || item.image);

          return (
            <button
              key={item.id}
              ref={(el) => { if (el) thumbRefs.current.set(idx, el); else thumbRefs.current.delete(idx); }}
              type="button"
              onClick={() => onSelect(idx)}
              className={`relative h-[72px] w-[128px] shrink-0 overflow-hidden rounded-xl transition-all duration-150 ${
                isSelected
                  ? "ring-2 ring-(--color-accent) ring-offset-2 ring-offset-(--color-bg)/80 shadow-lg shadow-(--color-accent)/20"
                  : "ring-1 ring-white/[0.06] opacity-70 hover:opacity-100"
              } ${
                isFocused
                  ? "scale-[1.04] ring-(--color-accent)/60"
                  : isSelected
                  ? "scale-[1.03]"
                  : ""
              }`}
              tabIndex={-1}
            >
              {thumbSrc ? (
                <img src={thumbSrc} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-(--color-surface)/40">
                  {item.type === "trailer" ? (
                    <Play className="h-5 w-5 text-(--color-muted)/40" />
                  ) : (
                    <Image className="h-5 w-5 text-(--color-muted)/40" />
                  )}
                </div>
              )}
              {/* Play / image badge on thumbnail */}
              {item.type === "trailer" ? (
                <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5">
                  <Play className="h-3 w-3 fill-white/80 text-white/80" />
                </div>
              ) : (
                <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5">
                  <Image className="h-3 w-3 text-white/80" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
