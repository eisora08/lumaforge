import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, AlertCircle, Info, CheckCircle } from "lucide-react";

export type ConfirmVariant = "danger" | "warning" | "info" | "success";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  icon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryVariant?: ConfirmVariant;
  extraActions?: React.ReactNode;
};

const variantConfig: Record<ConfirmVariant, {
  iconBg: string;
  iconColor: string;
  btnClass: string;
  iconEl: React.ReactNode;
}> = {
  danger: {
    iconBg: "bg-red-500/10",
    iconColor: "text-red-500",
    btnClass: "bg-red-500 text-white hover:bg-red-500/80 active:scale-[0.97]",
    iconEl: <AlertTriangle className="h-5 w-5" />,
  },
  warning: {
    iconBg: "bg-(--color-warning)/10",
    iconColor: "text-(--color-warning)",
    btnClass: "bg-(--color-warning) text-white hover:opacity-85 active:scale-[0.97]",
    iconEl: <AlertCircle className="h-5 w-5" />,
  },
  info: {
    iconBg: "bg-(--color-info)/10",
    iconColor: "text-(--color-info)",
    btnClass: "bg-(--color-info) text-(--color-bg) hover:opacity-90 active:scale-[0.97]",
    iconEl: <Info className="h-5 w-5" />,
  },
  success: {
    iconBg: "bg-(--color-success)/10",
    iconColor: "text-(--color-success)",
    btnClass: "bg-(--color-success) text-white hover:opacity-85 active:scale-[0.97]",
    iconEl: <CheckCircle className="h-5 w-5" />,
  },
};

export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  icon,
  onConfirm,
  onCancel,
  secondaryLabel,
  onSecondary,
  secondaryVariant,
  extraActions,
}: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = "confirm-modal-title";
  const descId = "confirm-modal-desc";
  const cfg = variantConfig[variant];

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") {
      onCancel();
      return;
    }
  }, [open, onCancel]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
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
    }
    panel.addEventListener("keydown", handleTab);
    return () => panel.removeEventListener("keydown", handleTab);
  }, [open]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onCancel();
  }

  if (!open) return null;

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-md lf-modal-overlay"
    >
      <div
        ref={panelRef}
        className="lf-modal-panel mx-4 w-full max-w-sm rounded-2xl border p-6 lf-surface"
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${icon ? "" : cfg.iconBg}`}>
            {icon ? (
              <span className={cfg.iconColor}>{icon}</span>
            ) : (
              <span className={cfg.iconColor}>{cfg.iconEl}</span>
            )}
          </div>
          <h2 id={titleId} className="text-lg font-bold text-(--color-text)">{title}</h2>
        </div>

        <p id={descId} className="mt-4 text-sm leading-relaxed text-(--color-muted)">
          {description}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          {(extraActions || (secondaryLabel && onSecondary)) && (
            <div className="flex flex-wrap items-center gap-3 mr-auto">
              {extraActions}
              {secondaryLabel && onSecondary && (
                <button
                  type="button"
                  onClick={() => { onSecondary(); }}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-(--color-text)/20 ${secondaryVariant
                      ? variantConfig[secondaryVariant].btnClass
                      : "border border-(--surface-active-border) bg-white/5 text-(--color-text) hover:bg-white/10"
                    }`}
                >
                  {secondaryLabel}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm font-medium text-(--color-text) transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--color-text)/20"
            >
              {cancelLabel}
            </button>

            <button
              type="button"
              onClick={onConfirm}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition focus-visible:ring-2 focus-visible:ring-(--color-text)/30 ${cfg.btnClass}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
