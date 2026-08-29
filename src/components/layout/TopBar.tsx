import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Bell, ChevronLeft, ChevronRight, Download, Minus, Monitor, Square, X } from "lucide-react";
import type { AppPage } from "../../types/navigation";
import { useSearch } from "../../context/SearchContext";
import { useGameDetails } from "../../context/GameDetailsContext";
import { useSettings } from "../../context/SettingsContext";
import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import { subscribeHistory, getHistorySnapshot, goBack as historyGoBack, goForward as historyGoForward } from "../../services/navigationHistory";

import PackagesToolbarSearch from "../packages/PackagesToolbarSearch";
import type { StoreSearchDropdownItem } from "../packages/PackagesToolbar";
import PackageUpdatePanel from "../notifications/PackageUpdatePanel";
import DownloadsModal from "../downloads/DownloadsModal";
import AppUpdateIcon from "../updates/AppUpdateIcon";
import ConfirmModal from "../common/ConfirmModal";

const DEBUG_WINDOW_CONTROLS = false;

type TauriWindow = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (handler: (event: { payload: unknown }) => void) => Promise<() => void>;
};

export type StoreTabId = "discover" | "browse" | "repacks";

type TopBarProps = {
  activePage: AppPage;
  onNavigate?: (page: AppPage, fromHistory?: boolean) => void;
  // Store tabs — only rendered when activePage === "store"
  storeTabs?: { id: StoreTabId; label: string; labelKey?: string }[];
  activeStoreTab?: StoreTabId;
  onStoreTabChange?: (tab: StoreTabId) => void;
};

export default function TopBar({ activePage, onNavigate, storeTabs, activeStoreTab, onStoreTabChange }: TopBarProps) {
  const { t } = useTranslation();
  const { setQuery } = useSearch();
  const { selectGame } = useGameDetails();
  const { settings } = useSettings();
  const showSearch = true;
  const [luaUpdateCount, setLuaUpdateCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const bellButtonRef = useRef<HTMLButtonElement>(null);
  const { jobs } = useDownloadQueue();

  // Navigation history
  const historySnapshot = useSyncExternalStore(subscribeHistory, getHistorySnapshot, getHistorySnapshot);

  const handleGoBack = useCallback(() => {
    const entry = historyGoBack();
    if (!entry || !onNavigate) return;
    if (entry.tag && entry.page === activePage) {
      // Same page, sub-view: dispatch back event for the page to handle
      window.dispatchEvent(new CustomEvent("lumaforge-store-detail-back"));
    } else {
      onNavigate(entry.page, true);
    }
  }, [onNavigate, activePage]);

  const handleGoForward = useCallback(() => {
    const entry = historyGoForward();
    if (!entry || !onNavigate) return;
    if (entry.tag && entry.page === activePage) {
      window.dispatchEvent(new CustomEvent("lumaforge-store-forward", { detail: { tag: entry.tag } }));
    } else {
      onNavigate(entry.page, true);
    }
  }, [onNavigate, activePage]);

  const activeDownloadCount = useMemo(() => jobs.filter((j) =>
    ["queued", "waiting", "checking", "downloading", "extracting", "installing", "paused"].includes(j.status),
  ).length, [jobs]);

  const downloadProgress = useMemo(() => {
    const first = jobs.find((j) =>
      ["downloading", "extracting", "installing"].includes(j.status) && j.totalBytes && j.totalBytes > 0,
    );
    if (!first) return null;
    return Math.min(1, (first.bytesRead ?? 0) / first.totalBytes!);
  }, [jobs]);

  const [isMaximized, setIsMaximized] = useState(false);
  const mountedRef = useRef(true);
  const winRef = useRef<TauriWindow | null>(null);
  const isMaximizedRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Cmd+K / Ctrl+K → focus search input
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (showSearch) {
          // Focus the search input inside PackagesToolbarSearch
          const input = searchInputRef.current;
          if (input) {
            input.focus();
            input.select();
          }
        } else {
          // On Store page — navigate to home first, then focus
          onNavigate?.("home");
        }
      }
    }
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [showSearch, onNavigate]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const syncIsMaximized = useCallback(async (reason: string) => {
    try {
      const win = winRef.current;
      if (!win) return;
      const maximized = await win.isMaximized();
      if (!mountedRef.current) return;
      if (maximized !== isMaximizedRef.current) {
        const wasMaximized = isMaximizedRef.current;
        isMaximizedRef.current = maximized;
        setIsMaximized(maximized);
        if (DEBUG_WINDOW_CONTROLS) {
          console.log(`[WINDOW_CONTROLS][STATE] isMaximized=${maximized} updateReason=${reason}`);
        }
        // Re-apply proportional size when unmaximizing
        // The window-state plugin's internal "normal rect" is stale (captures
        // initial 1280x800 at init), so unmaximize restores wrong size.
        if (wasMaximized && !maximized) {
          try {
            const { getCurrentWindow, primaryMonitor } = await import("@tauri-apps/api/window");
            const { LogicalSize } = await import("@tauri-apps/api/dpi");
            const monitor = await primaryMonitor();
            if (monitor) {
              const scale = monitor.scaleFactor;
              const phys = monitor.size;
              const logicalW = phys.width / scale;
              const logicalH = phys.height / scale;
              const tauriWin = getCurrentWindow();
              await tauriWin.setSize(new LogicalSize(Math.round(logicalW * 0.55), Math.round(logicalH * 0.75)));
              await tauriWin.center();
            }
          } catch {
            // noop — best effort
          }
        }
      }
    } catch (err) {
      if (DEBUG_WINDOW_CONTROLS) {
        console.log(`[WINDOW_CONTROLS][ACTION] action=syncState error=${err}`);
      }
    }
  }, []);

  useEffect(() => {
    let cleanupResize: (() => void) | undefined;
    let disposed = false;

    async function init() {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow() as unknown as TauriWindow;
        if (disposed) return;
        winRef.current = win;

        const maximized = await win.isMaximized();
        if (disposed) return;
        isMaximizedRef.current = maximized;
        setIsMaximized(maximized);

        if (DEBUG_WINDOW_CONTROLS) {
          console.log(`[WINDOW_CONTROLS][STATE] isMaximized=${maximized} updateReason=mount`);
        }

        cleanupResize = await win.onResized(() => {
          syncIsMaximized("resized");
        });
      } catch {
        // noop outside Tauri
      }
    }

    init();

    return () => {
      disposed = true;
      cleanupResize?.();
    };
  }, []);

  const exec = useCallback(async (fn: (win: TauriWindow) => Promise<void>, action: string) => {
    try {
      const win = winRef.current;
      if (!win) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow() as unknown as TauriWindow;
        winRef.current = w;
        const stateBefore = await w.isMaximized();
        await fn(w);
        const stateAfter = await w.isMaximized();
        if (mountedRef.current) setIsMaximized(stateAfter);
        if (DEBUG_WINDOW_CONTROLS) {
          console.log(`[WINDOW_CONTROLS][ACTION] action=${action} stateBefore=${stateBefore} stateAfter=${stateAfter}`);
        }
        return;
      }
      const stateBefore = await win.isMaximized();
      await fn(win);
      const stateAfter = await win.isMaximized();
      if (mountedRef.current) setIsMaximized(stateAfter);
      if (DEBUG_WINDOW_CONTROLS) {
        console.log(`[WINDOW_CONTROLS][ACTION] action=${action} stateBefore=${stateBefore} stateAfter=${stateAfter}`);
      }
    } catch (err) {
      if (DEBUG_WINDOW_CONTROLS) {
        console.log(`[WINDOW_CONTROLS][ACTION] action=${action} error=${err}`);
      }
    }
  }, []);

  const handleMinimize = useCallback(() => exec((w) => w.minimize(), "minimize"), [exec]);
  const handleToggleMaximize = useCallback(() => exec((w) => w.toggleMaximize(), "toggleMaximize"), [exec]);
  const handleClose = useCallback(() => {
    if (settings.closeToTray) {
      setShowCloseConfirm(true);
    } else {
      exec((w) => w.close(), "close");
    }
  }, [exec, settings.closeToTray]);
  const handleDoubleClick = useCallback(() => exec((w) => w.toggleMaximize(), "doubleClickToggle"), [exec]);

  useEffect(() => {
    let cancelled = false;
    import("../../services/installedLuaScanner").then((mod) => {
      if (cancelled) return;
      setLuaUpdateCount(mod.getUpdateCount());
      const unsub = mod.subscribeUpdateStatus(() => {
        if (!cancelled) setLuaUpdateCount(mod.getUpdateCount());
      });
      return unsub;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Listen for custom event from QuickActionsCompact to open downloads modal
  useEffect(() => {
    const handler = () => setDownloadsOpen(true);
    window.addEventListener("lumaforge-open-downloads", handler);
    return () => window.removeEventListener("lumaforge-open-downloads", handler);
  }, []);

  function handleSelectItem(item: StoreSearchDropdownItem) {
    selectGame({
      appId: item.appId,
      title: item.title,
      imageUrl: item.imageUrl,
    });
    onNavigate?.("store");
    setQuery("");
  }

  function handleSubmit(query: string) {
    setQuery(query);
    onNavigate?.("global-search");
  }

  function handleViewAll(query: string) {
    setQuery(query);
    onNavigate?.("global-search");
  }

  function handleBellClick() {
    if (showPanel) {
      if (DEBUG_WINDOW_CONTROLS) console.log("[NOTIFICATIONS][PANEL_CLOSE]");
    } else {
      const count = luaUpdateCount;
      if (DEBUG_WINDOW_CONTROLS) console.log(`[NOTIFICATIONS][PANEL_OPEN] updates=${count}`);
    }
    setShowPanel((prev) => !prev);
  }

  function handlePanelClose() {
    setShowPanel(false);
  }

  return (
    <>
    <header className="absolute top-0 left-0 right-0 z-20 flex h-14 select-none items-stretch border-b border-white/[0.06]" style={{ background: "var(--surface-active)", backdropFilter: "var(--surface-active-blur)", WebkitBackdropFilter: "var(--surface-active-blur)" } as React.CSSProperties}>
      {/* Logo — leftmost */}
      <button
        onClick={() => onNavigate?.("home")}
        className="flex shrink-0 items-center gap-3 pl-3 pr-2 transition hover:opacity-80 lg:pl-5"
        title="LumaForge — Inicio"
      >
        <svg width="32" height="32" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" className="block flex-shrink-0">
          {/* Thunder */}
          <path fill="#19b5ff" d="m 553.57868,345.61285 c 10.74538,-0.21775 89.94629,-3.15317 89.59078,-3.90113 -38.09597,14.37381 -63.63735,45.05481 -78.73219,70.69281 -12.70395,21.57712 -46.09097,66.96911 -48.06045,97.729 41.00076,-2.17598 39.30564,-6.71511 120.16457,-8.55243 l -253.80472,182.59603 162.25929,-143.80071 -96.24559,6.09459 c 36.34926,-66.9527 78.85906,-133.90542 104.82831,-200.85812 z" />
          {/* DPad */}
          <path fill="#f2f2f2" d="m 303.2454,444.20636 v 45.11247 h -50.02669 v 36.50537 h 50.02669 v 45.11255 h 40.48207 V 525.8242 h 50.02669 v -36.50537 h -50.02669 v -45.11247 z" />
          {/* Buttons */}
          <path fill="#f2f2f2" d="m 718.4919,436.46506 a 25.232653,24.988824 0 0 0 -25.23231,24.98903 25.232653,24.988824 0 0 0 25.23231,24.98903 25.232653,24.988824 0 0 0 25.23231,-24.98903 25.232653,24.988824 0 0 0 -25.23231,-24.98903 z m -48.76711,45.89348 a 25.232653,24.988824 0 0 0 -25.23231,24.98901 25.232653,24.988824 0 0 0 25.23231,24.98807 25.232653,24.988824 0 0 0 25.23342,-24.98807 25.232653,24.988824 0 0 0 -25.23342,-24.98901 z m 94.8654,0.23982 a 25.232653,24.988824 0 0 0 -25.23237,24.98904 25.232653,24.988824 0 0 0 25.23237,24.98897 25.232653,24.988824 0 0 0 25.23225,-24.98897 25.232653,24.988824 0 0 0 -25.23225,-24.98904 z m -47.06843,47.09448 a 25.232653,24.988824 0 0 0 -25.23342,24.98904 25.232653,24.988824 0 0 0 25.23342,24.98896 25.232653,24.988824 0 0 0 25.23225,-24.98896 25.232653,24.988824 0 0 0 -25.23225,-24.98904 z" />
          {/* WolfRight body */}
          <path fill="#66738f" d="m 406.89622,1002 h 10e-4 c -5.9e-4,10e-5 -10e-4,-10e-5 -0.002,0 z m 10e-4,0 c 69.23144,-11.78239 134.91499,-32.38944 195.6029,-65.42402 60.90445,29.29119 134.52505,11.86458 191.12333,-2.89342 -26.82462,-9.22505 -57.01716,-15.92933 -71.82905,-34.14399 84.43206,-1.39996 195.53809,-69.91846 250.58606,-116.10662 -35.52259,6.11474 -117.85268,49.634 -160.07163,35.76303 35.86297,-4.78879 64.30087,-41.59006 86.41247,-66.13923 73.67516,-81.00235 126.9537,-238.58305 102.089,-312.43695 -0.89012,-2.64377 -23.46967,96.57054 -39.86201,102.00752 C 1035.0475,194.29357 686.86827,40.46888 592.49151,57.421977 c -19.445,28.396257 -37.97575,56.884093 -50.76103,88.628893 27.05636,93.96514 -8.50361,75.56178 -8.8011,152.57975 l -23.87496,29.06646 5.41713,85.7491 c 4.02357,-59.98408 26.10609,-109.7678 55.81443,-161.2399 14.42629,-25.36927 112.60371,4.40574 102.2275,15.5952 -26.02937,28.06924 -29.83207,43.21155 -18.72568,33.53607 10.38684,-9.04866 49.95823,-15.54563 41.36645,-9.10471 -16.13093,12.09257 -66.28286,56.11956 -52.21804,48.98652 87.61277,-44.43359 175.461,54.66841 187.27746,118.0889 28.51641,153.05208 -113.90143,216.75688 -181.91113,217.04905 l 47.50864,35.06756 C 668.66025,697.43496 629.67575,682.83141 617.7185,657.9323 597.02298,616.13888 565.28328,574.73009 508.72653,606.17112 l 5.70918,90.37068 -23.87492,29.06644 c -0.29752,77.01791 -35.85742,58.61464 -8.80114,152.5797 -18.0395,44.79069 -47.51618,83.09744 -74.86227,123.81096 z" />
          {/* WolfRight eye outline */}
          <path fill="#000" d="m 548.76472,689.89898 -12.70041,46.47721 42.63628,63.29363 -4.8673,-29.56463 8.2823,-35.47514 z" />
          {/* WolfRight eye */}
          <path fill="#00b7ff" d="m 553.0432,715.02463 -6.80501,19.01062 19.40206,31.00112 5.63083,-28.70962 z" />
          {/* WolfRight ear */}
          <path fill="#536079" d="m 636.57363,854.77397 c -26.99267,4.23244 -55.38151,9.62627 -77.57483,-3.42902 l 3.69744,28.61035 -28.88157,-39.98368 c -6.59005,52.0641 -42.68864,89.91939 -72.78688,124.88837 63.61386,-26.41477 125.87764,-54.84853 175.54584,-110.08602 z" />
          {/* WolfLeft body */}
          <path fill="#e5e5e5" d="m 617.10358,21.999997 v 0.0012 c 0,-1.33e-4 0,1.39e-4 0,1.2e-5 z m 0,0.0012 C 547.87104,33.783259 482.18746,54.390278 421.49951,87.4249 360.59511,58.133701 286.97445,75.560276 230.37621,90.31824 c 26.82477,9.225049 57.01735,15.92938 71.82927,34.14407 -84.43205,1.39997 -195.53813,69.91845 -250.58613,116.10659 35.522623,-6.11477 117.85264,-49.63403 160.07161,-35.76304 -35.86295,4.7888 -64.30085,41.59003 -86.4124,66.13926 C 51.603532,351.9475 -1.6749694,509.52817 23.189686,583.38208 24.079788,586.02589 46.659382,486.81149 63.051704,481.37456 -11.047707,829.7062 337.1315,983.53096 431.50829,966.57785 c 19.44531,-28.39606 37.97574,-56.88406 50.76102,-88.62888 -27.05628,-93.96512 8.50364,-75.56174 8.80116,-152.57976 l 23.87498,-29.06644 -5.4172,-85.7491 c -4.02351,59.98418 -26.10611,109.76788 -55.81446,161.24001 -14.42629,25.36925 -112.6037,-4.40573 -102.22744,-15.59519 26.02929,-28.06925 29.83206,-43.21159 18.72565,-33.53606 -10.38684,9.0487 -49.95821,15.54558 -41.36638,9.10473 16.13088,-12.09257 66.28281,-56.11961 52.21801,-48.98658 C 293.45083,727.21422 205.6026,628.11222 193.78616,564.69173 165.26973,411.6396 307.68761,347.93488 375.69727,347.64271 l -47.50859,-35.0676 c 27.15088,13.98989 66.13537,28.59347 78.09266,53.49259 20.6955,41.79337 52.43519,83.20215 108.99193,51.7612 l -5.70918,-90.37072 23.87489,-29.06646 c 0.29755,-77.01795 35.85752,-58.6146 8.80117,-152.57969 18.03956,-44.79069 47.51618,-83.09749 74.86226,-123.81101 z" />
          {/* WolfLeft eye outline */}
          <path fill="#000" d="m 474.67907,331.52556 12.70044,-46.47717 -42.63624,-63.29368 4.86725,29.56465 -8.28232,35.47511 z" />
          {/* WolfLeft eye */}
          <path fill="#00b7ff" d="m 470.40058,306.3999 6.80507,-19.01059 -19.40207,-31.00112 -5.63085,28.70964 z" />
          {/* WolfLeft ear */}
          <path fill="#d2d2d2" d="m 386.87019,166.65058 c 26.99266,-4.23249 55.38152,-9.62629 77.57482,3.42902 l -3.69746,-28.61033 28.88159,39.98364 c 6.59005,-52.06407 42.68867,-89.919418 72.78695,-124.88839 -63.61386,26.414796 -125.87769,54.84856 -175.5459,110.08606 z" />
        </svg>
        <span className="hidden text-sm font-bold text-(--color-text) sm:inline">LumaForge</span>
      </button>

      {/* ← → Navigation */}
      <div className="flex items-center gap-0.5 pl-1">
        <button
          type="button"
          onClick={handleGoBack}
          disabled={!historySnapshot.canGoBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/8 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-(--color-muted)"
          title={t("topbar.back")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleGoForward}
          disabled={!historySnapshot.canGoForward}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/8 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-(--color-muted)"
          title={t("topbar.forward")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* left draggable stretch */}
      <div
        data-tauri-drag-region
        className="self-stretch flex-1"
        onDoubleClick={handleDoubleClick}
      />

      {/* Store tabs — after drag, before search */}
      {activePage === "store" && storeTabs && onStoreTabChange && (
        <div className="flex items-center gap-1">
          {storeTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onStoreTabChange(tab.id)}
              className={`relative cursor-pointer px-3 py-1.5 text-sm transition duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97] ${
                activeStoreTab === tab.id
                  ? "font-bold text-(--color-text)"
                  : "font-medium text-(--color-muted) hover:text-(--color-text)"
              }`}
            >
              {tab.labelKey ? t(tab.labelKey, tab.label) : tab.label}
              {activeStoreTab === tab.id && (
                <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-(--color-accent)" />
              )}
            </button>
          ))}
        </div>
      )}

      {showSearch && (
        <div className="flex min-w-0 flex-1 items-center justify-center px-2">
          <div className="w-full max-w-[540px]">
            <PackagesToolbarSearch
              variant="topbar"
              placeholder={t("topbar.search_placeholder")}
              inputRef={searchInputRef}
              onSelectItem={handleSelectItem}
              onSubmit={handleSubmit}
              onViewAll={handleViewAll}
            />
          </div>
        </div>
      )}

      {/* right draggable stretch */}
      <div
        data-tauri-drag-region
        className="self-stretch flex-1"
        onDoubleClick={handleDoubleClick}
      />

      <div className="flex items-center gap-2 pr-2">
        <button
          onClick={() => onNavigate?.(activePage === "console" ? "home" : "console")}
          className="hidden h-9 w-9 items-center justify-center rounded-xl border border-(--color-accent)/20 bg-(--color-accent)/10 text-(--color-accent) transition hover:bg-(--color-accent)/15 sm:inline-flex"
          title={activePage === "console" ? t("topbar.desktop_mode") : t("topbar.console_mode")}
        >
          <Monitor className="h-4 w-4" />
        </button>

        <AppUpdateIcon />

        <div className="relative">
          <button
            ref={bellButtonRef}
            onClick={handleBellClick}
            className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 transition hover:bg-white/8"
          >
            <Bell className="h-4 w-4 text-(--color-muted)" />
            {luaUpdateCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-medium leading-tight text-white">
                {luaUpdateCount > 9 ? "9+" : luaUpdateCount}
              </span>
            )}
          </button>

          {showPanel && (
            <PackageUpdatePanel onClose={handlePanelClose} onNavigate={onNavigate ?? (() => {})} anchorRef={bellButtonRef} />
          )}
        </div>

        {/* Downloads icon with progress ring */}
        <button
          onClick={() => setDownloadsOpen(true)}
          className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 transition hover:bg-white/8"
          title={t("topbar.downloads")}
        >
          <Download className="h-4 w-4 text-(--color-muted)" />
          {downloadProgress !== null && (
            <svg
              className="absolute inset-0 h-9 w-9 -rotate-90"
              viewBox="0 0 36 36"
            >
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-white/10"
              />
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={`${downloadProgress * 94.25} 94.25`}
                className="text-(--color-accent) transition-[stroke-dasharray] duration-300"
              />
            </svg>
          )}
          {activeDownloadCount > 1 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-(--color-accent) px-1 text-[10px] font-medium leading-tight text-(--color-accent-text)">
              {activeDownloadCount}
            </span>
          )}
        </button>
      </div>

      {/* window controls — compact premium */}
      <div className="flex h-full items-center gap-1 pr-1.5">
        <button
          onClick={handleMinimize}
          aria-label={t("topbar.minimize")}
          title={t("topbar.minimize")}
          className="flex h-[32px] w-[40px] cursor-default items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
        >
          <Minus className="h-3.5 w-3.5 text-(--color-text)/60" />
        </button>
        <button
          onClick={handleToggleMaximize}
          aria-label={isMaximized ? t("topbar.restore") : t("topbar.maximize")}
          title={isMaximized ? t("topbar.restore") : t("topbar.maximize")}
          className="flex h-[32px] w-[40px] cursor-default items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
        >
          {isMaximized ? (
            <svg className="h-3.5 w-3.5 text-(--color-text)/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="8" y="3" width="13" height="13" rx="2" />
              <path d="M3 8h13v13H8a2 2 0 0 1-2-2V8z" />
            </svg>
          ) : (
            <Square className="h-3.5 w-3.5 text-(--color-text)/60" />
          )}
        </button>
        <button
          onClick={handleClose}
          aria-label={t("topbar.close")}
          title={t("topbar.close")}
          className="flex h-[32px] w-[40px] cursor-default items-center justify-center rounded-lg transition-colors hover:bg-red-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
        >
          <X className="h-3.5 w-3.5 text-(--color-text)/60 group-hover:text-white" />
        </button>
      </div>
    </header>

    <DownloadsModal
      open={downloadsOpen}
      onClose={() => setDownloadsOpen(false)}
      onNavigate={onNavigate}
    />

    <ConfirmModal
      open={showCloseConfirm}
      title={t("close_confirm.title")}
      description={t("close_confirm.description")}
      variant="warning"
      cancelLabel={t("close_confirm.cancel")}
      onCancel={() => setShowCloseConfirm(false)}
      secondaryLabel={t("close_confirm.close")}
      onSecondary={() => {
        setShowCloseConfirm(false);
        import("@tauri-apps/api/event").then(({ emit }) => {
          emit("lumaforge-quit");
        }).catch(() => {});
      }}
      secondaryVariant="danger"
      tertiaryLabel={t("close_confirm.minimize")}
      onTertiary={() => {
        setShowCloseConfirm(false);
        exec((w) => w.close(), "close");
      }}
      tertiaryVariant="warning"
      centerActions
      compact
    />
    </>
  );
}
