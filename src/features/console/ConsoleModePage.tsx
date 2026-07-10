import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppPage } from "../../types/navigation";
import type { LibraryGame } from "../../types/libraryGame";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useFavorites } from "../../context/FavoritesContext";
import { useSettings } from "../../context/SettingsContext";
import { useConsoleLibraryMedia } from "./consoleLibraryAdapter";
import { isSidebarInstalledGame } from "../../services/gameCacheService";
import { useConsoleSettings } from "./consoleSettings";
import type { ConsoleLayoutMode } from "./consoleSettings";
import ConsoleSwitchSpotlightLayout from "./ConsoleSwitchSpotlightLayout";
import ConsoleGridLayout from "./ConsoleGridLayout";
import ConsoleGameDetails from "./ConsoleGameDetails";
import ConsoleGameOptionsOverlay from "./ConsoleGameOptionsOverlay";
import ConsoleSearchOverlay from "./ConsoleSearchOverlay";
import { useConsoleNavigation } from "./useConsoleNavigation";
import { useGameSession } from "../../context/GameSessionContext";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";

const DEBUG_CONSOLE_MODE = false;
const DEBUG_CONSOLE_PLAY = false;

type Props = {
  onNavigate?: (page: AppPage) => void;
};

export default function ConsoleModePage({ onNavigate }: Props) {
  const { games } = useLibraryGames();
  const enrichedGames = useConsoleLibraryMedia(games);
  const { favoriteIds } = useFavorites();
  const { settings: appSettings } = useSettings();
  const [consoleSettings, patchConsoleSettings] = useConsoleSettings();
  const [detailGame, setDetailGame] = useState<LibraryGame | null>(null);
  const [optionsGame, setOptionsGame] = useState<LibraryGame | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
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
      setDetailGame(game);
    }
  }, []);

  const handleOptionsGame = useCallback((game: LibraryGame) => {
    if (DEBUG_CONSOLE_MODE) {
      console.log(`[CONSOLE][OPTIONS_OPEN] appid=${game.appId} title=${game.title}`);
    }
    setOptionsGame(game);
  }, []);

  const handleOverlayOpenDetails = useCallback(() => {
    if (optionsGame) {
      if (DEBUG_CONSOLE_MODE) {
        console.log(`[CONSOLE][OPTIONS_VIEW_DETAILS] appid=${optionsGame.appId}`);
      }
      setDetailGame(optionsGame);
      setOptionsGame(null);
    }
  }, [optionsGame]);

  const handleSearchGame = useCallback((game: LibraryGame) => {
    if (DEBUG_CONSOLE_MODE) {
      console.log(`[CONSOLE][SEARCH_SELECT] appid=${game.appId} title=${game.title}`);
    }
    setDetailGame(game);
    setSearchOpen(false);
  }, []);

  const closeDetails = useCallback(() => {
    if (DEBUG_CONSOLE_MODE) {
      console.log(`[CONSOLE][DETAILS_CLOSE]`);
    }
    setDetailGame(null);
  }, []);

  const session = useGameSession();
  const launchingRef = useRef(false);

  const handleConsolePlay = useCallback(async (game: LibraryGame) => {
    if (!game?.appId) {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][BLOCKED] appid=null reason=no-appId`);
      return;
    }
    const primaryAction = getLauncherGamePrimaryAction(game);
    if (primaryAction !== "play") {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][BLOCKED] appid=${game.appId} primaryAction=${primaryAction}`);
      return;
    }
    if (!game.isPlayable) {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][BLOCKED] appid=${game.appId} reason=not-playable`);
      return;
    }
    if (launchingRef.current) {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][BLOCKED] appid=${game.appId} reason=in-flight`);
      return;
    }
    if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][REQUEST] appid=${game.appId} title=${game.title} primaryAction=${primaryAction}`);
    launchingRef.current = true;
    try {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][LAUNCH_START] appid=${game.appId}`);
      await session.launchGame(game);
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][LAUNCH_SUCCESS] appid=${game.appId}`);
    } catch (err) {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][LAUNCH_FAIL] appid=${game.appId} error=${err}`);
    } finally {
      launchingRef.current = false;
    }
  }, [session]);

  const hookOnSelect = useCallback((railIndex: number, cardIndex: number) => {
    const game: LibraryGame | undefined = rails[railIndex]?.[cardIndex];
    if (game) {
      if (DEBUG_CONSOLE_MODE) {
        console.log(`[CONSOLE][SELECT_GAME] appid=${game.appId} title=${game.title}`);
      }
      setDetailGame(game);
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
      if (searchOpen) {
        return; // Search overlay handles its own keyboard
      }
      if (detailGame) {
        return; // ConsoleGameDetails handles its own keyboard input (Escape with animation)
      }
      if (optionsGame) {
        return; // Options overlay handles its own keyboard
      }
      const target = e.target as HTMLElement;
      const isInputActive = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      const isInDialog = !!target.closest('[role="dialog"][aria-modal="true"]');
      switch (e.key) {
        case "ArrowUp": e.preventDefault(); moveUp(); break;
        case "ArrowDown": e.preventDefault(); moveDown(); break;
        case "ArrowLeft": e.preventDefault(); moveLeft(); break;
        case "ArrowRight": e.preventDefault(); moveRight(); break;
        case "Enter":
          if (!isInputActive && !isInDialog) { e.preventDefault(); selectFocused(); }
          break;
        case "Escape": e.preventDefault(); goBack(); break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) { tabBackward(); } else { tabForward(); }
          break;
        case "x":
        case "X":
        case "d":
        case "D":
          if (!isInputActive && !isInDialog) { e.preventDefault(); selectFocused(); }
          break;
        case "/":
          if (!isInputActive && !isInDialog) { e.preventDefault(); setSearchOpen(true); }
          break;
        case "y":
        case "Y":
          if (!isInputActive && !isInDialog) { e.preventDefault(); setSearchOpen(true); }
          break;
        case "o":
        case "O":
        case "ContextMenu":
        case "Apps":
          if (!isInputActive && !isInDialog) { e.preventDefault(); const fg = currentFocusedGameRef.current; if (fg) handleOptionsGame(fg); }
          break;
        case "p":
        case "P":
          if (!isInputActive && !isInDialog) { e.preventDefault(); const fg = currentFocusedGameRef.current; if (fg) handleConsolePlay(fg); }
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moveUp, moveDown, moveLeft, moveRight, tabForward, tabBackward, selectFocused, goBack, detailGame, closeDetails, optionsGame, handleOptionsGame, searchOpen, handleConsolePlay]);

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

  const currentFocusedGameRef = useRef(currentFocusedGame);
  currentFocusedGameRef.current = currentFocusedGame;

  const sharedProps = {
    focusedGame: currentFocusedGame,
    rails,
    focusedRail,
    focusedIndex: focusedIndex,
    onSelectGame: handleSelectGame,
    onOptionsGame: handleOptionsGame,
    onPlayGame: handleConsolePlay,
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
    ? <ConsoleSwitchSpotlightLayout {...sharedProps} />
    : <ConsoleGridLayout {...sharedProps} />;

  return (
    <div data-console-theme={consoleSettings.themeMode} className="relative h-full w-full">
      {/* Always render the layout; dim when details overlay is open */}
      <div className={detailGame ? "opacity-[0.15] pointer-events-none select-none" : ""}>
        {layout}
      </div>

      {/* Details panel overlays on top of the layout */}
      {detailGame && (
        <ConsoleGameDetails
          game={detailGame}
          onClose={closeDetails}
          settings={consoleSettings}
          onSearchOpen={() => { setSearchOpen(true); }}
          onPlayGame={handleConsolePlay}
        />
      )}

      {/* Options overlay (from Spotlight/Grid — not from details) */}
      {optionsGame && (
        <ConsoleGameOptionsOverlay
          game={optionsGame}
          open={true}
          onClose={() => setOptionsGame(null)}
          onOpenDetails={handleOverlayOpenDetails}
          onOpenSearch={() => { setOptionsGame(null); setSearchOpen(true); }}
          onPlayGame={(g) => { setOptionsGame(null); handleConsolePlay(g); }}
          inDetails={false}
          inputHints={consoleSettings.inputHints}
        />
      )}

      {/* Search overlay — always on top */}
      {searchOpen && (
        <ConsoleSearchOverlay
          open={searchOpen}
          games={enrichedGames}
          onClose={() => setSearchOpen(false)}
          onSelectGame={handleSearchGame}
          inputHints={consoleSettings.inputHints}
        />
      )}
    </div>
  );
}
