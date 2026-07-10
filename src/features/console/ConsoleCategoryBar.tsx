import {
  Play, HardDrive, Code, Heart, LayoutGrid,
} from "lucide-react";
import { getConsoleInputHints } from "./consoleInputHints";
import type { ConsoleInputHintStyle } from "./consoleInputHints";

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
  showHints?: boolean;
  inputHints?: ConsoleInputHintStyle;
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

export default function ConsoleCategoryBar({ activeIndex, counts, onSelect, showHints, inputHints = "xbox" }: Props) {
  const hints = getConsoleInputHints(inputHints);
  return (
    <nav className="flex shrink-0 items-center justify-between px-6 py-2.5" aria-label="Category navigation">
      {/* Left spacer */}
      <div className="w-20" />

      {/* Centered category pills */}
      <div className="flex items-center gap-1">
        {CATEGORIES.map((cat, i) => {
          const isActive = activeIndex === i;
          const Icon = cat.icon;
          return (
            <button
              key={cat.key}
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

      {/* Glyph hints on right */}
      {showHints && (
        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-4 md:flex">
            <HintTag>{hints.back}</HintTag>
            <HintTag>{hints.select}</HintTag>
            <HintTag>{hints.search}</HintTag>
            <HintTag>{hints.media}</HintTag>
          </div>
        </div>
      )}
    </nav>
  );
}
