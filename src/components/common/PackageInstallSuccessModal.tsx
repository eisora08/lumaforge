import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Library, ArrowRight, X } from "lucide-react";

const DEBUG_PACKAGE_COMPLETION_UI = false;

const CONSUMED_KEYS = new Set([
  "Enter", " ", "Escape",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
]);

const ACTIVATION_LOCK_MS = 300;
const OPEN_GUARD_MS = 250;

/* ─── Deduplication ────────────────────────────────────────────── */
const _consumedJobKeys = new Set<string>();

function dedupeKey(jobId: string | undefined, appId: string): string {
  return `${appId}:${jobId ?? "no-job"}`;
}

function isAlreadyConsumed(key: string): boolean {
  return _consumedJobKeys.has(key);
}

function markConsumed(key: string): void {
  _consumedJobKeys.add(key);
  if (_consumedJobKeys.size > 200) {
    const first = _consumedJobKeys.values().next().value;
    if (first) _consumedJobKeys.delete(first);
  }
}

export function resetCompletionDedup(): void {
  _consumedJobKeys.clear();
}

/* ─── Props ────────────────────────────────────────────────────── */
type Props = {
  open: boolean;
  gameTitle: string;
  appId: string;
  jobId?: string;
  imageUrl?: string;
  providerName?: string;
  /** Override the primary button label (default: "View in Library") */
  primaryButtonLabel?: string;
  onViewInLibrary: () => void;
  onContinueBrowsing: () => void;
};

/* ─── Component ────────────────────────────────────────────────── */
export default function PackageInstallSuccessModal({
  open,
  gameTitle,
  appId,
  jobId,
  imageUrl,
  providerName,
  primaryButtonLabel = "View in Library",
  onViewInLibrary,
  onContinueBrowsing,
}: Props) {
  const [focusedButton, setFocusedButton] = useState<"library" | "browse">("library");
  const focusedButtonRef = useRef<"library" | "browse">("library");
  const activationLockedRef = useRef(false);
  const openTimeRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const libraryRef = useRef<HTMLButtonElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);

  const onViewRef = useRef(onViewInLibrary);
  const onBrowseRef = useRef(onContinueBrowsing);

  useEffect(() => { onViewRef.current = onViewInLibrary; }, [onViewInLibrary]);
  useEffect(() => { onBrowseRef.current = onContinueBrowsing; }, [onContinueBrowsing]);

  /* Reset on open + dedup check */
  useEffect(() => {
    if (!open) return;

    const key = dedupeKey(jobId, appId);
    if (isAlreadyConsumed(key)) {
      if (DEBUG_PACKAGE_COMPLETION_UI) {
        console.log(`[PACKAGE_COMPLETION_UI][MODAL_DECISION] jobId=${jobId} appId=${appId} Store-Details-operation-match=true alreadyConsumed=true modalOpened=false skippedReason=duplicate-event`);
      }
      onContinueBrowsing();
      return;
    }

    markConsumed(key);
    if (DEBUG_PACKAGE_COMPLETION_UI) {
      console.log(`[PACKAGE_COMPLETION_UI][MODAL_DECISION] jobId=${jobId} appId=${appId} Store-Details-operation-match=true alreadyConsumed=false modalOpened=true`);
    }

    setFocusedButton("library");
    focusedButtonRef.current = "library";
    openTimeRef.current = Date.now();
    activationLockedRef.current = false;
    requestAnimationFrame(() => libraryRef.current?.focus());
  }, [open, jobId, appId]);

  /* Cleanup lock on close */
  useEffect(() => {
    if (!open) activationLockedRef.current = false;
  }, [open]);

  const setFocus = (btn: "library" | "browse") => {
    setFocusedButton(btn);
    focusedButtonRef.current = btn;
    if (btn === "library") libraryRef.current?.focus();
    else browseRef.current?.focus();
  };

  /* Keydown: navigation + activation */
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (!CONSUMED_KEYS.has(e.key)) return;

      e.preventDefault();
      e.stopPropagation();
      try { e.stopImmediatePropagation?.(); } catch { /* noop */ }

      const sinceOpen = Date.now() - openTimeRef.current;
      const isActivationKey = e.key === "Enter" || e.key === " ";

      if (sinceOpen < OPEN_GUARD_MS && isActivationKey) return;
      if (activationLockedRef.current) return;

      switch (e.key) {
        case "Escape":
          if (DEBUG_PACKAGE_COMPLETION_UI) {
            console.log(`[PACKAGE_COMPLETION_UI][MODAL_ACTION] jobId=${jobId} appId=${appId} action=escape`);
          }
          onBrowseRef.current();
          break;

        case "ArrowLeft":
          setFocus("library");
          break;

        case "ArrowRight":
          setFocus("browse");
          break;

        case "ArrowUp":
        case "ArrowDown":
          setFocus(focusedButtonRef.current === "library" ? "browse" : "library");
          break;

        default:
          if (isActivationKey) {
            activationLockedRef.current = true;
            setTimeout(() => { activationLockedRef.current = false; }, ACTIVATION_LOCK_MS);
            if (focusedButtonRef.current === "library") {
              if (DEBUG_PACKAGE_COMPLETION_UI) {
                console.log(`[PACKAGE_COMPLETION_UI][MODAL_ACTION] jobId=${jobId} appId=${appId} action=view-library`);
              }
              onViewRef.current();
            } else {
              if (DEBUG_PACKAGE_COMPLETION_UI) {
                console.log(`[PACKAGE_COMPLETION_UI][MODAL_ACTION] jobId=${jobId} appId=${appId} action=continue-browsing`);
              }
              onBrowseRef.current();
            }
          }
          break;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, jobId, appId]);

  function handleClose() {
    if (DEBUG_PACKAGE_COMPLETION_UI) {
      console.log(`[PACKAGE_COMPLETION_UI][MODAL_ACTION] jobId=${jobId} appId=${appId} action=close`);
    }
    onContinueBrowsing();
  }

  function handleViewInLibrary() {
    if (DEBUG_PACKAGE_COMPLETION_UI) {
      console.log(`[PACKAGE_COMPLETION_UI][MODAL_ACTION] jobId=${jobId} appId=${appId} action=view-library`);
    }
    onViewInLibrary();
  }

  function handleContinueBrowsing() {
    if (DEBUG_PACKAGE_COMPLETION_UI) {
      console.log(`[PACKAGE_COMPLETION_UI][MODAL_ACTION] jobId=${jobId} appId=${appId} action=continue-browsing`);
    }
    onContinueBrowsing();
  }

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pkg-success-title"
      aria-describedby="pkg-success-desc"
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/75 backdrop-blur-md"
      style={{ WebkitBackdropFilter: "blur(12px)" }}
    >
      <div
        className="relative mx-4 w-full max-w-[480px] overflow-hidden rounded-2xl border border-white/[0.08] lf-surface shadow-2xl shadow-black/50"
      >
        {/* Close button */}
        <button
          ref={closeRef}
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Success header */}
        <div className="flex flex-col items-center px-8 pt-8 pb-6">
          {/* Success icon */}
          <div className="relative mb-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/25">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <div className="absolute -inset-3 rounded-full bg-emerald-500/5 blur-xl" />
          </div>

          {/* Title */}
          <h2
            id="pkg-success-title"
            className="text-center text-xl font-bold tracking-tight text-white"
          >
            Package installed
          </h2>

          {/* Description */}
          <p
            id="pkg-success-desc"
            className="mt-2 max-w-[360px] text-center text-sm leading-relaxed text-white/50"
          >
            <span className="font-medium text-white/80">{gameTitle}</span>{" "}
            was installed successfully. You can view it in your library or keep browsing.
          </p>
        </div>

        {/* Game context strip */}
        {(imageUrl || providerName) && (
          <div className="mx-6 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            {imageUrl && (
              <img
                src={imageUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white/90">{gameTitle}</p>
              {providerName && (
                <p className="mt-0.5 text-xs text-white/40">
                  Source: {providerName}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2.5 px-6 pt-6 pb-6">
          <button
            ref={libraryRef}
            type="button"
            onClick={handleViewInLibrary}
            className={`group flex w-full items-center justify-center gap-2.5 rounded-xl px-5 py-3 text-sm font-semibold transition-all ${
              focusedButton === "library"
                ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 ring-2 ring-emerald-400/50"
                : "bg-emerald-500 text-white hover:bg-emerald-400 active:bg-emerald-600"
            }`}
          >
            <Library className="h-4 w-4" />
            {primaryButtonLabel}
            <ArrowRight className="h-3.5 w-3.5 opacity-60 transition-transform group-hover:translate-x-0.5" />
          </button>

          <button
            ref={browseRef}
            type="button"
            onClick={handleContinueBrowsing}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-medium transition-all ${
              focusedButton === "browse"
                ? "border-white/20 bg-white/10 text-white ring-2 ring-white/15"
                : "border-white/[0.08] bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80"
            }`}
          >
            Continue Browsing
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
