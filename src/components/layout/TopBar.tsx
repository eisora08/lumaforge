import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Bell, ChevronLeft, ChevronRight, Download, Flame, Minus, Monitor, Square, X } from "lucide-react";
import type { AppPage } from "../../types/navigation";
import { useSearch } from "../../context/SearchContext";
import { useGameDetails } from "../../context/GameDetailsContext";
import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import { subscribeHistory, getHistorySnapshot, goBack as historyGoBack, goForward as historyGoForward } from "../../services/navigationHistory";

import PackagesToolbarSearch from "../packages/PackagesToolbarSearch";
import type { StoreSearchDropdownItem } from "../packages/PackagesToolbar";
import PackageUpdatePanel from "../notifications/PackageUpdatePanel";
import DownloadsModal from "../downloads/DownloadsModal";

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
  storeTabs?: { id: StoreTabId; label: string }[];
  activeStoreTab?: StoreTabId;
  onStoreTabChange?: (tab: StoreTabId) => void;
};

export default function TopBar({ activePage, onNavigate, storeTabs, activeStoreTab, onStoreTabChange }: TopBarProps) {
  const { setQuery } = useSearch();
  const { selectGame } = useGameDetails();
  const showSearch = true;
  const [luaUpdateCount, setLuaUpdateCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
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
        isMaximizedRef.current = maximized;
        setIsMaximized(maximized);
        if (DEBUG_WINDOW_CONTROLS) {
          console.log(`[WINDOW_CONTROLS][STATE] isMaximized=${maximized} updateReason=${reason}`);
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
  const handleClose = useCallback(() => exec((w) => w.close(), "close"), [exec]);
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
      console.log("[NOTIFICATIONS][PANEL_CLOSE]");
    } else {
      const count = luaUpdateCount;
      console.log(`[NOTIFICATIONS][PANEL_OPEN] updates=${count}`);
    }
    setShowPanel((prev) => !prev);
  }

  function handlePanelClose() {
    setShowPanel(false);
  }

  const iconIdle = "text-(--color-text)/60";
  const iconHover = "group-hover:text-(--color-text)";

  return (
    <>
    <header className="sticky top-0 z-20 flex h-14 select-none items-stretch lf-surface border-b border-white/[0.06]" style={{ WebkitBackdropFilter: "var(--surface-active-blur)" } as React.CSSProperties}>
      {/* Logo — leftmost */}
      <button
        onClick={() => onNavigate?.("home")}
        className="flex shrink-0 items-center gap-2.5 pl-4 pr-2 transition hover:opacity-80 lg:pl-6"
        title="LumaForge — Inicio"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--color-accent)/10">
          <Flame className="h-4 w-4 text-(--color-accent)" />
        </div>
        <span className="hidden text-sm font-bold text-(--color-text) sm:inline">LumaForge</span>
      </button>

      {/* ← → Navigation */}
      <div className="flex items-center gap-0.5 pl-1">
        <button
          type="button"
          onClick={handleGoBack}
          disabled={!historySnapshot.canGoBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/8 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-(--color-muted)"
          title="Atras"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleGoForward}
          disabled={!historySnapshot.canGoForward}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/8 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-(--color-muted)"
          title="Adelante"
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
              {tab.label}
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
              placeholder="Search Steam games..."
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
          title={activePage === "console" ? "Desktop Mode" : "Console Mode"}
        >
          <Monitor className="h-4 w-4" />
        </button>

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
          title="Descargas"
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

      {/* window controls — sibling, NOT inside drag region */}
      <div className="flex h-full items-stretch">
        <button
          onClick={handleMinimize}
          aria-label="Minimize window"
          title="Minimize"
          className="group flex w-[46px] cursor-default items-center justify-center transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--color-accent)/60"
        >
          <Minus className={`h-4 w-4 ${iconIdle} ${iconHover}`} />
        </button>
        <button
          onClick={handleToggleMaximize}
          aria-label={isMaximized ? "Restore window" : "Maximize window"}
          title={isMaximized ? "Restore Down" : "Maximize"}
          className="group flex w-[46px] cursor-default items-center justify-center transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--color-accent)/60"
        >
          {isMaximized ? (
            <svg className={`h-3.5 w-3.5 ${iconIdle} ${iconHover}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="8" y="3" width="13" height="13" rx="2" />
              <path d="M3 8h13v13H8a2 2 0 0 1-2-2V8z" />
            </svg>
          ) : (
            <Square className={`h-3.5 w-3.5 ${iconIdle} ${iconHover}`} />
          )}
        </button>
        <button
          onClick={handleClose}
          aria-label="Close window"
          title="Close"
          className="group flex w-[46px] cursor-default items-center justify-center transition-colors hover:bg-red-500/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--color-accent)/60"
        >
          <X className={`h-4 w-4 ${iconIdle} group-hover:text-white`} />
        </button>
      </div>
    </header>

    <DownloadsModal
      open={downloadsOpen}
      onClose={() => setDownloadsOpen(false)}
      onNavigate={onNavigate}
    />
    </>
  );
}
