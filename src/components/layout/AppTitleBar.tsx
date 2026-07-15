import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Square, X } from "lucide-react";

const DEBUG_WINDOW_CONTROLS = false;

type TauriWindow = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (handler: (event: { payload: unknown }) => void) => (() => void);
};

export default function AppTitleBar() {
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

    async function init() {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow() as unknown as TauriWindow;
        if (!mountedRef.current) return;
        winRef.current = win;

        const maximized = await win.isMaximized();
        if (!mountedRef.current) return;
        isMaximizedRef.current = maximized;
        setIsMaximized(maximized);

        if (DEBUG_WINDOW_CONTROLS) {
          console.log(`[WINDOW_CONTROLS][STATE] isMaximized=${maximized} updateReason=mount`);
        }

        cleanupResize = win.onResized(() => {
          syncIsMaximized("resized");
        });
      } catch {
        // noop outside Tauri
      }
    }

    init();

    return () => {
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

  const iconIdle = "text-(--color-text)/60";
  const iconHover = "group-hover:text-(--color-text)";

  return (
    <div className="relative z-30 flex h-9 shrink-0 items-center border-b border-(--color-border) bg-(--shell-bg) select-none" style={{ backdropFilter: 'var(--shell-blur, none)', WebkitBackdropFilter: 'var(--shell-blur, none)' } as React.CSSProperties}>
      {/* draggable spacer — only this area has data-tauri-drag-region */}
      <div
        data-tauri-drag-region
        className="self-stretch flex-1"
        onDoubleClick={handleDoubleClick}
      />

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
    </div>
  );
}
