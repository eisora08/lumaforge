import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Settings, X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  activeSectionLabel?: string;
};

export default function SettingsOverlay({
  open,
  onClose,
  children,
  activeSectionLabel,
}: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // ── Save & restore focus ──
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.body.style.overflow = "hidden";
      // Move focus to close button after portal mounts
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    }
    return () => {
      document.body.style.overflow = "";
      previousFocusRef.current?.focus();
    };
  }, [open]);

  // ── Escape key ──
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // ── Focus trap ──
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    panel.addEventListener("keydown", handler);
    return () => panel.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[99999] bg-black/40"
      aria-hidden="true"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Configuracion"
        className="absolute inset-2 flex flex-col overflow-hidden rounded-2xl shadow-2xl lf-surface lf-modal-panel sm:inset-4 md:inset-6 lg:inset-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header fijo ── */}
        <header className="flex shrink-0 items-center justify-between border-b border-(--surface-active-border) px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--color-accent)/10">
              <Settings className="h-4 w-4 text-(--color-accent)" />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-(--color-text)">Configuracion</span>
              {activeSectionLabel && (
                <>
                  <span className="text-(--color-muted)/40">/</span>
                  <span className="text-(--color-muted)">{activeSectionLabel}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              title="Cerrar Configuracion (Esc)"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) focus-visible:ring-2 focus-visible:ring-(--color-accent)/40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* ── Content: sidebar + scrollable area ── */}
        <div className="flex min-h-0 flex-1">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
