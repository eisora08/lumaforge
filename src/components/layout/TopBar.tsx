import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Gamepad2, Menu, Minus, Monitor, Square, X } from "lucide-react";
import type { AppPage } from "../../types/navigation";
import { useSearch } from "../../context/SearchContext";
import { useGameDetails } from "../../context/GameDetailsContext";

import PackagesToolbarSearch from "../packages/PackagesToolbarSearch";
import type { StoreSearchDropdownItem } from "../packages/PackagesToolbar";
import PackageUpdatePanel from "../notifications/PackageUpdatePanel";

const DEBUG_WINDOW_CONTROLS = false;

type TauriWindow = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (handler: (event: { payload: unknown }) => void) => Promise<() => void>;
};

type TopBarProps = {
  onOpenSidebar: () => void;
  activePage: AppPage;
  onNavigate?: (page: AppPage) => void;
  sidebarDrawerMode?: boolean;
};

export default function TopBar({ onOpenSidebar, activePage, onNavigate, sidebarDrawerMode }: TopBarProps) {
  const { setQuery } = useSearch();
  const { selectGame } = useGameDetails();
  const showSearch = activePage !== "store";
  const [luaUpdateCount, setLuaUpdateCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);

  const [isMaximized, setIsMaximized] = useState(false);
  const mountedRef = useRef(true);
  const winRef = useRef<TauriWindow | null>(null);
  const isMaximizedRef = useRef(false);

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

  function handleSelectItem(item: StoreSearchDropdownItem) {
    setQuery(item.title);
    selectGame({
      appId: item.appId,
      title: item.title,
      imageUrl: item.imageUrl,
    });
    onNavigate?.("game-details");
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
    <header className="sticky top-0 z-20 flex h-14 select-none items-stretch bg-(--shell-bg)" style={{ backdropFilter: 'var(--shell-blur, none)', WebkitBackdropFilter: 'var(--shell-blur, none)' } as React.CSSProperties}>
      <div className="flex items-center gap-3 px-4 lg:px-6">
        {sidebarDrawerMode && (
          <button
            onClick={onOpenSidebar}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-(--color-text) hover:bg-white/8"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}

        {showSearch && (
          <PackagesToolbarSearch
            variant="topbar"
            placeholder="Search Steam games..."
            onSelectItem={handleSelectItem}
            onSubmit={handleSubmit}
            onViewAll={handleViewAll}
          />
        )}
      </div>

      {/* draggable spacer — only this area has data-tauri-drag-region */}
      <div
        data-tauri-drag-region
        className="self-stretch flex-1"
        onDoubleClick={handleDoubleClick}
      />

      <div className="flex items-center gap-2 pr-2">
        <button
          onClick={() => onNavigate?.(activePage === "console" ? "home" : "console")}
          className="hidden h-9 items-center gap-2 rounded-xl border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 text-sm text-(--color-accent) transition hover:bg-(--color-accent)/15 sm:inline-flex"
        >
          {activePage === "console" ? (
            <Monitor className="h-3.5 w-3.5" />
          ) : (
            <Gamepad2 className="h-3.5 w-3.5" />
          )}
          {activePage === "console" ? "Desktop Mode" : "Console Mode"}
        </button>

        <div className="relative">
          <button
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
            <PackageUpdatePanel onClose={handlePanelClose} onNavigate={onNavigate ?? (() => {})} />
          )}
        </div>
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
  );
}
