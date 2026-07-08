import { useCallback, useEffect, useMemo } from "react";
import type { AppPage } from "../../types/navigation";
import type { LibraryGame } from "../../types/libraryGame";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useFavorites } from "../../context/FavoritesContext";
import ConsoleProfileHeader from "./ConsoleProfileHeader";
import ConsoleHomeRail from "./ConsoleHomeRail";
import { useConsoleNavigation } from "./useConsoleNavigation";

const MAX_ALL_GAMES = 50;

type Props = {
  onNavigate?: (page: AppPage) => void;
};

export default function ConsoleModePage({ onNavigate }: Props) {
  const { games } = useLibraryGames();
  const { favoriteIds } = useFavorites();

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

  const rails = useMemo(() => [continuePlaying, installed, luaOrInLibrary, favorites, allGames], [
    continuePlaying,
    installed,
    luaOrInLibrary,
    favorites,
    allGames,
  ]);

  const railLengths = useMemo(() => rails.map((r) => r.length), [rails]);

  const onGoBack = useCallback(() => {
    onNavigate?.("home");
  }, [onNavigate]);

  const onSelectGame = useCallback(
    (railIndex: number, cardIndex: number) => {
      const game: LibraryGame | undefined = rails[railIndex]?.[cardIndex];
      if (game) {
        console.log(`[CONSOLE][SELECT_GAME] appid=${game.appId} title=${game.title}`);
      }
    },
    [rails],
  );

  const { focusedRail, focusedIndex, moveUp, moveDown, moveLeft, moveRight, tabForward, tabBackward, selectFocused, goBack } =
    useConsoleNavigation({
      railLengths,
      onSelectGame,
      onGoBack,
    });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          moveUp();
          break;
        case "ArrowDown":
          e.preventDefault();
          moveDown();
          break;
        case "ArrowLeft":
          e.preventDefault();
          moveLeft();
          break;
        case "ArrowRight":
          e.preventDefault();
          moveRight();
          break;
        case "Enter":
          e.preventDefault();
          selectFocused();
          break;
        case "Escape":
          e.preventDefault();
          goBack();
          break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            tabBackward();
          } else {
            tabForward();
          }
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moveUp, moveDown, moveLeft, moveRight, tabForward, tabBackward, selectFocused, goBack]);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-10 px-6 py-8">
      <ConsoleProfileHeader />

      {rails.map((gameList, i) => {
        const railConfig = [
          { title: "Continue Playing", subtitle: "Jump back into your games" },
          { title: "Installed Games", subtitle: "Ready to play" },
          { title: "Lua / In Library", subtitle: "Games with Lua scripts" },
          { title: "Favorites", subtitle: "Your favorite games" },
          {
            title: "All Games",
            subtitle: `Showing ${Math.min(games.length, MAX_ALL_GAMES)} of ${games.length}`,
          },
        ][i];
        if (!railConfig) return null;

        return (
          <ConsoleHomeRail
            key={`rail-${i}`}
            title={railConfig.title}
            subtitle={railConfig.subtitle}
            games={gameList}
            railIndex={i}
            focusedRail={focusedRail}
            focusedIndex={focusedRail === i ? focusedIndex : -1}
            onSelectGame={(game) => {
              const idx = gameList.indexOf(game);
              if (idx >= 0) {
                console.log(`[CONSOLE][SELECT_GAME] appid=${game.appId} title=${game.title}`);
              }
            }}
          />
        );
      })}
    </div>
  );
}
