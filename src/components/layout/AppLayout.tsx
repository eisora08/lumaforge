import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import AmbientBackground from "./AmbientBackground";
import { SearchProvider } from "../../context/SearchContext";
import { LibraryGamesProvider } from "../../context/LibraryGamesContext";
import { GameActivityProvider } from "../../context/GameActivityContext";
import { StoreTabProvider, useStoreTab, type StoreTabId } from "../../context/StoreTabContext";
import { BackButtonProvider, useBackButtonContext } from "../../context/BackButtonContext";
import type { AppPage } from "../../types/navigation";
import type { SidebarMode } from "./Sidebar";
import { countRender } from "../../services/perfCounters";
import RouteErrorBoundary from "../common/RouteErrorBoundary";

type AppLayoutProps = {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  children: React.ReactNode;
  isConsoleMode?: boolean;
};

const BP_DRAWER = 900;
const BP_COLLAPSED = 1200;
const BP_COMPACT = 1600;
const BP_ULTRAWIDE = 3440;

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

/** Sidebar density scale: 0=compact, 1=standard(1080p), 2=1440p, 3=4K, 4=ultrawide */
function getSidebarDensity(width: number): number {
  if (width >= BP_ULTRAWIDE) return 4;
  if (width >= 2560) return 3;
  if (width >= 1920) return 2;
  if (width >= 1440) return 1;
  return 0;
}

/** Sidebar width scaled by density */
const DENSITY_WIDTHS: Record<number, number> = {
  0: 300,   // compact / small
  1: 300,   // 1080p
  2: 320,   // 1440p
  3: 340,   // 4K
  4: 388,   // ultrawide
};

function getScaledSidebarWidth(mode: SidebarMode, density: number): number {
  if (mode === "collapsed") return SIDEBAR_WIDTHS.collapsed;
  if (mode === "drawer") return SIDEBAR_WIDTHS.drawer;
  return DENSITY_WIDTHS[density] ?? 320;
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
        <AmbientBackground />
        <div className="relative z-10 h-full w-full">
          <LibraryGamesProvider>
            <GameActivityProvider>
              <RouteErrorBoundary>
                {children}
              </RouteErrorBoundary>
            </GameActivityProvider>
          </LibraryGamesProvider>
        </div>
      </div>
    );
  }
  countRender("AppLayout");
  const [manualMode, setManualMode] = useState<"auto" | "expanded" | "collapsed">("auto");
  const [autoMode, setAutoMode] = useState<SidebarMode>("expanded");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarDensity, setSidebarDensity] = useState(() => getSidebarDensity(typeof window !== "undefined" ? window.innerWidth : 1920));
  const prevWidthRef = useRef(0);

  const effectiveMode: SidebarMode =
    manualMode !== "auto" ? manualMode : autoMode;

  const isDrawerMode = effectiveMode === "drawer";
  const sidebarWidth = getScaledSidebarWidth(effectiveMode, sidebarDensity);

  useEffect(() => {
    function handleResize() {
      const w = window.innerWidth;
      const newMode = getAutoMode(w);
      setAutoMode(newMode);
      setSidebarDensity(getSidebarDensity(w));

      if (newMode === "drawer" && prevWidthRef.current >= BP_DRAWER) {
        setDrawerOpen(false);
      }

      // Reset manual mode on resize so sidebar stays responsive
      if (manualMode !== "auto") {
        setManualMode("auto");
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
      className="relative flex h-screen flex-col overflow-hidden bg-(--color-bg) text-(--color-text)"
      style={{ "--sidebar-width": `${sidebarWidth}px`, "--sidebar-density": sidebarDensity } as React.CSSProperties}
      data-density={sidebarDensity}
    >
      <div className="lf-backdrop" />
      <AmbientBackground />

      <LibraryGamesProvider>
        <GameActivityProvider>
        <StoreTabProvider>
        <BackButtonProvider>
        <div className="relative z-10 flex flex-1 w-full overflow-hidden">
          <Sidebar
            mode={effectiveMode}
            isDrawerOpen={drawerOpen}
            activePage={activePage}
            onClose={handleCloseDrawer}
            onToggleCollapse={handleToggleCollapse}
            onNavigate={onNavigate}
            width={sidebarWidth}
          />

          <div className="flex min-w-0 flex-1 flex-col lf-page">
            <SearchProvider>
              <TopBarShell
                activePage={activePage}
                onNavigate={onNavigate}
                sidebarDrawerMode={isDrawerMode}
                onOpenSidebar={handleOpenSidebar}
              />

              <main className="min-h-0 flex-1 overflow-y-auto">
                <RouteErrorBoundary>
                  {children}
                </RouteErrorBoundary>
              </main>
            </SearchProvider>
          </div>
        </div>
        </BackButtonProvider>
        </StoreTabProvider>
        </GameActivityProvider>
      </LibraryGamesProvider>
    </div>
  );
}

const STORE_TAB_LIST = [
  { id: "discover" as const, label: "Discover" },
  { id: "browse" as const, label: "Browse" },
  { id: "repacks" as const, label: "Repacks" },
];

function TopBarShell({ activePage, onNavigate, sidebarDrawerMode, onOpenSidebar }: {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  sidebarDrawerMode: boolean;
  onOpenSidebar: () => void;
}) {
  const { activeStoreTab, setStoreTab } = useStoreTab();
  const { onBack, label: backLabel } = useBackButtonContext();
  const handleStoreTabChange = useCallback((tab: StoreTabId) => {
    setStoreTab(tab);
    window.dispatchEvent(new CustomEvent("store-tab-change", { detail: { tab } }));
  }, [setStoreTab]);
  return (
    <TopBar
      onOpenSidebar={onOpenSidebar}
      activePage={activePage}
      onNavigate={onNavigate}
      sidebarDrawerMode={sidebarDrawerMode}
      storeTabs={STORE_TAB_LIST}
      activeStoreTab={activeStoreTab}
      onStoreTabChange={handleStoreTabChange}
      onBack={onBack}
      backLabel={backLabel}
    />
  );
}
