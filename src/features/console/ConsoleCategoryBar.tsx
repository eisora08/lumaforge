import {
  Sparkles, Play, HardDrive, Code, Heart, LayoutGrid,
} from "lucide-react";
import { getConsoleInputHints } from "./consoleInputHints";
import type { ConsoleInputHintStyle } from "./consoleInputHints";
import type { ConsoleBottomBarPosition } from "./consoleSettings";

const CATEGORIES = [
  { label: "New", key: "new", icon: Sparkles },
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
  showHints?: boolean;
  inputHints?: ConsoleInputHintStyle;
  bottomBarPosition?: ConsoleBottomBarPosition;
};

function HintTag({ children }: { children: string }) {
  const m = children.match(/^\[(.+?)\]\s*(.+)$/);
  if (!m) return <span className="text-[11px] text-(--color-muted)/60">{children}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-(--color-muted)/60">
      <span className="rounded border border-(--color-border) px-1 py-px text-[9px] font-bold tracking-tight text-(--color-muted)/70">
        {m[1]}
      </span>
      {m[2]}
    </span>
  );
}

export default function ConsoleCategoryBar({ activeIndex, counts, onSelect, showHints, inputHints = "xbox", bottomBarPosition = "center" }: Props) {
  const hints = getConsoleInputHints(inputHints);
  const isRight = bottomBarPosition === "right";
  const barJustify = isRight ? "justify-end" : bottomBarPosition === "left" ? "justify-start" : "justify-between";

  const pills = (
    <div className="flex items-center gap-1">
      {CATEGORIES.map((cat, i) => {
        const isActive = activeIndex === i;
        const Icon = cat.icon;
        return (
          <button
              key={cat.key}
              tabIndex={-1}
              onClick={() => onSelect(i)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium transition-all duration-150 ${
              isActive
                ? "bg-(--color-accent)/25 text-(--color-accent) shadow-sm shadow-(--color-accent)/10"
                : "text-white/50 hover:bg-white/10 hover:text-white/80"
            }`}
          >
            <Icon className="h-3.5 w-3.5 opacity-70" />
            <span>{cat.label}</span>
            <span className="text-[10px] opacity-60">{counts[i] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );

  const hintsBlock = showHints ? (
    <div className="flex items-center gap-2 md:gap-3">
      <HintTag>{hints.back}</HintTag>
      <HintTag>{hints.select}</HintTag>
      <HintTag>{hints.play}</HintTag>
    </div>
  ) : null;

  return (
    <nav className={`flex shrink-0 items-center px-6 py-2.5 ${barJustify}`} aria-label="Category navigation">
      {bottomBarPosition === "center" && <div className="w-20" />}
      {isRight ? (
        <>
          {/* Hints first, then pills, so pills sit at far-right */}
          {hintsBlock}
          {pills}
        </>
      ) : (
        <>
          {pills}
          {hintsBlock}
        </>
      )}
    </nav>
  );
}
