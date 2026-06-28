import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Square, AlertTriangle } from "lucide-react";

type Props = {
  open: boolean;
  gameTitle: string;
  canTerminate: boolean;
  isSteamSoftSession: boolean;
  onClose: () => void;
  onConfirmStop: () => void;
  onMarkStopped?: () => void;
};

export default function StopGameModal({
  open,
  gameTitle,
  canTerminate,
  isSteamSoftSession,
  onClose,
  onConfirmStop,
  onMarkStopped,
}: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.debug("[StopModal] render", { open, gameTitle, canTerminate, isSteamSoftSession });
  }, [open, gameTitle, canTerminate, isSteamSoftSession]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  if (!open) return null;

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70"
    >
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-[#101014] p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <h2 className="text-lg font-bold text-white">Stop game?</h2>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-white/70">
          Are you sure you want to close <span className="font-medium text-white">{gameTitle}</span>?
          Unsaved progress may be lost.
        </p>

        {isSteamSoftSession && !canTerminate && (
          <p className="mt-2 text-xs leading-relaxed text-amber-400/80">
            LumaForge cannot safely close this Steam game yet because no process ID is being tracked.
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Cancel
          </button>
          {canTerminate && (
            <button
              type="button"
              onClick={() => {
                console.debug("[StopModal] confirm", { gameTitle });
                onConfirmStop();
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-500/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-red-500/50"
            >
              <Square className="h-4 w-4" />
              Stop Game
            </button>
          )}
          {isSteamSoftSession && !canTerminate && onMarkStopped && (
            <button
              type="button"
              onClick={() => {
                console.debug("[StopModal] markStopped", { gameTitle });
                onMarkStopped();
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Mark as Stopped
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
