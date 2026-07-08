import { useMemo } from "react";
import { Gamepad2 } from "lucide-react";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useFavorites } from "../../context/FavoritesContext";
import { getPlaytimeSecondsForAppId } from "../../services/playtimeService";

export default function ConsoleProfileHeader() {
  const { games } = useLibraryGames();
  const { favoriteIds } = useFavorites();

  const stats = useMemo(() => {
    const total = games.length;
    const installed = games.filter((g) => g.steamInstalled).length;
    const lua = games.filter((g) => g.hasLua).length;
    const favorites = favoriteIds.size;
    let totalSeconds = 0;
    for (const g of games) {
      if (g.appId) {
        totalSeconds += getPlaytimeSecondsForAppId(g.appId);
      }
    }
    return {
      total,
      installed,
      lua,
      favorites,
      totalPlaytimeHours: Math.round(totalSeconds / 3600),
    };
  }, [games, favoriteIds]);

  return (
    <div className="flex items-center gap-5 rounded-2xl border border-(--surface-active-border) bg-(--color-surface)/40 px-6 py-4 backdrop-blur-sm">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-(--color-accent)/10">
        <Gamepad2 className="h-8 w-8 text-(--color-accent)" />
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-bold text-(--color-text)">
          Gamer
        </h1>
        <p className="mt-0.5 text-sm text-(--color-muted)">
          Exploring the library
        </p>
      </div>

      <div className="hidden gap-6 sm:flex">
        <StatItem label="Games" value={stats.total} />
        <StatItem label="Installed" value={stats.installed} />
        <StatItem label="Lua" value={stats.lua} />
        <StatItem label="Favorites" value={stats.favorites} />
        {stats.totalPlaytimeHours > 0 && (
          <StatItem label="Playtime" value={`${stats.totalPlaytimeHours}h`} />
        )}
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-(--color-text)">
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-(--color-muted)">
        {label}
      </div>
    </div>
  );
}
