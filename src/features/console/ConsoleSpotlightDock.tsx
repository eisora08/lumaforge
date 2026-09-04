import { Sparkles, Play, HardDrive, Code, Heart, LayoutGrid } from "lucide-react";

const CATEGORIES = [
  { label: "New", key: "new", icon: Sparkles, fullLabel: "New Games" },
  { label: "Continue", key: "continue", icon: Play, fullLabel: "Continue Playing" },
  { label: "Installed", key: "installed", icon: HardDrive, fullLabel: "Installed Games" },
  { label: "Lua", key: "lua", icon: Code, fullLabel: "Lua / In Library" },
  { label: "Favorites", key: "favorites", icon: Heart, fullLabel: "Favorites" },
  { label: "All", key: "all", icon: LayoutGrid, fullLabel: "All Games" },
] as const;

type Props = {
  activeIndex: number;
  focusedIndex?: number;
  counts: number[];
  onSelect: (index: number) => void;
};

export default function ConsoleSpotlightDock({ activeIndex, focusedIndex = -1, counts, onSelect }: Props) {
  return (
    <nav aria-label="Spotlight category dock">
      <div
        className="lf-surface inline-flex items-center rounded-full px-[clamp(16px,1.8vw,24px)] py-2 shadow-2xl shadow-black/50 ring-1 ring-white/[0.12]"
        style={{ height: "clamp(60px, 7vh, 72px)", gap: "clamp(12px, 1.4vw, 18px)" }}
      >
        {CATEGORIES.map((cat, i) => {
          const isActive = activeIndex === i;
          const isFocused = focusedIndex === i;
          const Icon = cat.icon;
          return (
            <button
              key={cat.key}
              tabIndex={-1}
              onClick={() => onSelect(i)}
              className={`relative flex items-center justify-center rounded-xl transition-all duration-200 ${
                isActive
                  ? "bg-(--color-accent) text-(--color-accent-text) shadow-lg shadow-(--color-accent)/35 scale-105"
                  : "text-white/60 hover:text-white/85 hover:bg-white/[0.08]"
              } ${
                isFocused && !isActive
                  ? "ring-2 ring-white/40"
                  : isFocused
                    ? "ring-2 ring-white/70"
                    : ""
              }`}
              style={{
                width: isFocused ? "clamp(52px, 5.8vw, 66px)" : "clamp(44px, 5vw, 52px)",
                height: "clamp(40px, 4.5vh, 48px)",
              }}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {/* Label appears on focus — slides in from the right */}
              {isFocused && (
                <span
                  className="dock-label-animated ml-1.5 max-w-[100px] truncate text-[11px] font-semibold text-white/90"
                  style={{
                    animation: "dock-label-in 180ms ease-out both",
                  }}
                >
                  {cat.fullLabel}
                </span>
              )}
              {counts[i] > 0 && (
                <span
                  className={`absolute -top-1.5 -right-1.5 flex min-w-[18px] items-center justify-center rounded-full px-1 py-[1px] text-[10px] font-bold tabular-nums ${
                    isActive
                      ? "bg-white text-(--color-accent)"
                      : "bg-(--color-surface) text-(--color-muted)"
                  }`}
                >
                  {counts[i] > 99 ? "99+" : counts[i]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
