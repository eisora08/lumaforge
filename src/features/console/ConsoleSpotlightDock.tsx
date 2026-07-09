import { Play, HardDrive, Code, Heart, LayoutGrid } from "lucide-react";

const CATEGORIES = [
  { label: "Continue", key: "continue", icon: Play },
  { label: "Installed", key: "installed", icon: HardDrive },
  { label: "Lua", key: "lua", icon: Code },
  { label: "Favorites", key: "favorites", icon: Heart },
  { label: "All", key: "all", icon: LayoutGrid },
] as const;

type Props = {
  activeIndex: number;
  counts: number[];
  onSelect: (index: number) => void;
};

export default function ConsoleSpotlightDock({ activeIndex, counts, onSelect }: Props) {
  return (
    <nav aria-label="Spotlight category dock">
      <div
        className="inline-flex items-center rounded-full bg-black/55 px-[clamp(16px,1.8vw,24px)] py-2 shadow-2xl shadow-black/50 backdrop-blur-2xl ring-1 ring-white/[0.12]"
        style={{ height: "clamp(60px, 7vh, 72px)", gap: "clamp(12px, 1.4vw, 18px)" }}
      >
        {CATEGORIES.map((cat, i) => {
          const isActive = activeIndex === i;
          const Icon = cat.icon;
          return (
            <button
              key={cat.key}
              onClick={() => onSelect(i)}
              className={`relative flex items-center justify-center rounded-xl transition-all duration-200 ${
                isActive
                  ? "bg-(--color-accent) text-white shadow-lg shadow-(--color-accent)/35 scale-105"
                  : "text-white/60 hover:text-white/85 hover:bg-white/[0.08]"
              }`}
              style={{
                width: "clamp(44px, 5vw, 52px)",
                height: "clamp(40px, 4.5vh, 48px)",
              }}
            >
              <Icon className="h-5 w-5" />
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
