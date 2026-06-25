import {
  Bell,
  Menu,
  Search,
  Sparkles,
} from "lucide-react";

type TopBarProps = {
  onOpenSidebar: () => void;
};

export default function TopBar({ onOpenSidebar }: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-(--color-border) bg-(--color-bg)/85 px-4 backdrop-blur-xl lg:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenSidebar}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 hover:bg-white/8 lg:hidden"
        >
          <Menu className="h-5 w-5 text-(--color-text)" />
        </button>

        <div className="hidden h-10 w-105 items-center gap-3 rounded-2xl border border-(--color-border) bg-(--color-surface)/70 px-4 md:flex">
          <Search className="h-4 w-4 text-(--color-muted)" />

          <input
            placeholder="Buscar juegos, paquetes, logs..."
            className="w-full bg-transparent text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className="hidden h-10 items-center gap-2 rounded-xl border border-(--color-accent)/20 bg-(--color-accent)/10 px-4 text-sm text-(--color-accent) hover:bg-(--color-accent)/15 sm:inline-flex">
          <Sparkles className="h-4 w-4" />
          Premium Mode
        </button>

        <button className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 hover:bg-white/8">
          <Bell className="h-5 w-5 text-(--color-muted)" />
        </button>
      </div>
    </header>
  );
}