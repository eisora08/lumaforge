import { useMemo } from "react";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useFavorites } from "../../context/FavoritesContext";
import ConsoleProfileHeader from "./ConsoleProfileHeader";
import ConsoleHomeRail from "./ConsoleHomeRail";
import { useConsoleNavigation } from "./useConsoleNavigation";

const MAX_ALL_GAMES = 50;

export default function ConsoleModePage() {
  const { games } = useLibraryGames();
  const { favoriteIds } = useFavorites();
  useConsoleNavigation();

  const continuePlaying = useMemo(() => {
    const withPlaytime = games
      .filter((g) => g.steamInstalled && (g.steamLastPlayedAt || g.steamPlaytimeMinutes))
      .sort((a, b) => (b.steamLastPlayedAt ?? 0) - (a.steamLastPlayedAt ?? 0));
    return withPlaytime.slice(0, 15);
  }, [games]);

  const installed = useMemo(() => {
    return games.filter((g) => g.steamInstalled).slice(0, 30);
  }, [games]);

  const luaOrInLibrary = useMemo(() => {
    return games.filter((g) => g.hasLua || g.hasLuaSource || g.isLuaActive).slice(0, 30);
  }, [games]);

  const favorites = useMemo(() => {
    return games.filter((g) => g.appId && favoriteIds.has(g.appId)).slice(0, 30);
  }, [games, favoriteIds]);

  const allGames = useMemo(() => {
    return games.slice(0, MAX_ALL_GAMES);
  }, [games]);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-10 px-6 py-8">
      <ConsoleProfileHeader />

      <ConsoleHomeRail
        title="Continue Playing"
        subtitle="Jump back into your games"
        games={continuePlaying}
      />

      <ConsoleHomeRail
        title="Installed Games"
        subtitle="Ready to play"
        games={installed}
      />

      <ConsoleHomeRail
        title="Lua / In Library"
        subtitle="Games with Lua scripts"
        games={luaOrInLibrary}
      />

      <ConsoleHomeRail
        title="Favorites"
        subtitle="Your favorite games"
        games={favorites}
      />

      <ConsoleHomeRail
        title="All Games"
        subtitle={`Showing ${Math.min(games.length, MAX_ALL_GAMES)} of ${games.length}`}
        games={allGames}
      />
    </div>
  );
}
