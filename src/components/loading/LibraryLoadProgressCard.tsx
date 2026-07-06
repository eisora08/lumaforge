import { useEffect, useRef, useState } from "react";
import { useLibraryProgress, reportLibraryProgress } from "../../services/libraryProgressService";
import { Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";

const SHOW_DELAY_MS = 500;
const DONE_VISIBLE_MS = 3000;

export default function LibraryLoadProgressCard() {
  const progress = useLibraryProgress();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (progress.phase === "idle") {
      setVisible(false);
      setDismissed(false);
      return;
    }

    if (progress.phase === "done" || progress.phase === "error") {
      if (progress.phase === "done") {
        setVisible(true);
        if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
        doneTimerRef.current = setTimeout(() => {
          setVisible(false);
          setDismissed(false);
        }, DONE_VISIBLE_MS);
      }
      return;
    }

    if (progress.active && !dismissed) {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      showTimerRef.current = setTimeout(() => {
        setVisible(true);
      }, SHOW_DELAY_MS);
    }

    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  }, [progress.phase, progress.active, dismissed]);

  if (!visible) return null;

  const isError = progress.phase === "error" || (progress.errors && progress.errors.length > 0);
  const isDone = progress.phase === "done";
  const showProgress = !isDone && !isError;
  const hasTotal = typeof progress.total === "number" && progress.total > 0;
  const determinate = typeof progress.percent === "number" || (hasTotal && typeof progress.current === "number");
  const barPercent = determinate
    ? typeof progress.percent === "number"
      ? Math.min(100, Math.max(0, progress.percent))
      : Math.min(100, Math.max(0, ((progress.current ?? 0) / (progress.total ?? 1)) * 100))
    : undefined;

  function handleDismiss() {
    setDismissed(true);
    setVisible(false);
  }

  function handleErrorDismiss() {
    setDismissed(true);
    setVisible(false);
    reportLibraryProgress({ phase: "idle", source: "unknown" });
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 motion-reduce:transition-none"
    >
      <div
        className={`
          w-[360px] max-w-[90vw] rounded-xl border bg-(--color-bg) px-4 py-3 shadow-lg backdrop-blur-sm
          motion-reduce:animate-none
          ${isError ? "border-red-500/40" : isDone ? "border-emerald-500/30" : "border-(--surface-active-border)"}
        `}
      >
        {/* header */}
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-(--color-text)">Loading library</span>
          {isError && (
            <button
              type="button"
              onClick={handleErrorDismiss}
              className="cursor-pointer rounded p-0.5 text-(--color-muted) hover:text-(--color-text)"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* message */}
        <p className="text-[11px] leading-relaxed text-(--color-muted)">
          {progress.message || "Loading library\u2026"}
        </p>

        {/* progress bar */}
        {showProgress && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-(--color-accent) transition-[width] duration-300 motion-reduce:transition-none"
              style={{
                width: determinate ? `${barPercent}%` : "40%",
                animation: determinate ? "none" : "indeterminate-pulse 1.4s ease-in-out infinite",
              }}
            />
          </div>
        )}

        {/* step indicator */}
        {showProgress && hasTotal && (
          <p className="mt-1 text-[10px] text-(--color-muted)">
            Step {progress.current ?? "?"} of {progress.total}
          </p>
        )}

        {/* error details */}
        {isError && progress.errors && progress.errors.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {progress.errors.map((err, i) => (
              <p key={i} className="truncate text-[10px] text-red-400">{err}</p>
            ))}
          </div>
        )}

        {/* success indicator */}
        {isDone && !isError && (
          <div className="mt-2 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[11px] text-emerald-400">
              {progress.message || "Library ready"}
            </span>
          </div>
        )}

        {/* error indicator */}
        {isError && (
          <div className="mt-2 flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[11px] text-amber-400">
              {progress.errors && progress.errors.length > 0
                ? `${progress.errors.length} warning${progress.errors.length > 1 ? "s" : ""}`
                : "Library loaded with warnings"}
            </span>
            {!isDone && (
              <button
                type="button"
                onClick={handleDismiss}
                className="ml-auto cursor-pointer rounded px-2 py-0.5 text-[10px] text-(--color-muted) hover:text-(--color-text)"
              >
                Dismiss
              </button>
            )}
          </div>
        )}

        {/* spinner for indeterminate progress without a bar */}
        {showProgress && !hasTotal && !determinate && (
          <div className="mt-2 flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin text-(--color-accent)" />
            <span className="text-[10px] text-(--color-muted)">Working{"\u2026"}</span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes indeterminate-pulse {
          0%, 100% { opacity: 0.4; transform: scaleX(1); }
          50% { opacity: 0.8; transform: scaleX(0.6); }
        }
      `}</style>
    </div>
  );
}
