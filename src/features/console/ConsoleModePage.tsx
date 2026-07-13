import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { AppPage } from "../../types/navigation";
import type { LibraryGame } from "../../types/libraryGame";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useFavorites } from "../../context/FavoritesContext";
import { useConsoleLibraryMedia } from "./consoleLibraryAdapter";
import { isSidebarInstalledGame } from "../../services/gameCacheService";
import { useConsoleSettings } from "./consoleSettings";
import type { ConsoleLayoutMode } from "./consoleSettings";
import ConsoleSwitchSpotlightLayout from "./ConsoleSwitchSpotlightLayout";
import ConsoleGridLayout from "./ConsoleGridLayout";
import ConsoleGameDetails from "./ConsoleGameDetails";
import ConsoleGameOptionsOverlay from "./ConsoleGameOptionsOverlay";
import ConsoleSearchOverlay from "./ConsoleSearchOverlay";
import ConsoleSettingsPanelV2 from "./ConsoleSettingsPanelV2";
import { useConsoleNavigation } from "./useConsoleNavigation";
import { useConsoleGamepadInput, DEBUG_CONSOLE_GAMEPAD, setOnGamepadAction } from "./useConsoleGamepadInput";
import { useGameSession, computeGameKey } from "../../context/GameSessionContext";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import { showSuccess, showError, showWarning } from "../../components/toast/GameToast";
import { getPlaytimeEntryByAppId } from "../../services/playtimeService";
import { useControllerDetection } from "./useControllerDetection";

function getBlockedReason(action: string): string {
  switch (action) {
    case "install": return "Install required";
    case "update": return "Update required";
    case "download": return "Download required";
    case "missing-path": return "Game files missing";
    case "uninstalling": return "Game is being uninstalled";
    case "open-steam": return "Open in Steam to play";
    case "open-lua-folder": return "Configure Lua script to play";
    default: return "This game is not playable yet";
  }
}

const DEBUG_CONSOLE_MODE = false;
const DEBUG_CONSOLE_PLAY = false;
const DEBUG_CONSOLE_GRID_NAV = false;
const DEBUG_CONSOLE_ENTRY = false;

type Props = {
  onNavigate?: (page: AppPage) => void;
};

export default function ConsoleModePage({ onNavigate }: Props) {
  const { games, refresh: refreshLibraryGames } = useLibraryGames();
  const enrichedGames = useConsoleLibraryMedia(games);
  const { favoriteIds } = useFavorites();
  const [consoleSettings, patchConsoleSettings] = useConsoleSettings();
  const [detailGame, setDetailGame] = useState<LibraryGame | null>(null);
  const [optionsGame, setOptionsGame] = useState<LibraryGame | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [dockFocusedIndex, setDockFocusedIndex] = useState(-1);
  const [settledFocusedRail, setSettledFocusedRail] = useState(-1);
  const [settledFocusedIndex, setSettledFocusedIndex] = useState(-1);
  const settledFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useControllerDetection();

  if (DEBUG_CONSOLE_MODE) {
    const installedCount = enrichedGames.filter(isSidebarInstalledGame).length;
    const luaCount = enrichedGames.filter((g) => g.hasLua || g.hasLuaSource || g.isLuaActive).length;
    console.log(`[CONSOLE][DATA_COUNTS] libraryGames=${enrichedGames.length} installed=${installedCount} lua=${luaCount} favorites=${favoriteIds.size} all=${enrichedGames.length}`);
  }

  const toggleLayout = useCallback(() => {
    patchConsoleSettings({ layoutMode: consoleSettings.layoutMode === "spotlight" ? "grid" : "spotlight" as ConsoleLayoutMode });
  }, [consoleSettings.layoutMode, patchConsoleSettings]);

  const installed = useMemo(() => {
    return enrichedGames.filter(isSidebarInstalledGame);
  }, [enrichedGames]);

  const luaOrInLibrary = useMemo(() => {
    return enrichedGames.filter((g) => g.hasLua || g.hasLuaSource || g.isLuaActive);
  }, [enrichedGames]);

  const favorites = useMemo(() => {
    return enrichedGames.filter((g) => {
      const stableId = g.appId || g.id;
      return favoriteIds.has(stableId);
    });
  }, [enrichedGames, favoriteIds]);

  const allGames = useMemo(() => {
    return enrichedGames;
  }, [enrichedGames]);

  const session = useGameSession();
  const pendingLaunchToastRef = useRef<Map<string, string>>(new Map());

  const continuePlaying = useMemo(() => {
    const activeAppIds = new Set<string>();
    for (const key of Object.keys(session.sessions)) {
      const state = session.getState(key);
      if (state === "running" || state === "launching") {
        const m = key.match(/^app-(.+)$/);
        if (m) activeAppIds.add(m[1]);
      }
    }
    const scored = enrichedGames
      .filter((g) => isSidebarInstalledGame(g))
      .map((g) => {
        const isActive = g.appId ? activeAppIds.has(g.appId) : false;
        const ptEntry = g.appId ? getPlaytimeEntryByAppId(g.appId) : undefined;
        const totalSeconds = ptEntry?.totalPlaytimeSeconds ?? 0;
        const lpa = ptEntry?.lastPlayedAt ?? g.steamLastPlayedAt ?? 0;
        return { game: g, score: isActive ? Number.MAX_SAFE_INTEGER : lpa || (g.steamLastPlayedAt ?? 0), totalSeconds, isActive };
      })
      .filter((s) => s.totalSeconds > 0 || s.score > 0 || s.isActive)
      .sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return b.score - a.score;
      })
      .slice(0, 15);
    return scored.map((s) => s.game);
  }, [enrichedGames, session.sessions, session.getState]);

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
    if (game) {
      if (DEBUG_CONSOLE_MODE) {
        console.log(`[CONSOLE][SELECT_GAME] appid=${game.appId ?? "manual"} title=${game.title}`);
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

  const handleConsolePlay = useCallback(async (game: LibraryGame) => {
    if (!game) return;
    const gameKey = computeGameKey(game);
    const currentState = session.getState(gameKey);
    if (currentState === "launching" || currentState === "running" || currentState === "stopping") {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][BLOCKED] appid=${game.appId ?? "manual"} reason=session-state=${currentState}`);
      return;
    }
    const primaryAction = getLauncherGamePrimaryAction(game);
    if (primaryAction !== "play") {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][BLOCKED] appid=${game.appId ?? "manual"} primaryAction=${primaryAction}`);
      showWarning(getBlockedReason(primaryAction), { id: `console-blocked-${game.appId ?? game.id}`, duration: 3000 });
      return;
    }
    if (!game.isPlayable) {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][BLOCKED] appid=${game.appId ?? "manual"} reason=not-playable`);
      showWarning("This game is not playable yet", { id: `console-blocked-${game.appId ?? game.id}`, duration: 3000 });
      return;
    }
    if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][REQUEST] appid=${game.appId ?? "manual"} title=${game.title} primaryAction=${primaryAction}`);

    const toastId = `console-launch-${game.appId ?? game.id}`;
    if (game.appId) pendingLaunchToastRef.current.set(game.appId, toastId);
    toast.loading(`Launching ${game.title}…`, { id: toastId, duration: 30000 });

    try {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][LAUNCH_START] appid=${game.appId ?? "manual"}`);
      await session.launchGame(game);
    } catch (err) {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][LAUNCH_FAIL] appid=${game.appId ?? "manual"} error=${err}`);
      if (game.appId) pendingLaunchToastRef.current.delete(game.appId);
      toast.dismiss(toastId);
      showError(`Could not launch ${game.title}`, { title: "Launch failed" });
    }
  }, [session]);

  /* Track session state transitions for launch toast feedback */
  useEffect(() => {
    const pending = pendingLaunchToastRef.current;
    if (pending.size === 0) return;
    for (const [appId, toastId] of pending) {
      const gameKey = `app-${appId}`;
      const state = session.getState(gameKey);
      if (state === "running") {
        if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][RUNNING_DETECTED] appid=${appId}`);
        const game = currentFocusedGameRef.current;
        pending.delete(appId);
        toast.dismiss(toastId);
        showSuccess(`${game?.title ?? "Game"} is running`, { title: "Game launched", duration: 3500 });
      } else if (state === "idle") {
        const existingSession = session.getSession(gameKey);
        if (!existingSession && pending.has(appId)) {
          if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][LAUNCH_FAILED] appid=${appId} reason=session-cleared`);
          pending.delete(appId);
          toast.dismiss(toastId);
          showError(`Could not launch the game`, { title: "Launch failed" });
        }
      }
    }
  }, [session.sessions, session, session.getState, session.getSession]);

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
    pageLeft, pageRight,
    tabForward, tabBackward, selectFocused, goBack, focusRail,
  } = useConsoleNavigation({
    railLengths,
    onSelectGame: hookOnSelect,
    onGoBack,
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (DEBUG_CONSOLE_GAMEPAD) {
        console.log(`[CONSOLE_GAMEPAD][HANDLER_RECEIVED] key=${e.key} location=ConsoleModePage target=${(e.target as any)?.tagName ?? typeof e.target}`);
      }
      if (searchOpen) {
        return; // Search overlay handles its own keyboard
      }
      if (detailGame) {
        return; // ConsoleGameDetails handles its own keyboard input (Escape with animation)
      }
      if (optionsGame) {
        return; // Options overlay handles its own keyboard
      }
      if (profileOpen) {
        // Do NOT preventDefault/stopPropagation/stopImmediatePropagation.
        // Quick Menu (ConsoleSettingsPanelV2) owns ALL input while open.
        // Its window handler will preventDefault + stopImmediatePropagation for
        // every key it consumes. If we block here, the panel never receives events.
        if (DEBUG_CONSOLE_GAMEPAD) {
          console.log(`[CONSOLE_INPUT][IGNORED_BECAUSE_QUICK_MENU] key=${e.key}`);
        }
        return;
      }
      // Ignore Alt — can be synthesized by browser/OS from unmapped controller buttons (e.g. BACK/Guide)
      if (e.key === "Alt" || e.key === "Meta") {
        if (DEBUG_CONSOLE_GAMEPAD) console.log(`[CONSOLE_GAMEPAD][IGNORED] key=${e.key} — browser/OS synthetic`);
        return;
      }

      const target = e.target as HTMLElement;
      const isInputActive = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      const isInDialog = !!target.closest?.('[role="dialog"][aria-modal="true"]');

      /* ── Dock focus navigation ──
       * When the dock is focused (dockFocusedIndex >= 0), all navigation
       * moves within the dock. ArrowUp and Enter return to the selected rail. */
      if (dockFocusedIndexRef.current >= 0) {
        const dfi = dockFocusedIndexRef.current;
        const railCount = railsRef.current.length;
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            setDockFocusedIndex(dfi <= 0 ? railCount - 1 : dfi - 1);
            break;
          case "ArrowRight":
            e.preventDefault();
            setDockFocusedIndex(dfi >= railCount - 1 ? 0 : dfi + 1);
            break;
          case "ArrowUp":
            e.preventDefault();
            focusRail(dfi, focusedIndexRef.current);
            setDockFocusedIndex(-1);
            break;
          case "Enter":
            e.preventDefault();
            focusRail(dfi, 0);
            setDockFocusedIndex(-1);
            break;
          case "Escape":
            e.preventDefault();
            setDockFocusedIndex(-1);
            break;
        }
        return;
      }

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          if (layoutModeRef.current === "grid") {
            const fr = focusedRailRef.current;
            const fi = focusedIndexRef.current;
            const r = railsRef.current;
            const rail = fr >= 0 && fr < r.length ? r[fr] : null;
            if (rail && rail.length > 0) {
              const cols = Math.max(1, gridColumnsRef.current || consoleSettings.gridColumns || 8);
              const next = fi - cols;
              if (next >= 0) {
                if (DEBUG_CONSOLE_GRID_NAV) console.log(`[CONSOLE_GRID_NAV][MOVE] direction=up from=${fi} to=${next} appid=${rail[next]?.appId}`);
                focusRail(fr, next);
              }
            }
          } else {
            moveUp();
          }
          break;
        case "ArrowDown":
          e.preventDefault();
          if (layoutModeRef.current === "grid") {
            const fr = focusedRailRef.current;
            const fi = focusedIndexRef.current;
            const r = railsRef.current;
            const rail = fr >= 0 && fr < r.length ? r[fr] : null;
            if (rail && rail.length > 0) {
              const cols = Math.max(1, gridColumnsRef.current || consoleSettings.gridColumns || 8);
              const next = fi + cols;
              const clamped = Math.min(next, rail.length - 1);
              if (clamped !== fi) {
                if (DEBUG_CONSOLE_GRID_NAV) {
                  if (clamped !== next) console.log(`[CONSOLE_GRID_NAV][CLAMP] attempted=${next} clamped=${clamped} reason=short-last-row`);
                  console.log(`[CONSOLE_GRID_NAV][MOVE] direction=down from=${fi} to=${clamped} appid=${rail[clamped]?.appId}`);
                }
                focusRail(fr, clamped);
              }
            }
          } else {
            const lastRail = railsRef.current.length - 1;
            if (lastRail >= 0 && focusedRailRef.current === lastRail) {
              setDockFocusedIndex(focusedRailRef.current);
            } else {
              moveDown();
            }
          }
          break;
        case "ArrowLeft": e.preventDefault(); moveLeft(); break;
        case "ArrowRight": e.preventDefault(); moveRight(); break;
        case "Enter":
          if (!isInputActive && !isInDialog) { e.preventDefault(); selectFocused(); }
          break;
        case "Escape": e.preventDefault(); break; // no-op — only Quick Menu "Switch to Desktop Mode" can exit Console Mode
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) { tabBackward(); } else { tabForward(); }
          break;
        case "x":
        case "X":
          if (!isInputActive && !isInDialog) { e.preventDefault(); const fg = currentFocusedGameRef.current; if (fg) handleConsolePlay(fg); }
          break;
        case "d":
        case "D":
          if (!isInputActive && !isInDialog) { e.preventDefault(); selectFocused(); }
          break;
        case "/":
          if (!isInputActive && !isInDialog) { e.preventDefault(); setSearchOpen(true); }
          break;
        case "y":
        case "Y":
          if (!isInputActive && !isInDialog) { e.preventDefault(); e.stopImmediatePropagation(); setSearchOpen(true); }
          break;
        case "PageUp":
          if (!isInputActive && !isInDialog) { e.preventDefault(); pageLeft(); }
          break;
        case "PageDown":
          if (!isInputActive && !isInDialog) { e.preventDefault(); pageRight(); }
          break;
        case "o":
        case "O":
        case "ContextMenu":
        case "Apps":
          if (!isInputActive && !isInDialog) { e.preventDefault(); e.stopImmediatePropagation(); const fg = currentFocusedGameRef.current; if (fg) handleOptionsGame(fg); }
          break;
        case "q":
        case "Q":
          if (!isInputActive && !isInDialog) { e.preventDefault(); tabBackward(); }
          break;
        case "e":
        case "E":
          if (!isInputActive && !isInDialog) { e.preventDefault(); tabForward(); }
          break;
        case "p":
        case "P":
          if (!isInputActive && !isInDialog) { e.preventDefault(); const fg = currentFocusedGameRef.current; if (fg) handleConsolePlay(fg); }
          break;
        case "v":
        case "V":
          if (!isInputActive && !isInDialog) {
            e.preventDefault();
            e.stopImmediatePropagation();
            setProfileOpen(prev => !prev);
            if (DEBUG_CONSOLE_GAMEPAD) console.log(`[QUICK_MENU][OPEN_REQUEST] source=view profileOpen=${!profileOpen}`);
          }
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moveUp, moveDown, moveLeft, moveRight, pageLeft, pageRight, tabForward, tabBackward, selectFocused, goBack, focusRail, detailGame, closeDetails, optionsGame, handleOptionsGame, searchOpen, handleConsolePlay, profileOpen]);

  /* ── Gamepad input: enabled when no overlay blocks navigation ── */
  const gamepadEnabled = !searchOpen && !detailGame && !optionsGame && !profileOpen;
  useConsoleGamepadInput(gamepadEnabled);

  /* ── Mouse cursor: hide on gamepad action, show on mousemove ── */
  const [cursorHidden, setCursorHidden] = useState(false);

  useEffect(() => {
    setOnGamepadAction(gamepadEnabled ? () => setCursorHidden(true) : null);
    return () => { setOnGamepadAction(null); };
  }, [gamepadEnabled]);

  useEffect(() => {
    if (!cursorHidden) return;
    const onMouseMove = () => setCursorHidden(false);
    window.addEventListener("mousemove", onMouseMove);
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, [cursorHidden]);

  const currentFocusedGame = useMemo(() => {
    if (focusedRail >= 0 && focusedRail < rails.length && focusedIndex >= 0) {
      const rail = rails[focusedRail];
      if (focusedIndex < rail.length) return rail[focusedIndex];
    }
    return null;
  }, [focusedRail, focusedIndex, rails]);

  const currentSettledFocusedGame = useMemo(() => {
    const sr = settledFocusedRail >= 0 ? settledFocusedRail : focusedRail;
    const si = settledFocusedIndex >= 0 ? settledFocusedIndex : focusedIndex;
    if (sr >= 0 && sr < rails.length && si >= 0) {
      const rail = rails[sr];
      if (si < rail.length) return rail[si];
    }
    return null;
  }, [settledFocusedRail, settledFocusedIndex, focusedRail, focusedIndex, rails]);

  const currentFocusedGameRef = useRef(currentFocusedGame);
  currentFocusedGameRef.current = currentFocusedGame;

  /* ── Refs for grid nav (avoid re-registering keyboard listener on every index change) ── */
  const focusedRailRef = useRef(focusedRail);
  focusedRailRef.current = focusedRail;
  const focusedIndexRef = useRef(focusedIndex);
  focusedIndexRef.current = focusedIndex;
  const dockFocusedIndexRef = useRef(dockFocusedIndex);
  dockFocusedIndexRef.current = dockFocusedIndex;
  const railsRef = useRef(rails);
  railsRef.current = rails;
  const gridColumnsRef = useRef(consoleSettings.gridColumns);
  const layoutModeRef = useRef(consoleSettings.layoutMode);
  layoutModeRef.current = consoleSettings.layoutMode;

  /* ── Debounce settled focus for preview (avoids heavy work during held navigation) ── */
  useEffect(() => {
    if (focusedRail < 0 || focusedIndex < 0) {
      setSettledFocusedRail(focusedRail);
      setSettledFocusedIndex(focusedIndex);
      return;
    }
    if (settledFocusTimerRef.current) clearTimeout(settledFocusTimerRef.current);
    settledFocusTimerRef.current = setTimeout(() => {
      setSettledFocusedRail(focusedRail);
      setSettledFocusedIndex(focusedIndex);
    }, 200);
    return () => {
      if (settledFocusTimerRef.current) clearTimeout(settledFocusTimerRef.current);
    };
  }, [focusedRail, focusedIndex]);

  /* ── Tracks whether the user intentionally selected an empty category ── */
  const userSelectedEmptyRef = useRef(false);

  const handleSelectCategory = useCallback((index: number) => {
    const isEmpty = (rails[index]?.length ?? 0) === 0;
    if (DEBUG_CONSOLE_ENTRY) {
      const CATEGORY_ORDER = ["continue", "installed", "lua", "favorites", "all"];
      console.log(`[CONSOLE_ENTRY][CATEGORY_VALIDATE] selected=${CATEGORY_ORDER[index] ?? index} count=${rails[index]?.length ?? 0} isEmpty=${isEmpty}`);
    }
    userSelectedEmptyRef.current = isEmpty;
    focusRail(index, 0);
  }, [rails, focusRail]);

  /* ── Entry state initialization: ensure focusedRail points to a non-empty category ── */
  const entryInitializedRef = useRef(false);

  useEffect(() => {
    if (entryInitializedRef.current) return;

    if (focusedRail >= 0) {
      entryInitializedRef.current = true;
      return;
    }

    const CATEGORY_ORDER = ["continue", "installed", "lua", "favorites", "all"];
    const startIdx = CATEGORY_ORDER.indexOf(consoleSettings.startCategory);
    const preferredRail = startIdx >= 0 ? startIdx : 4;

    if (DEBUG_CONSOLE_ENTRY) {
      console.log(`[CONSOLE_ENTRY][CATEGORY] selected=${consoleSettings.startCategory} preferredRail=${preferredRail}`);
    }

    // Check if preferred rail has games
    if (rails[preferredRail]?.length > 0) {
      if (DEBUG_CONSOLE_ENTRY) {
        console.log(`[CONSOLE_ENTRY][FOCUS_GAME] rail=${preferredRail} appid=${rails[preferredRail][0]?.appId}`);
      }
      focusRail(preferredRail, 0);
      entryInitializedRef.current = true;
      return;
    }

    // Fallback order: continue → installed → lua → favorites → all
    const fallbackOrder = [0, 1, 2, 3, 4];
    for (const i of fallbackOrder) {
      if (i !== preferredRail && rails[i]?.length > 0) {
        if (DEBUG_CONSOLE_ENTRY) {
          console.log(`[CONSOLE_ENTRY][FALLBACK_CATEGORY] from=${consoleSettings.startCategory} to=${CATEGORY_ORDER[i]} reason=empty`);
        }
        focusRail(i, 0);
        entryInitializedRef.current = true;
        return;
      }
    }

    // No games exist at all — show empty state, clear any stale preview
    if (DEBUG_CONSOLE_ENTRY) {
      console.log(`[CONSOLE_ENTRY][CLEAR_PREVIEW] reason=no-games`);
    }
    entryInitializedRef.current = true;
  }, [focusedRail, rails, focusRail, consoleSettings.startCategory]);

  /* ── Re-validate current category when rails change (games loaded, etc.) ──
   *  If current rail becomes empty and user didn't manually select an empty
   *  category, fallback to first non-empty rail. */
  useEffect(() => {
    if (!entryInitializedRef.current) return;

    const currentLength = focusedRail >= 0 && focusedRail < rails.length ? rails[focusedRail].length : 0;

    if (currentLength > 0) {
      userSelectedEmptyRef.current = false; // Category auto-recovered
      if (focusedIndex >= currentLength) {
        if (DEBUG_CONSOLE_ENTRY) {
          console.log(`[CONSOLE_ENTRY][CLAMP_INDEX] rail=${focusedRail} from=${focusedIndex} to=0 reason=out-of-bounds`);
        }
        focusRail(focusedRail, 0);
      }
      return;
    }

    // Current rail is empty — check if user manually chose it
    if (userSelectedEmptyRef.current) {
      if (DEBUG_CONSOLE_ENTRY) {
        console.log(`[CONSOLE_ENTRY][CLEAR_FOCUS] reason=user-selected-empty shadow=${focusedRail}`);
      }
      return;
    }

    // Auto-fallback to first non-empty category
    const CATEGORY_ORDER = ["continue", "installed", "lua", "favorites", "all"];
    for (let i = 0; i < rails.length; i++) {
      if (rails[i].length > 0) {
        if (DEBUG_CONSOLE_ENTRY) {
          const fromLabel = focusedRail >= 0 && focusedRail < CATEGORY_ORDER.length ? CATEGORY_ORDER[focusedRail] : `rail-${focusedRail}`;
          console.log(`[CONSOLE_ENTRY][FALLBACK_CATEGORY] from=${fromLabel} to=${CATEGORY_ORDER[i]} reason=empty`);
        }
        userSelectedEmptyRef.current = false;
        focusRail(i, 0);
        return;
      }
    }

    // All categories empty
    if (DEBUG_CONSOLE_ENTRY) {
      console.log(`[CONSOLE_ENTRY][CLEAR_FOCUS] reason=all-empty`);
    }
  }, [rails, focusedRail, focusedIndex, focusRail]);

  const sharedProps = useMemo(() => ({
    focusedGame: currentFocusedGame,
    settledFocusedGame: currentSettledFocusedGame,
    rails,
    focusedRail,
    focusedIndex,
    onSelectGame: handleSelectGame,
    onOptionsGame: handleOptionsGame,
    onPlayGame: handleConsolePlay,
    layoutMode: consoleSettings.layoutMode,
    onToggleLayout: toggleLayout,
    onNavigate,
    categoryCounts: railLengths,
    activeCategory: focusedRail >= 0 ? focusedRail : 0,
    onSelectCategory: handleSelectCategory,
    settings: consoleSettings,
    onSettingsPatch: patchConsoleSettings,
    allGames: enrichedGames,
    gridColumnsRef,
    dockFocusedIndex,
  }), [currentFocusedGame, currentSettledFocusedGame, rails, focusedRail, focusedIndex, handleSelectGame, handleOptionsGame, handleConsolePlay, consoleSettings.layoutMode, toggleLayout, onNavigate, railLengths, handleSelectCategory, consoleSettings, patchConsoleSettings, enrichedGames, gridColumnsRef, dockFocusedIndex]);

  const layout = consoleSettings.layoutMode === "spotlight"
    ? <ConsoleSwitchSpotlightLayout {...sharedProps} />
    : <ConsoleGridLayout {...sharedProps} />;

  return (
    <div data-console-theme={consoleSettings.themeMode} data-console-texture={consoleSettings.backgroundTexture} className={`relative h-full w-full ${cursorHidden ? "cursor-none" : ""}`}>
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
          onProfileOpen={() => { setProfileOpen(true); }}
          gamepadDisabled={searchOpen}
          quickMenuOpen={profileOpen}
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

      {/* Profile / Quick Menu panel */}
      {profileOpen && (
        <ConsoleSettingsPanelV2
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          settings={consoleSettings}
          onPatch={patchConsoleSettings}
          onNavigate={onNavigate}
          allGames={enrichedGames}
          onSelectGame={handleSelectGame}
          onRefreshLibrary={refreshLibraryGames}
        />
      )}
    </div>
  );
}
