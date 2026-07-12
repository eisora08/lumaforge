import { Play, HardDrive, Code, Heart, LayoutGrid } from "lucide-react";

export const EMPTY_STATE_CONFIGS: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  message: string;
  color: string;
  bgGlow: string;
}[] = [
  {
    icon: Play,
    title: "Continue Playing",
    message: "Play a game to see it here",
    color: "text-emerald-400",
    bgGlow: "from-emerald-500/10",
  },
  {
    icon: HardDrive,
    title: "Installed Games",
    message: "Install a game to see it here",
    color: "text-sky-400",
    bgGlow: "from-sky-500/10",
  },
  {
    icon: Code,
    title: "Lua / In Library",
    message: "Lua-powered games will appear here",
    color: "text-violet-400",
    bgGlow: "from-violet-500/10",
  },
  {
    icon: Heart,
    title: "Favorites",
    message: "Favorite a game to see it here",
    color: "text-rose-400",
    bgGlow: "from-rose-500/10",
  },
  {
    icon: LayoutGrid,
    title: "All Games",
    message: "No games found in your library",
    color: "text-amber-400",
    bgGlow: "from-amber-500/10",
  },
];

export function RichEmptyState({ railIndex }: { railIndex: number }) {
  const cfg = EMPTY_STATE_CONFIGS[railIndex] ?? EMPTY_STATE_CONFIGS[4];
  const Icon = cfg.icon;
  return (
    <div className="flex w-full items-center justify-center py-12">
      <div className="flex flex-col items-center gap-3">
        <div className={`flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br ${cfg.bgGlow} to-transparent ring-1 ring-white/[0.06]`}>
          <Icon className={`h-7 w-7 ${cfg.color}`} />
        </div>
        <p className="text-sm font-medium text-(--color-muted)/40">{cfg.message}</p>
      </div>
    </div>
  );
}
