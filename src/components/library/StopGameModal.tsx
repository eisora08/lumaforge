import { useEffect, useRef } from "react";
import { Square, AlertTriangle } from "lucide-react";

type Props = {
  gameTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function StopGameModal({ gameTitle, onConfirm, onCancel }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onCancel();
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-(--surface-active-border) bg-(--surface-primary) p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <h2 className="text-lg font-bold text-(--color-text)">Stop game?</h2>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-(--color-muted)">
          Are you sure you want to close <span className="font-medium text-(--color-text)">{gameTitle}</span>?
          Unsaved progress may be lost.
        </p>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm font-medium text-(--color-text) transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-500/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-red-500/50"
          >
            <Square className="h-4 w-4" />
            Stop Game
          </button>
        </div>
      </div>
    </div>
  );
}
