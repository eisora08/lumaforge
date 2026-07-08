import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AppPage } from "../../types/navigation";
import type { LibraryGame } from "../../types/libraryGame";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useFavorites } from "../../context/FavoritesContext";
import { useSettings } from "../../context/SettingsContext";
import { useConsoleLibraryMedia } from "./consoleLibraryAdapter";
import { isSidebarInstalledGame } from "../../services/gameCacheService";
import { useConsoleSettings } from "./consoleSettings";
import type { ConsoleLayoutMode } from "./consoleSettings";
import ConsoleSpotlightLayout from "./ConsoleSpotlightLayout";
import ConsoleGridLayout from "./ConsoleGridLayout";
import { useConsoleNavigation } from "./useConsoleNavigation";

const DEBUG_CONSOLE_MODE = false;

type Props = {
  onNavigate?: (page: AppPage) => void;
};

export default function ConsoleModePage({ onNavigate }: Props) {
  const { games } = useLibraryGames();
  const enrichedGames = useConsoleLibraryMedia(games);
  const { favoriteIds } = useFavorites();
  const { settings: appSettings } = useSettings();
  const [consoleSettings, patchConsoleSettings] = useConsoleSettings();
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  if (DEBUG_CONSOLE_MODE) {
    const installedCount = enrichedGames.filter(isSidebarInstalledGame).length;
    const luaCount = enrichedGames.filter((g) => g.hasLua || g.hasLuaSource || g.isLuaActive).length;
    console.log(`[CONSOLE][DATA_COUNTS] libraryGames=${enrichedGames.length} installed=${installedCount} lua=${luaCount} favorites=${favoriteIds.size} all=${enrichedGames.length}`);
  }

  const cardVariant: "landscape" | "poster" = appSettings.libraryCardArtworkMode === "poster" ? "poster" : "landscape";

  const toggleLayout = useCallback(() => {
    patchConsoleSettings({ layoutMode: consoleSettings.layoutMode === "spotlight" ? "grid" : "spotlight" as ConsoleLayoutMode });
  }, [consoleSettings.layoutMode, patchConsoleSettings]);

  const continuePlaying = useMemo(() => {
    const withPlaytime = enrichedGames
      .filter((g) => isSidebarInstalledGame(g) && (g.steamLastPlayedAt || g.steamPlaytimeMinutes))
      .sort((a, b) => (b.steamLastPlayedAt ?? 0) - (a.steamLastPlayedAt ?? 0));
    return withPlaytime.slice(0, 15);
  }, [enrichedGames]);

  const installed = useMemo(() => {
    return enrichedGames.filter(isSidebarInstalledGame);
  }, [enrichedGames]);

  const luaOrInLibrary = useMemo(() => {
    return enrichedGames.filter((g) => g.hasLua || g.hasLuaSource || g.isLuaActive);
  }, [enrichedGames]);

  const favorites = useMemo(() => {
    return enrichedGames.filter((g) => g.appId && favoriteIds.has(g.appId));
  }, [enrichedGames, favoriteIds]);

  const allGames = useMemo(() => {
    return enrichedGames;
  }, [enrichedGames]);

  const rails = useMemo(() => [continuePlaying, installed, luaOrInLibrary, favorites, allGames], [
    continuePlaying, installed, luaOrInLibrary, favorites, allGames,
  ]);

  const railLengths = useMemo(() => rails.map((r) => r.length), [rails]);

  if (DEBUG_CONSOLE_MODE) {
    console.log(`[CONSOLE][RAIL_COUNTS] continue=${railLengths[0]} installed=${railLengths[1]} lua=${railLengths[2]} favorites=${railLengths[3]} all=${railLengths[4]}`);
  }

  const onGoBack = useCallback(() => {
    onNavigate?.("home");
  }, [onNavigate]);

  const handleSelectGame = useCallback((game: LibraryGame) => {
    if (game?.appId) {
      if (DEBUG_CONSOLE_MODE) {
        console.log(`[CONSOLE][SELECT_GAME] appid=${game.appId} title=${game.title}`);
      }
    }
  }, []);

  const hookOnSelect = useCallback((railIndex: number, cardIndex: number) => {
    const game: LibraryGame | undefined = rails[railIndex]?.[cardIndex];
    if (game) {
      if (DEBUG_CONSOLE_MODE) {
        console.log(`[CONSOLE][SELECT_GAME] appid=${game.appId} title=${game.title}`);
      }
    }
  }, [rails]);

  const {
    focusedRail, focusedIndex, moveUp, moveDown, moveLeft, moveRight,
    tabForward, tabBackward, selectFocused, goBack, focusRail,
  } = useConsoleNavigation({
    railLengths,
    onSelectGame: hookOnSelect,
    onGoBack,
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowUp": e.preventDefault(); moveUp(); break;
        case "ArrowDown": e.preventDefault(); moveDown(); break;
        case "ArrowLeft": e.preventDefault(); moveLeft(); break;
        case "ArrowRight": e.preventDefault(); moveRight(); break;
        case "Enter": e.preventDefault(); selectFocused(); break;
        case "Escape": e.preventDefault(); goBack(); break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) { tabBackward(); } else { tabForward(); }
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moveUp, moveDown, moveLeft, moveRight, tabForward, tabBackward, selectFocused, goBack]);

  const currentFocusedGame = useMemo(() => {
    if (focusedRail >= 0 && focusedRail < rails.length && focusedIndex >= 0) {
      const rail = rails[focusedRail];
      if (focusedIndex < rail.length) return rail[focusedIndex];
    }
    for (const rail of rails) {
      if (rail.length > 0) return rail[0];
    }
    return null;
  }, [focusedRail, focusedIndex, rails]);

  const sharedProps = {
    focusedGame: currentFocusedGame,
    rails,
    focusedRail,
    focusedIndex: focusedIndex,
    onSelectGame: handleSelectGame,
    layoutMode: consoleSettings.layoutMode,
    onToggleLayout: toggleLayout,
    cardVariant,
    onNavigate,
    categoryCounts: railLengths,
    activeCategory: focusedRail >= 0 ? focusedRail : 0,
    onSelectCategory: focusRail,
    settings: consoleSettings,
    onSettingsPatch: patchConsoleSettings,
    allGames: enrichedGames,
  };

  const layout = consoleSettings.layoutMode === "spotlight"
    ? <ConsoleSpotlightLayout {...sharedProps} />
    : <ConsoleGridLayout {...sharedProps} />;

  return (
    <div data-console-theme={consoleSettings.themeMode}>
      {layout}
    </div>
  );
}
