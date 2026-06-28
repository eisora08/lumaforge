import { useState } from "react";

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
function App() {
  const [activePage, setActivePage] = useState<AppPage>("home");
  const [gameDetailsPrevPage, setGameDetailsPrevPage] = useState<AppPage>("store");

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
        return <LibraryGameDetailPage onBack={() => handleNavigate("library")} />;
      default:
        return <Home />;
    }
  }


  return (
    <>
      <GameDetailsProvider>
        <AppLayout activePage={activePage} onNavigate={handleNavigate}>
          {renderPage()}
        </AppLayout>
      </GameDetailsProvider>
      <InstallerProgressListener />
      <GameToastViewport />
    </>
  );

}

export default App;