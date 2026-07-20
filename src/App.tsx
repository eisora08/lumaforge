import { useEffect, useRef, useState } from "react";
import { countRender, logRenderSummary, startRenderSession, markNavigation } from "./services/perfCounters";

import AppLayout from "./components/layout/AppLayout";

import Home from "./pages/Home";
import Library from "./pages/Library";
import Store from "./pages/Store";
import Games from "./pages/Games";
import GlobalSearchResults from "./pages/GlobalSearchResults";
import Downloads from "./pages/Downloads";
import Achievements from "./pages/Achievements";
import ActivityStats from "./pages/ActivityStats";
import LauncherAchievements from "./pages/LauncherAchievements";
import Verification from "./pages/Verification";
import Tools from "./pages/Tools";
import Settings from "./pages/Settings";
import GameDetailsPage from "./pages/GameDetails";
import LibraryGameDetailPage from "./pages/LibraryGameDetailPage";
import ConsoleModePage from "./features/console/ConsoleModePage";
import { GameDetailsProvider } from "./context/GameDetailsContext";
import { GameSessionProvider, useGameSession } from "./context/GameSessionContext";
import GameSessionOverlay from "./components/overlays/GameSessionOverlay";
import GameSessionHUD from "./components/system/GameSessionHUD";
import { showSessionOverlay, isSessionOverlayEnabled } from "./services/sessionOverlayService";
import { GameToastViewport } from "./components/toast/GameToast";
import { AchievementToastViewport } from "./components/activity/AchievementToast";
import { AppPage } from "./types/navigation";

import InstallerProgressListener from "./components/downloads/InstallerProgressListener";
import SplashScreen from "./components/splash/SplashScreen";
import ModeSwitchSplash from "./components/splash/ModeSwitchSplash";
import type { ModeSwitchMode } from "./components/splash/ModeSwitchSplash";
import LibraryLoadProgressCard from "./components/loading/LibraryLoadProgressCard";
import AchievementWatcherInit from "./components/achievements/AchievementWatcherInit";
import BackgroundJobDebugPanel from "./components/common/BackgroundJobDebugPanel";
import { runBootTasks } from "./services/appBootCoordinator";
import AppRouteTransition from "./components/common/AppRouteTransition";
import { ConfirmProvider } from "./services/confirmService";
import { pauseBackgroundFill, resumeBackgroundFill } from "./services/backgroundValidator";
import { setAppFullscreen, toggleAppFullscreen } from "./services/windowModeService";
import { useSettings } from "./context/SettingsContext";
import { setConsoleMode } from "./features/console/consoleInputHints";
import { bootstrapExtensions } from "./extensions/bootstrap";

const ACTIVE_PAGE_KEY = "lumaforge-active-page-v1";
const KNOWN_PAGES: Set<AppPage> = new Set([
  "home", "library", "games", "store", "downloads",
  "achievements", "activity", "verification", "tools",
  "settings", "game-details", "library-game-detail", "global-search", "console",
  "launcher-achievements",
]);

function restoreActivePage(): AppPage {
  try {
    const stored = localStorage.getItem(ACTIVE_PAGE_KEY);
    if (stored && KNOWN_PAGES.has(stored as AppPage)) {
      // Store handles its own partial cache gracefully via allStoreSections fallback.
      // No longer redirect Store → Home on incomplete cache — let Store render
      // with whatever cached data is available (partial sections, ranked catalog, etc.).
      return stored as AppPage;
    }
  } catch { /* ignore */ }
  return "home";
}

const NAV_PERF_ENABLED = false;
const DEBUG_ROUTE_RENDER = false;
const DEBUG_ROUTE_SHELL = false;



function SessionOverlayWrapper() {
  const { overlayEvent, clearOverlay } = useGameSession();
  const handledIdsRef = useRef(new Set<string>());
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!overlayEvent) return;
    if (!isSessionOverlayEnabled()) return;
    if (handledIdsRef.current.has(overlayEvent.id)) return;

    const eventId = overlayEvent.id;
    const dismissMs = overlayEvent.type === "launch" ? 3000 : 4000;

    showSessionOverlay({
      type: overlayEvent.type,
      gameTitle: overlayEvent.gameTitle,
      provider: overlayEvent.provider,
      imageUrl: overlayEvent.imageUrl,
      durationSeconds: overlayEvent.durationSeconds,
    }).then((ok) => {
      if (ok) {
        handledIdsRef.current.add(eventId);
        forceUpdate(v => v + 1);
        setTimeout(() => { clearOverlay(); }, dismissMs + 300);
      } else {
        forceUpdate(v => v + 1);
      }
    });
  }, [overlayEvent?.id, clearOverlay]);

  if (overlayEvent && handledIdsRef.current.has(overlayEvent.id)) {
    return null;
  }

  return <GameSessionOverlay event={overlayEvent} onDismiss={clearOverlay} />;
}

function App() {
  countRender("App");
  const [activePage, setActivePage] = useState<AppPage>(restoreActivePage);
  const [gameDetailsPrevPage, setGameDetailsPrevPage] = useState<AppPage>("store");
  const [bootStarted, setBootStarted] = useState(false);
  const [showModeSwitch, setShowModeSwitch] = useState(false);
  const [modeSwitchMode, setModeSwitchMode] = useState<ModeSwitchMode>("enter-console");
  const modeSwitchKeyRef = useRef(0);
  const initialRender = useRef(true);
  const prevPageRef = useRef(activePage);
  const { settings } = useSettings();

  // Start boot coordinator once on mount
  useEffect(() => {
    if (bootStarted) return;
    setBootStarted(true);
    runBootTasks();
  }, [bootStarted]);

  // Bootstrap extensions at app startup (built-in + repository)
  useEffect(() => {
    bootstrapExtensions().then((result) => {
      console.log(`[App] Extensions bootstrapped: ${result.registered} registered, ${result.skipped} skipped, ${result.errors.length} errors`);
    }).catch((err) => {
      console.error("[App] Extension bootstrap failed:", err);
    });
  }, []);

  // Init catalog orchestrator at app level — loads disk cache, provides canonical sections to Home and Store
  useEffect(() => {
    (async () => {
      const { initCatalogOrchestrator } = await import("./services/storeCatalogOrchestrator");
      await initCatalogOrchestrator({
        rawgApiKey: settings.rawgApiKey,
        igdbClientId: settings.igdbClientId,
        igdbClientSecret: settings.igdbClientSecret,
      });
    })();
  }, [settings.rawgApiKey, settings.igdbClientId, settings.igdbClientSecret]);

  useEffect(() => {
    setConsoleMode(activePage === "console");
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    try {
      localStorage.setItem(ACTIVE_PAGE_KEY, activePage);
    } catch { /* ignore */ }
    // Phase 1: Mount audit — confirm only the active route's page is mounted
    if (DEBUG_ROUTE_RENDER && import.meta.env.DEV) {
      console.log(`[ROUTE][MOUNT_AUDIT] active=${activePage} mountedPages=[${activePage}]`);
    }
    // Log render summary on route change
    logRenderSummary(`previousRoute=${prevPageRef.current} nextRoute=${activePage}`);
    startRenderSession();
    prevPageRef.current = activePage;
  }, [activePage]);

  // F11 fullscreen toggle — only active in Console Mode
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "F11") return;
      if (activePage !== "console") return;
      e.preventDefault();
      toggleAppFullscreen();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePage]);

  function handleNavigate(page: AppPage) {
    if (page === activePage) return;
    const startTime = NAV_PERF_ENABLED ? performance.now() : 0;

    // Phase 9: Mark navigation timestamp so services can defer background work
    markNavigation();

    const isEnteringConsole = page === "console";
    const isLeavingConsole = activePage === "console" && !isEnteringConsole;

    // Show mode switch splash for Desktop ↔ Console transitions
    if (isEnteringConsole || isLeavingConsole) {
      modeSwitchKeyRef.current += 1;
      setModeSwitchMode(isEnteringConsole ? "enter-console" : "exit-console");
      setShowModeSwitch(true);
    }

    if (isEnteringConsole) {
      setAppFullscreen(true);
    } else if (isLeavingConsole) {
      setAppFullscreen(false);
    }

    if (page === "game-details") {
      setGameDetailsPrevPage(activePage);
    }

    pauseBackgroundFill();

    // CRITICAL: setActivePage must be synchronous — do NOT wrap in startTransition.
    // Deferring activePage causes a race window where ModeSwitchSplash disappears
    // before the new route mounts, leaving lf-route-visible empty.
    setActivePage(page);

    if (NAV_PERF_ENABLED) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const elapsed = Math.round(performance.now() - startTime);
          console.log(`[NavPerf] ${activePage} -> ${page} shell: ${elapsed}ms`);
        });
      });
    }

    setTimeout(() => resumeBackgroundFill(), 2000);
  }

  function renderPage() {
    if (DEBUG_ROUTE_RENDER && import.meta.env.DEV) {
      console.log(`[ROUTE][PAGE_RENDER] active=${activePage}`);
    }
    let pageComponent: React.ReactNode = null;
    switch (activePage) {
      case "home":
        pageComponent = <Home onNavigate={handleNavigate} />;
        break;
      case "library":
        pageComponent = <Library onNavigate={handleNavigate} />;
        break;
      case "games":
        pageComponent = <Games />;
        break;
      case "store":
        pageComponent = <Store onNavigate={handleNavigate} />;
        break;
      case "global-search":
        pageComponent = <GlobalSearchResults onBack={() => handleNavigate("home")} onNavigate={(page) => handleNavigate(page as AppPage)} />;
        break;
      case "downloads":
        pageComponent = <Downloads onNavigate={handleNavigate} />;
        break;
      case "achievements":
        pageComponent = <Achievements />;
        break;
      case "activity":
        pageComponent = <ActivityStats />;
        break;
      case "launcher-achievements":
        pageComponent = <LauncherAchievements />;
        break;
      case "verification":
        pageComponent = <Verification />;
        break;
      case "tools":
        pageComponent = <Tools />;
        break;
      case "settings":
        pageComponent = <Settings />;
        break;
      case "game-details":
        pageComponent = <GameDetailsPage onBack={() => handleNavigate(gameDetailsPrevPage)} onNavigate={handleNavigate} />;
        break;
      case "library-game-detail":
        pageComponent = <LibraryGameDetailPage onBack={() => handleNavigate("library")} onNavigate={handleNavigate} />;
        break;
      case "console":
        pageComponent = <ConsoleModePage onNavigate={handleNavigate} />;
        break;
      default:
        pageComponent = <Home />;
        break;
    }
    if (DEBUG_ROUTE_SHELL) {
      console.log(`[ROUTE][RENDER] activePage=${activePage} hasComponent=${!!pageComponent}`);
    }
    return pageComponent;
  }


  return (
    <ConfirmProvider>
      <GameSessionProvider>
      <SessionOverlayWrapper />
      <AchievementWatcherInit />
      <GameDetailsProvider>
        <GameSessionHUD onNavigate={handleNavigate} />
        <AppLayout activePage={activePage} onNavigate={handleNavigate} isConsoleMode={activePage === "console"}>
          <AppRouteTransition routeKey={activePage}>
            {renderPage() ?? (
              <div className="flex h-full items-center justify-center text-(--color-muted)">
                {DEBUG_ROUTE_SHELL && console.warn(`[ROUTE][EMPTY] activePage=${activePage} renderPage returned null`)}
                <span>Page failed to render</span>
              </div>
            )}
          </AppRouteTransition>
        </AppLayout>
      </GameDetailsProvider>
      </GameSessionProvider>
      <InstallerProgressListener />
      <GameToastViewport />
      <AchievementToastViewport />
      {import.meta.env.DEV && <BackgroundJobDebugPanel />}
      {/* Mode switch splash — covers Desktop ↔ Console transitions */}
      {showModeSwitch && (
        <ModeSwitchSplash
          key={modeSwitchKeyRef.current}
          mode={modeSwitchMode}
          visible={true}
          onComplete={() => setShowModeSwitch(false)}
        />
      )}
      {/* Splash screen overlay — covers half-loaded UI during boot */}
      <SplashScreen />
      <LibraryLoadProgressCard />
    </ConfirmProvider>
  );

}

export default App;