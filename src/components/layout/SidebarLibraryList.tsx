import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useLibraryGames } from "../../context/LibraryGamesContext";

type Props = {
  onOpenGame?: () => void;
};

export default function SidebarLibraryList({ onOpenGame }: Props) {
  const { games, selectedGame, setSelectedGame } = useLibraryGames();
  const [query, setQuery] = useState("");

  const installed = useMemo(() => {
    return games.filter((g) => g.isPlayable || g.steamInstalled || (g.source === "local" && !!g.executablePath));
  }, [games]);

  const filtered = useMemo(() => {
    if (!query) return installed;
    const q = query.toLowerCase();
    return installed.filter((g) =>
      g.title.toLowerCase().includes(q) || g.appId?.toLowerCase().includes(q)
    );
  }, [installed, query]);

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-bold text-(--color-text)">Mi Biblioteca</span>
        <span className="text-[10px] text-(--color-muted)">{installed.length} games</span>
      </div>

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--color-muted)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search library..."
          className="w-full rounded-lg border border-(--surface-active-border) bg-white/5 py-1.5 pl-7 pr-2.5 text-xs text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)/40"
        />
      </div>

      <div className="max-h-[40vh] space-y-0.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-2 text-center text-[10px] text-(--color-muted)">No games match.</p>
        ) : (
          filtered.map((game) => {
            const isSelected = selectedGame?.id === game.id;
            return (
              <button
                key={game.id}
                type="button"
                onClick={() => {
                  setSelectedGame(game);
                  onOpenGame?.();
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                  isSelected
                    ? "bg-(--color-accent)/10 text-(--color-accent)"
                    : "text-(--color-text) hover:bg-white/5"
                }`}
              >
                <div className="h-6 w-10 shrink-0 overflow-hidden rounded bg-white/5">
                  {game.imageUrl ? (
                    <img src={game.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[8px] text-(--color-muted)">--</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium leading-tight">{game.title}</div>
                  <div className="text-[10px] text-(--color-muted)">
                    {game.source === "steam" ? "Steam" : game.source === "local" ? "Local" : "Lua"}
                    {game.isLuaDisabled && " · Disabled"}
                    {game.hasUpdate && " · Update"}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
