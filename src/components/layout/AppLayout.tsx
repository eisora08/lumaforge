import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { SearchProvider } from "../../context/SearchContext";
import { LibraryGamesProvider } from "../../context/LibraryGamesContext";
import { GameActivityProvider } from "../../context/GameActivityContext";
import type { AppPage } from "../../types/navigation";
import type { SidebarMode } from "./Sidebar";
import { countRender } from "../../services/perfCounters";

type AppLayoutProps = {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  children: React.ReactNode;
  isConsoleMode?: boolean;
};

const BP_DRAWER = 900;
const BP_COLLAPSED = 1200;
const BP_COMPACT = 1600;

const SIDEBAR_WIDTHS: Record<SidebarMode, number> = {
  expanded: 360,
  compact: 340,
  collapsed: 72,
  drawer: 360,
};

function getAutoMode(width: number): SidebarMode {
  if (width < BP_DRAWER) return "drawer";
  if (width < BP_COLLAPSED) return "collapsed";
  if (width < BP_COMPACT) return "compact";
  return "expanded";
}

export default function AppLayout({
  activePage,
  onNavigate,
  children,
  isConsoleMode,
}: AppLayoutProps) {
  if (isConsoleMode) {
    return (
      <div className="relative h-screen w-screen overflow-hidden bg-(--color-bg) text-(--color-text)">
        <div className="lf-backdrop" />
        <LibraryGamesProvider>
          <GameActivityProvider>
            {children}
          </GameActivityProvider>
        </LibraryGamesProvider>
      </div>
    );
  }
  countRender("AppLayout");
  const [manualMode, setManualMode] = useState<"auto" | "expanded" | "collapsed">("auto");
  const [autoMode, setAutoMode] = useState<SidebarMode>("expanded");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const prevWidthRef = useRef(0);

  const effectiveMode: SidebarMode =
    manualMode !== "auto" ? manualMode : autoMode;

  const isDrawerMode = effectiveMode === "drawer";
  const sidebarWidth = SIDEBAR_WIDTHS[effectiveMode];

  useEffect(() => {
    function compute() {
      setAutoMode(getAutoMode(window.innerWidth));
    }
    compute();
    function handleResize() {
      const w = window.innerWidth;
      const newMode = getAutoMode(w);

      setAutoMode(newMode);

      if (newMode === "drawer" && prevWidthRef.current >= BP_DRAWER) {
        setDrawerOpen(false);
      }

      if (manualMode !== "auto") {
        if (newMode === "drawer") {
          setManualMode("auto");
        }
      }

      prevWidthRef.current = w;
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [manualMode]);

  const handleToggleCollapse = useCallback(() => {
    if (manualMode === "auto") {
      if (autoMode === "expanded" || autoMode === "compact") {
        setManualMode("collapsed");
      } else {
        setManualMode("expanded");
      }
    } else if (manualMode === "collapsed") {
      setManualMode("expanded");
    } else {
      setManualMode("collapsed");
    }
  }, [manualMode, autoMode]);

  const handleOpenSidebar = useCallback(() => {
    if (isDrawerMode) {
      setDrawerOpen(true);
    }
  }, [isDrawerMode]);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  return (
    <div
      className="relative h-screen overflow-hidden bg-(--color-bg) text-(--color-text)"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <div className="lf-backdrop" />

      <LibraryGamesProvider>
        <GameActivityProvider>
        <div className="relative z-10 flex h-screen w-full">
          <Sidebar
            mode={effectiveMode}
            isDrawerOpen={drawerOpen}
            activePage={activePage}
            onClose={handleCloseDrawer}
            onToggleCollapse={handleToggleCollapse}
            onNavigate={onNavigate}
          />

          <div className="flex min-w-0 flex-1 flex-col lf-page">
            <SearchProvider>
              <TopBar
                onOpenSidebar={handleOpenSidebar}
                activePage={activePage}
                onNavigate={onNavigate}
                sidebarDrawerMode={isDrawerMode}
              />

              <main className="min-h-0 flex-1 overflow-y-auto">
                {children}
              </main>
            </SearchProvider>
          </div>
        </div>
        </GameActivityProvider>
      </LibraryGamesProvider>
    </div>
  );
}
