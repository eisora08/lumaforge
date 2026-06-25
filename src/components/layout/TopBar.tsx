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
    <header className="h-16 border-b border-white/10 bg-[#1d1417]/80 backdrop-blur-xl px-4 lg:px-6 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenSidebar}
          className="lg:hidden h-10 w-10 rounded-xl bg-white/5 hover:bg-white/8 flex items-center justify-center"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="hidden md:flex items-center gap-3 h-10 w-105 rounded-2xl bg-white/5 border border-white/10 px-4">
          <Search className="h-4 w-4 text-gray-500" />
          <input
            placeholder="Buscar juegos, paquetes, logs..."
            className="bg-transparent outline-none text-sm text-gray-200 placeholder:text-gray-600 w-full"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className="hidden sm:inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#b8d7dc]/10 text-[#b8d7dc] border border-[#b8d7dc]/20 text-sm hover:bg-[#b8d7dc]/15">
          <Sparkles className="h-4 w-4" />
          Premium Mode
        </button>

        <button className="h-10 w-10 rounded-xl bg-white/5 hover:bg-white/8 flex items-center justify-center">
          <Bell className="h-5 w-5 text-gray-300" />
        </button>
      </div>
    </header>
  );
}