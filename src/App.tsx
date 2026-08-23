import { useEffect, useRef, useState } from "react";
import { countRender, logRenderSummary, startRenderSession, markNavigation } from "./services/perfCounters";

import AppLayout from "./components/layout/AppLayout";
import SettingsOverlay from "./components/settings/SettingsOverlay";
import Settings from "./pages/Settings";

import Home from "./pages/Home";
import Library from "./pages/Library";
import Store from "./pages/Store";
import Games from "./pages/Games";
import GlobalSearchResults from "./pages/GlobalSearchResults";
import Achievements from "./pages/Achievements";
import ActivityStats from "./pages/ActivityStats";
import LauncherAchievements from "./pages/LauncherAchievements";
import Verification from "./pages/Verification";
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
import FixProgressListener from "./components/fixes/FixProgressListener";
import SplashScreen from "./components/splash/SplashScreen";
import ModeSwitchSplash from "./components/splash/ModeSwitchSplash";
import type { ModeSwitchMode } from "./components/splash/ModeSwitchSplash";
import LibraryLoadProgressCard from "./components/loading/LibraryLoadProgressCard";
import AchievementWatcherInit from "./components/achievements/AchievementWatcherInit";
import DebridCompletionModal from "./components/common/DebridCompletionModal";

import { runBootTasks } from "./services/appBootCoordinator";
import AppRouteTransition from "./components/common/AppRouteTransition";
import { ConfirmProvider } from "./services/confirmService";
import { pauseBackgroundFill, resumeBackgroundFill } from "./services/backgroundValidator";
import { setAppFullscreen, toggleAppFullscreen } from "./services/windowModeService";
import { useSettings } from "./context/SettingsContext";
import { setConsoleMode } from "./features/console/consoleInputHints";
import { bootstrapExtensions } from "./extensions/bootstrap";
import { useGameDetails } from "./context/GameDetailsContext";
import { setPageContextSource } from "./services/ambientBackgroundStore";
import { getBootSnapshot } from "./services/appBootCoordinator";
import { localPathToUrl, isLocalPath } from "./services/gameCacheService";
import { initDataChangeBus } from "./services/dataChangeBus";
import { pushToHistory } from "./services/navigationHistory";
import { readStartupConfig } from "./services/tauri";
import { listen } from "@tauri-apps/api/event";
import { checkForUpdate } from "./services/appUpdateStore";
import FirstRunWizard from "./components/wizard/FirstRunWizard";

const ACTIVE_PAGE_KEY = "lumaforge-active-page-v1";
const KNOWN_PAGES: Set<AppPage> = new Set([
  "home", "library", "games", "store",
  "achievements", "activity", "verification",
  "game-details", "library-game-detail", "global-search", "console",
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

// Navigation-level ambient fallback. On every page change it feeds the ambient store
// with a "page-context" background so transitions never show the previous page's stale
// art nor a blank backdrop on pages without a dedicated feed. Detail pages (dashboard
// hero, library details, console details) override it with their own scope while mounted;
// when they unmount the store falls back to this context automatically.
function AmbientNavFallback({ activePage }: { activePage: AppPage }) {
  const { selectedGame } = useGameDetails();

  useEffect(() => {
    const selectedUrl = selectedGame?.imageUrl;
    if (selectedUrl) {
      setPageContextSource(selectedUrl);
      return;
    }
    const snapshot = getBootSnapshot();
    const hero =
      snapshot?.library?.games?.find((g) => g.media?.backgroundPath)
      ?? snapshot?.library?.games?.find((g) => g.media?.landscapePath)
      ?? snapshot?.library?.games?.find((g) => g.media?.coverPath)
      ?? snapshot?.library?.games?.[0]
      ?? null;
    const heroPath = hero?.media?.backgroundPath ?? hero?.media?.landscapePath ?? hero?.media?.coverPath ?? null;
    if (
      heroPath &&
      !heroPath.startsWith("media/") &&
      !heroPath.startsWith("img/") &&
      !heroPath.startsWith("games/")
    ) {
      const url = isLocalPath(heroPath) ? (localPathToUrl(heroPath) ?? undefined) : heroPath;
      setPageContextSource(url ?? null);
    } else {
      setPageContextSource(null);
    }
  }, [activePage, selectedGame?.imageUrl]);

  return null;
}

function App() {
  countRender("App");
  const [activePage, setActivePage] = useState<AppPage>(restoreActivePage);
  const [bootStarted, setBootStarted] = useState(false);
  const [showModeSwitch, setShowModeSwitch] = useState(false);
  const [modeSwitchMode, setModeSwitchMode] = useState<ModeSwitchMode>("enter-console");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSectionLabel, setSettingsSectionLabel] = useState<string>("General");
  const modeSwitchKeyRef = useRef(0);
  const initialRender = useRef(true);
  const prevPageRef = useRef(activePage);
  const activePageRef = useRef(activePage);
  const { settings } = useSettings();
  const [showWizard, setShowWizard] = useState(() => {
    try {
      return localStorage.getItem("lumaforge-wizard-completed") !== "true";
    } catch {
      return true;
    }
  });

  // Start boot coordinator once on mount
  useEffect(() => {
    if (bootStarted) return;
    setBootStarted(true);
    runBootTasks();
  }, [bootStarted]);

  // Push to navigation history when Store sub-views are opened inline
  useEffect(() => {
    const handler = (e: Event) => {
      const tag = (e as CustomEvent).detail?.tag as string | undefined;
      pushToHistory("store", tag);
    };
    window.addEventListener("lumaforge-store-push-history", handler);
    return () => window.removeEventListener("lumaforge-store-push-history", handler);
  }, []);

  // Bootstrap extensions at app startup (built-in + repository)
  useEffect(() => {
    bootstrapExtensions().then((result) => {
      console.log(`[App] Extensions bootstrapped: ${result.registered} registered, ${result.skipped} skipped, ${result.errors.length} errors`);
    }).catch((err) => {
      console.error("[App] Extension bootstrap failed:", err);
    });
  }, []);

  // ── Auto-update: silent check on startup (respects disableAutoUpdates) ──
  useEffect(() => {
    if (settings.disableAutoUpdates) return;
    const timer = setTimeout(() => {
      checkForUpdate(true);
    }, 8000); // 8s delay — let boot finish and UI settle
    return () => clearTimeout(timer);
  }, [settings.disableAutoUpdates]);

  // ── Launch mode: read startup-config.json and override initial page ──
  useEffect(() => {
    readStartupConfig().then((cfg) => {
      const mode = cfg.launch_mode || "last-used";
      if (mode === "console") {
        console.log("[App] launchMode=console → navigating to Console Mode");
        setActivePage("console");
      } else if (mode === "desktop") {
        // Force home page — don't restore last-used
        const current = localStorage.getItem(ACTIVE_PAGE_KEY);
        if (current && current !== "home") {
          console.log(`[App] launchMode=desktop → overriding "${current}" → "home"`);
          setActivePage("home");
        }
      }
      // "last-used" → keep restoreActivePage() default (no-op)
    }).catch((err) => {
      console.warn("[App] Failed to read startup config for launch mode:", err);
    });
  }, []);

  // ── Tray icon event listeners (system tray menu actions) ──
  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    // "Open LumaForge" from tray → show + focus
    listen("lumaforge-tray-open", () => {
      console.log("[App] Tray: open requested");
    }).then((unlisten) => unlisteners.push(unlisten));

    // "Switch to Console/Desktop Mode" from tray — toggles between modes
    listen("lumaforge-tray-switch-mode", () => {
      const current = activePageRef.current;
      if (current === "console") {
        console.log("[App] Tray: switch to desktop mode");
        setAppFullscreen(false);
        setActivePage("home");
      } else {
        console.log("[App] Tray: switch to console mode");
        setAppFullscreen(true);
        setActivePage("console");
      }
    }).then((unlisten) => unlisteners.push(unlisten));

    // "Open recent game" from tray
    listen<{ app_id: string }>("lumaforge-tray-open-game", (event) => {
      const appId = event.payload?.app_id;
      if (appId) {
        console.log(`[App] Tray: open game appId=${appId}`);
        // Navigate to library-game-detail with this game
        const snapshot = getBootSnapshot();
        const game = snapshot?.library?.games?.find(
          (g: { appId?: string }) => g.appId === appId
        );
        if (game) {
          setActivePage("library-game-detail");
          // Dispatch to GameDetailsContext
          window.dispatchEvent(
            new CustomEvent("lumaforge-select-game", { detail: { game } })
          );
        }
      }
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => unlisteners.forEach((fn) => fn());
  }, []);

  // Init SQLite data change bus — listens for Rust-side data mutations
  useEffect(() => {
    const unlisten = initDataChangeBus();
    return () => unlisten?.();
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
    activePageRef.current = activePage;
    // Notify Rust tray menu to rebuild with correct switch-mode label
    try {
      import("@tauri-apps/api/event").then(({ emit }) => {
        emit("lumaforge-mode-changed", activePage === "console" ? "console" : "desktop");
      }).catch(() => {});
    } catch { /* ignore */ }
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

  function handleNavigate(page: AppPage, fromHistory = false) {
    // Settings opens as overlay — don't navigate
    if (page === "settings") {
      setSettingsOpen(true);
      return;
    }
    // When ← pressed and already on the target page (tagged sub-view), dispatch back event
    if (page === activePage && fromHistory) {
      window.dispatchEvent(new CustomEvent("lumaforge-store-detail-back"));
      return;
    }
    if (page === activePage) return;
    const startTime = NAV_PERF_ENABLED ? performance.now() : 0;

    // Phase 9: Mark navigation timestamp so services can defer background work
    markNavigation();

    // Push to navigation history only for normal navigation (not ← →)
    if (!fromHistory) {
      pushToHistory(page);
    }

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
      case "game-details":
        pageComponent = <GameDetailsPage onNavigate={handleNavigate} />;
        break;
      case "library-game-detail":
        pageComponent = <LibraryGameDetailPage onNavigate={handleNavigate} />;
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
      <DebridCompletionModal onNavigateToLibrary={() => handleNavigate("library")} />
      <AchievementWatcherInit />
      <GameDetailsProvider>
        {settings.gameSessionHudEnabled !== false && <GameSessionHUD onNavigate={handleNavigate} />}
        <AmbientNavFallback activePage={activePage} />
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
      <FixProgressListener />
      <GameToastViewport />
      <AchievementToastViewport />
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

      {/* First-run wizard — shows on fresh install */}
      {showWizard && (
        <FirstRunWizard
          onComplete={() => {
            try { localStorage.setItem("lumaforge-wizard-completed", "true"); } catch {}
            setShowWizard(false);
          }}
        />
      )}
      <LibraryLoadProgressCard />

      {/* Settings overlay — renders on top of everything */}
      <SettingsOverlay
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        activeSectionLabel={settingsSectionLabel}
      >
        <Settings onSectionChange={setSettingsSectionLabel} />
      </SettingsOverlay>
    </ConfirmProvider>
  );

}

export default App;