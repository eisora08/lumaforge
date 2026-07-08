import { useEffect, useRef, useState, useTransition } from "react";
import { countRender, logRenderSummary, startRenderSession, markNavigation } from "./services/perfCounters";

import AppLayout from "./components/layout/AppLayout";

import Home from "./pages/Home";
import Library from "./pages/Library";
import Store from "./pages/Store";
import Games from "./pages/Games";
import GlobalSearchResults from "./pages/GlobalSearchResults";
import Downloads from "./pages/Downloads";
import Achievements from "./pages/Achievements";
import Activity from "./pages/Activity";
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
import { AppPage } from "./types/navigation";
import { getCachedStoreDiscover, isCacheComplete } from "./services/storeDiscoverCache";
import InstallerProgressListener from "./components/downloads/InstallerProgressListener";
import SplashScreen from "./components/splash/SplashScreen";
import LibraryLoadProgressCard from "./components/loading/LibraryLoadProgressCard";
import AchievementWatcherInit from "./components/achievements/AchievementWatcherInit";
import BackgroundJobDebugPanel from "./components/common/BackgroundJobDebugPanel";
import { runBootTasks } from "./services/appBootCoordinator";
import AppRouteTransition from "./components/common/AppRouteTransition";
import { ConfirmProvider } from "./services/confirmService";
import { pauseBackgroundFill, resumeBackgroundFill } from "./services/backgroundValidator";

const ACTIVE_PAGE_KEY = "lumaforge-active-page-v1";
const KNOWN_PAGES: Set<AppPage> = new Set([
  "home", "library", "games", "store", "downloads",
  "achievements", "activity", "verification", "tools",
  "settings", "game-details", "library-game-detail", "global-search", "console",
]);

function restoreActivePage(): AppPage {
  try {
    const stored = localStorage.getItem(ACTIVE_PAGE_KEY);
    if (stored && KNOWN_PAGES.has(stored as AppPage)) {
      // Phase: If last route was Store but no complete cache, start on Home instead
      if (stored === "store") {
        const cached = getCachedStoreDiscover();
        if (!isCacheComplete(cached)) {
          console.log(`[ROUTE][RESTORE_FALLBACK] from=store to=home reason=no-complete-store-cache`);
          return "home";
        }
      }
      return stored as AppPage;
    }
  } catch { /* ignore */ }
  return "home";
}

const NAV_PERF_ENABLED = true;
const DEBUG_ROUTE_RENDER = false;

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
  const [, startTransition] = useTransition();
  const initialRender = useRef(true);
  const prevPageRef = useRef(activePage);

  // Start boot coordinator once on mount
  useEffect(() => {
    if (bootStarted) return;
    setBootStarted(true);
    runBootTasks();
  }, [bootStarted]);

  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    try {
      localStorage.setItem(ACTIVE_PAGE_KEY, activePage);
    } catch { /* ignore */ }
    // Phase 1: Mount audit — confirm only the active route's page is mounted
    console.log(`[ROUTE][MOUNT_AUDIT] active=${activePage} mountedPages=[${activePage}]`);
    // Log render summary on route change
    logRenderSummary(`previousRoute=${prevPageRef.current} nextRoute=${activePage}`);
    startRenderSession();
    prevPageRef.current = activePage;
  }, [activePage]);

  function handleNavigate(page: AppPage) {
    if (page === activePage) return;
    const startTime = NAV_PERF_ENABLED ? performance.now() : 0;

    // Phase 9: Mark navigation timestamp so services can defer background work
    markNavigation();

    if (page === "game-details") {
      setGameDetailsPrevPage(activePage);
    }

    pauseBackgroundFill();

    startTransition(() => {
      setActivePage(page);
    });

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
    // Phase 2: Confirm only the active route page renders
    if (DEBUG_ROUTE_RENDER && import.meta.env.DEV) {
      console.log(`[ROUTE][PAGE_RENDER] active=${activePage} rendered=${activePage}`);
    }
    switch (activePage) {
      case "home":
        return <Home onNavigate={handleNavigate} />;
      case "library":
        return <Library onNavigate={handleNavigate} />;
      case "games":
        return <Games />;
      case "store":
        return <Store />;
      case "global-search":
        return <GlobalSearchResults onBack={() => handleNavigate("home")} onNavigate={(page) => handleNavigate(page as AppPage)} />;
      case "downloads":
        return <Downloads onNavigate={handleNavigate} />;
      case "achievements":
        return <Achievements />;
      case "activity":
        return <Activity />;
      case "verification":
        return <Verification />;
      case "tools":
        return <Tools />;
      case "settings":
        return <Settings />;
      case "game-details":
        return <GameDetailsPage onBack={() => handleNavigate(gameDetailsPrevPage)} />;
      case "library-game-detail":
        return <LibraryGameDetailPage onBack={() => handleNavigate("library")} onNavigate={handleNavigate} />;
      case "console":
        return <ConsoleModePage />;
      default:
        return <Home />;
    }
  }


  return (
    <ConfirmProvider>
      <GameSessionProvider>
      <SessionOverlayWrapper />
      <AchievementWatcherInit />
      <GameDetailsProvider>
        <GameSessionHUD onNavigate={handleNavigate} />
        <AppLayout activePage={activePage} onNavigate={handleNavigate}>
          <AppRouteTransition routeKey={activePage}>
            {renderPage()}
          </AppRouteTransition>
        </AppLayout>
      </GameDetailsProvider>
      </GameSessionProvider>
      <InstallerProgressListener />
      <GameToastViewport />
      {import.meta.env.DEV && <BackgroundJobDebugPanel />}
      {/* Splash screen overlay — covers half-loaded UI during boot */}
      <SplashScreen />
      <LibraryLoadProgressCard />
    </ConfirmProvider>
  );

}

export default App;