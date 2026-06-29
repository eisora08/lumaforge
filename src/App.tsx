import { useEffect, useRef, useState, useTransition } from "react";

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
import { GameDetailsProvider } from "./context/GameDetailsContext";
import { GameSessionProvider } from "./context/GameSessionContext";
import { GameToastViewport } from "./components/toast/GameToast";
import { AppPage } from "./types/navigation";
import InstallerProgressListener from "./components/downloads/InstallerProgressListener";
import SplashScreen from "./components/splash/SplashScreen";
import { runBootTasks } from "./services/appBootCoordinator";
import AppRouteTransition from "./components/common/AppRouteTransition";
import { pauseBackgroundFill, resumeBackgroundFill } from "./services/backgroundValidator";

const ACTIVE_PAGE_KEY = "lumaforge-active-page-v1";
const KNOWN_PAGES: Set<AppPage> = new Set([
  "home", "library", "games", "store", "downloads",
  "achievements", "activity", "verification", "tools",
  "settings", "game-details", "library-game-detail", "global-search",
]);

function restoreActivePage(): AppPage {
  try {
    const stored = localStorage.getItem(ACTIVE_PAGE_KEY);
    if (stored && KNOWN_PAGES.has(stored as AppPage)) {
      return stored as AppPage;
    }
  } catch { /* ignore */ }
  return "home";
}

const NAV_PERF_ENABLED = true;

function App() {
  const [activePage, setActivePage] = useState<AppPage>(restoreActivePage);
  const [gameDetailsPrevPage, setGameDetailsPrevPage] = useState<AppPage>("store");
  const [bootStarted, setBootStarted] = useState(false);
  const [, startTransition] = useTransition();
  const initialRender = useRef(true);

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
  }, [activePage]);

  function handleNavigate(page: AppPage) {
    if (page === activePage) return;
    const startTime = NAV_PERF_ENABLED ? performance.now() : 0;

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
    switch (activePage) {
      case "home":
        return <Home />;
      case "library":
        return <Library onNavigate={handleNavigate} />;
      case "games":
        return <Games />;
      case "store":
        return <Store />;
      case "global-search":
        return <GlobalSearchResults onBack={() => handleNavigate("home")} onNavigate={(page) => handleNavigate(page as AppPage)} />;
      case "downloads":
        return <Downloads />;
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
      default:
        return <Home />;
    }
  }


  return (
    <>
      <GameSessionProvider>
      <GameDetailsProvider>
        <AppLayout activePage={activePage} onNavigate={handleNavigate}>
          <AppRouteTransition routeKey={activePage}>
            {renderPage()}
          </AppRouteTransition>
        </AppLayout>
      </GameDetailsProvider>
      </GameSessionProvider>
      <InstallerProgressListener />
      <GameToastViewport />
      {/* Splash screen overlay — covers half-loaded UI during boot */}
      <SplashScreen />
    </>
  );

}

export default App;