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
    iconColor: "text-red-400",
    btnClass: "bg-red-500 text-white hover:bg-red-500/80 active:scale-[0.97]",
    iconEl: <AlertTriangle className="h-5 w-5" />,
  },
  warning: {
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-400",
    btnClass: "bg-amber-500 text-white hover:bg-amber-500/80 active:scale-[0.97]",
    iconEl: <AlertCircle className="h-5 w-5" />,
  },
  info: {
    iconBg: "bg-(--color-accent)/10",
    iconColor: "text-(--color-accent)",
    btnClass: "bg-(--color-accent) text-(--color-bg) hover:opacity-90 active:scale-[0.97]",
    iconEl: <Info className="h-5 w-5" />,
  },
  success: {
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    btnClass: "bg-emerald-500 text-white hover:bg-emerald-500/80 active:scale-[0.97]",
    iconEl: <CheckCircle className="h-5 w-5" />,
  },
};

function getVariantBtn(v: ConfirmVariant | undefined, fallback: string): string {
  if (!v) return fallback;
  return variantConfig[v].btnClass;
}

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
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 lf-modal-overlay"
    >
      <div
        ref={panelRef}
        className="lf-modal-panel mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-[#101014] p-6 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${icon ? "" : cfg.iconBg}`}>
            {icon ? (
              <span className={cfg.iconColor}>{icon}</span>
            ) : (
              <span className={cfg.iconColor}>{cfg.iconEl}</span>
            )}
          </div>
          <h2 id={titleId} className="text-lg font-bold text-white">{title}</h2>
        </div>

        <p id={descId} className="mt-4 text-sm leading-relaxed text-white/70">
          {description}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          {extraActions}

          {secondaryLabel && onSecondary && (
            <button
              type="button"
              onClick={() => { onSecondary(); }}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30 ${getVariantBtn(secondaryVariant, "text-white")}`}
            >
              {secondaryLabel}
            </button>
          )}

          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition focus-visible:ring-2 focus-visible:ring-white/50 ${cfg.btnClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
