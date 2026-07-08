import { Minus, Square, X } from "lucide-react";

type TauriWindow = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
};

export default function AppTitleBar() {
  async function exec(fn: (win: TauriWindow) => Promise<void>) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow() as unknown as TauriWindow;
      await fn(win);
    } catch {
      // noop outside Tauri
    }
  }

  const handleMinimize = () => exec((w) => w.minimize());
  const handleToggleMaximize = () => exec((w) => w.toggleMaximize());
  const handleClose = () => exec((w) => w.close());
  const handleDoubleClick = () => exec((w) => w.toggleMaximize());

  const iconIdle = "text-(--color-text)/60";
  const iconHover = "group-hover:text-(--color-text)";

  return (
    <div className="relative z-30 flex h-9 shrink-0 items-center border-b border-(--color-border) bg-(--color-surface) select-none">
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
          className="group flex w-[46px] items-center justify-center transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--color-accent)/60"
        >
          <Minus className={`h-4 w-4 ${iconIdle} ${iconHover}`} />
        </button>
        <button
          onClick={handleToggleMaximize}
          aria-label="Maximize window"
          className="group flex w-[46px] items-center justify-center transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--color-accent)/60"
        >
          <Square className={`h-3.5 w-3.5 ${iconIdle} ${iconHover}`} />
        </button>
        <button
          onClick={handleClose}
          aria-label="Close window"
          className="group flex w-[46px] items-center justify-center transition-colors hover:bg-red-500/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--color-accent)/60"
        >
          <X className={`h-4 w-4 ${iconIdle} group-hover:text-white`} />
        </button>
      </div>
    </div>
  );
}
