import { useState } from "react";

import AppLayout from "./components/layout/AppLayout";

import Home from "./pages/Home";
import Library from "./pages/Library";
import Games from "./pages/Games";
import Packages from "./pages/Packages";
import Downloads from "./pages/Downloads";
import Achievements from "./pages/Achievements";
import Activity from "./pages/Activity";
import Verification from "./pages/Verification";
import Tools from "./pages/Tools";
import Settings from "./pages/Settings";
import { GameToastViewport } from "./components/toast/GameToast";
import { AppPage } from "./types/navigation";

function App() {
  const [activePage, setActivePage] = useState<AppPage>("home");

  function renderPage() {
    switch (activePage) {
      case "home":
        return <Home />;
      case "library":
        return <Library />;
      case "games":
        return <Games />;
      case "packages":
        return <Packages />;
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
      default:
        return <Home />;
    }
  }


  return (
    <>
      <AppLayout activePage={activePage} onNavigate={setActivePage}>
        {renderPage()}
      </AppLayout>

      <GameToastViewport />
    </>
  );

}

export default App;