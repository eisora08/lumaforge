import { useEffect, useRef, useState } from "react";

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
import { GameToastViewport } from "./components/toast/GameToast";
import { AppPage } from "./types/navigation";
import InstallerProgressListener from "./components/downloads/InstallerProgressListener";

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

function App() {
  const [activePage, setActivePage] = useState<AppPage>(restoreActivePage);
  const [gameDetailsPrevPage, setGameDetailsPrevPage] = useState<AppPage>("store");
  const initialRender = useRef(true);

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
    if (page === "game-details") {
      setGameDetailsPrevPage(activePage);
    }
    setActivePage(page);
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
      <GameDetailsProvider>
        <AppLayout activePage={activePage} onNavigate={handleNavigate}>
          <div key={activePage} className="lf-fade-in">
            {renderPage()}
          </div>
        </AppLayout>
      </GameDetailsProvider>
      <InstallerProgressListener />
      <GameToastViewport />
    </>
  );

}

export default App;