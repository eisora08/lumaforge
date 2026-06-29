import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Square, AlertTriangle, Loader2, Search } from "lucide-react";

type Props = {
  open: boolean;
  gameTitle: string;
  canTerminate: boolean;
  isSoftSession: boolean;
  trackingConfidence?: string;
  onClose: () => void;
  onConfirmStop: () => void;
  onMarkStopped?: () => void;
  onFindProcess?: () => Promise<void>;
};

export default function StopGameModal({
  open,
  gameTitle,
  canTerminate,
  isSoftSession,
  trackingConfidence,
  onClose,
  onConfirmStop,
  onMarkStopped,
  onFindProcess,
}: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const [findingProcess, setFindingProcess] = useState(false);

  const ENABLE_VERBOSE_MODAL_LOGS = false;

  if (ENABLE_VERBOSE_MODAL_LOGS) {
    console.debug("[StopModal] render", { open, gameTitle });
  }

  useEffect(() => {
    if (ENABLE_VERBOSE_MODAL_LOGS) {
      console.debug("[StopModal] props changed", { open, gameTitle, canTerminate, isSoftSession, trackingConfidence });
    }
  }, [open, gameTitle, canTerminate, isSoftSession, trackingConfidence]);

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

  async function handleFindProcess() {
    if (!onFindProcess) return;
    setFindingProcess(true);
    try {
      await onFindProcess();
    } finally {
      setFindingProcess(false);
    }
  }

  if (!open) return null;

  const showTerminate = canTerminate && trackingConfidence && trackingConfidence !== "none" && trackingConfidence !== "low";
  const showMarkStopped = isSoftSession || !canTerminate;
  const showFindProcess = isSoftSession && !canTerminate && onFindProcess && !showTerminate;

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 lf-modal-overlay"
    >
      <div className="lf-modal-panel mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-[#101014] p-6 shadow-2xl">
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

        {!showTerminate && (
          <p className="mt-2 text-xs leading-relaxed text-amber-400/80">
            LumaForge is tracking this game as running, but no safe process ID is available.
            {showFindProcess && " Try \"Find Running Process\" to locate the game process."}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              console.debug("[StopModal] cancel clicked");
              onClose();
            }}
            className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Cancel
          </button>

          {showFindProcess && (
            <button
              type="button"
              onClick={handleFindProcess}
              disabled={findingProcess}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-50"
            >
              {findingProcess ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Find Running Process
            </button>
          )}

          {showTerminate && (
            <button
              type="button"
              onClick={() => {
                console.debug("[StopModal] stop game clicked", { gameTitle, confidence: trackingConfidence });
                onConfirmStop();
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-500/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-red-500/50"
            >
              <Square className="h-4 w-4" />
              Stop Game
            </button>
          )}

          {showMarkStopped && onMarkStopped && !showTerminate && (
            <button
              type="button"
              onClick={() => {
                console.debug("[StopModal] mark stopped clicked", { gameTitle });
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
