import { X } from "lucide-react";

type FilterDrawerProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  onReset: () => void;
  children: React.ReactNode;
};

export default function FilterDrawer({
  open,
  title,
  onClose,
  onReset,
  children,
}: FilterDrawerProps) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed right-0 top-0 z-50 h-full w-80 border-l border-(--surface-active-border) bg-black/95 backdrop-blur-xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-(--surface-active-border) px-5 py-4">
            <h2 className="text-sm font-bold text-(--color-text)">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {children}
          </div>

          <div className="shrink-0 border-t border-(--surface-active-border) px-5 py-4">
            <button
              type="button"
              onClick={onReset}
              className="w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
