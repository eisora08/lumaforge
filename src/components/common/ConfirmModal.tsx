import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, AlertCircle, Info, CheckCircle } from "lucide-react";
import { isConsoleMode, isGamepadDetected, getConsoleInputHints } from "../../features/console/consoleInputHints";

export type ConfirmVariant = "danger" | "warning" | "info" | "success";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  icon?: React.ReactNode;
  onConfirm?: () => void;
  onCancel: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryVariant?: ConfirmVariant;
  tertiaryLabel?: string;
  onTertiary?: () => void;
  tertiaryVariant?: ConfirmVariant;
  extraActions?: React.ReactNode;
  aboveActions?: React.ReactNode;
  centerActions?: boolean;
  compact?: boolean;
};

const variantConfig: Record<ConfirmVariant, {
  iconBg: string;
  iconColor: string;
  btnClass: string;
  focusedBtnClass: string;
  iconEl: React.ReactNode;
}> = {
  danger: {
    iconBg: "bg-red-500/10",
    iconColor: "text-red-500",
    btnClass: "bg-red-500 text-white hover:bg-red-500/80 active:scale-[0.97]",
    focusedBtnClass: "bg-red-500 text-white ring-4 ring-red-500/60 shadow-xl shadow-red-500/40 scale-105",
    iconEl: <AlertTriangle className="h-5 w-5" />,
  },
  warning: {
    iconBg: "bg-(--color-warning)/10",
    iconColor: "text-(--color-warning)",
    btnClass: "bg-(--color-warning) text-white hover:opacity-85 active:scale-[0.97]",
    focusedBtnClass: "bg-(--color-warning) text-white ring-4 ring-(--color-warning)/60 shadow-xl shadow-(--color-warning)/30 scale-105",
    iconEl: <AlertCircle className="h-5 w-5" />,
  },
  info: {
    iconBg: "bg-(--color-info)/10",
    iconColor: "text-(--color-info)",
    btnClass: "bg-(--color-info) text-(--color-bg) hover:opacity-90 active:scale-[0.97]",
    focusedBtnClass: "bg-(--color-info) text-(--color-bg) ring-4 ring-(--color-info)/60 shadow-xl shadow-(--color-info)/30 scale-105",
    iconEl: <Info className="h-5 w-5" />,
  },
  success: {
    iconBg: "bg-(--color-success)/10",
    iconColor: "text-(--color-success)",
    btnClass: "bg-(--color-success) text-white hover:opacity-85 active:scale-[0.97]",
    focusedBtnClass: "bg-(--color-success) text-white ring-4 ring-(--color-success)/60 shadow-xl shadow-(--color-success)/30 scale-105",
    iconEl: <CheckCircle className="h-5 w-5" />,
  },
};

const CONSUMED_KEYS = new Set([
  "Enter", " ", "Escape",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "x", "X", "y", "Y", "o", "O", "v", "V",
  "q", "Q", "e", "E", "PageUp", "PageDown",
  "ContextMenu", "Apps", "Alt",
]);

const ACTIVATION_LOCK_MS = 300;
const OPEN_GUARD_MS = 250;

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
  tertiaryLabel,
  onTertiary,
  tertiaryVariant,
  extraActions,
  aboveActions,
  centerActions = false,
  compact = false,
}: Props) {
  type FocusTarget = "cancel" | "confirm" | "secondary" | "tertiary";
  const [focusedButton, setFocusedButton] = useState<FocusTarget>("cancel");
  const focusedButtonRef = useRef<FocusTarget>("cancel");
  const activationLockedRef = useRef(false);
  const openTimeRef = useRef(0);
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const secondaryRef = useRef<HTMLButtonElement>(null);
  const tertiaryRef = useRef<HTMLButtonElement>(null);

  const onCancelRef = useRef(onCancel);
  const onConfirmRef = useRef(onConfirm);

  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);
  useEffect(() => { onConfirmRef.current = onConfirm; }, [onConfirm]);

  const titleId = "confirm-modal-title";
  const descId = "confirm-modal-desc";
  const cfg = variantConfig[variant];

  /* ── Reset on open ── */
  useEffect(() => {
    if (!open) return;
    setFocusedButton("cancel");
    focusedButtonRef.current = "cancel";
    openTimeRef.current = Date.now();
    activationLockedRef.current = false;
    requestAnimationFrame(() => cancelRef.current?.focus());
  }, [open]);

  /* ── Cleanup lock on close ── */
  useEffect(() => {
    if (!open) activationLockedRef.current = false;
  }, [open]);

  /* ── Helper: sync state + ref + DOM focus ── */
  const setFocus = (btn: FocusTarget) => {
    setFocusedButton(btn);
    focusedButtonRef.current = btn;
    if (btn === "cancel") cancelRef.current?.focus();
    else if (btn === "confirm") confirmRef.current?.focus();
    else if (btn === "secondary") secondaryRef.current?.focus();
    else if (btn === "tertiary") tertiaryRef.current?.focus();
  };

  /* ── Keydown: ownership + navigation + activation ── */
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (!CONSUMED_KEYS.has(e.key)) return;

      e.preventDefault();
      e.stopPropagation();
      try { e.stopImmediatePropagation?.(); } catch { /* noop */ }

      const sinceOpen = Date.now() - openTimeRef.current;
      const isActivationKey = e.key === "Enter" || e.key === " ";

      /* Open guard: ignore activation keys for first 250ms */
      if (sinceOpen < OPEN_GUARD_MS && isActivationKey) return;

      /* Activation lock */
      if (activationLockedRef.current) return;

      switch (e.key) {
        case "Escape":
        case "b":
        case "B":
          onCancelRef.current();
          break;

        case "ArrowLeft": {
          const cur = focusedButtonRef.current;
          if (cur === "tertiary" && secondaryRef.current) setFocus("secondary");
          else if (cur === "secondary" && confirmRef.current) setFocus("confirm");
          else if ((cur === "confirm" || cur === "secondary" || cur === "tertiary") && cancelRef.current) setFocus("cancel");
          break;
        }

        case "ArrowRight": {
          const cur = focusedButtonRef.current;
          if (cur === "cancel" && confirmRef.current) setFocus("confirm");
          else if (cur === "confirm" && secondaryRef.current) setFocus("secondary");
          else if (cur === "secondary" && tertiaryRef.current) setFocus("tertiary");
          break;
        }

        case "ArrowUp":
        case "ArrowDown": {
          const cur = focusedButtonRef.current;
          const targets: FocusTarget[] = ["cancel"];
          if (confirmRef.current) targets.push("confirm");
          if (secondaryRef.current) targets.push("secondary");
          if (tertiaryRef.current) targets.push("tertiary");
          const idx = targets.indexOf(cur);
          const next = e.key === "ArrowDown"
            ? targets[(idx + 1) % targets.length]
            : targets[(idx - 1 + targets.length) % targets.length];
          setFocus(next);
          break;
        }

        default:
          if (isActivationKey) {
            activationLockedRef.current = true;
            setTimeout(() => { activationLockedRef.current = false; }, ACTIVATION_LOCK_MS);
            const cur = focusedButtonRef.current;
            if (cur === "cancel") onCancelRef.current();
            else if (cur === "confirm") confirmRef.current?.click();
            else if (cur === "secondary") secondaryRef.current?.click();
            else if (cur === "tertiary") tertiaryRef.current?.click();
          }
          break;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  /* ── Backdrop click ── */
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
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/40"
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

        {/* Above-actions row (e.g. "Mark as Stopped" for StopGame) */}
        {aboveActions && (
          <div className="mt-6 flex justify-start">
            {aboveActions}
          </div>
        )}

        {/* Main button row — single unified layout */}
        <div className={`mt-6 flex items-center gap-3 ${centerActions ? "justify-center" : "justify-end"}`}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className={`cursor-pointer rounded-xl ${compact ? "px-4 py-2 text-xs" : "px-5 py-2.5 text-sm"} font-medium transition-all ${
              focusedButton === "cancel"
                ? "border-(--color-accent)/50 bg-(--color-accent)/10 text-(--color-accent) ring-3 ring-(--color-accent)/60 shadow-lg shadow-(--color-accent)/25 scale-105"
                : "border border-(--surface-active-border) bg-white/5 text-(--color-text) hover:bg-white/10"
            }`}
          >
            {cancelLabel}
          </button>
          {onConfirm && (
            <button
              ref={confirmRef}
              type="button"
              onClick={onConfirm}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-bold transition-all ${cfg.btnClass} ${
                focusedButton === "confirm" ? "ring-3 ring-white/40 scale-105" : ""
              }`}
            >
              {confirmLabel}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button
              ref={secondaryRef}
              type="button"
              onClick={() => { onSecondary(); }}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl ${compact ? "px-4 py-2 text-xs" : "px-5 py-2.5 text-sm"} font-medium transition focus-visible:ring-2 focus-visible:ring-(--color-text)/20 ${secondaryVariant
                  ? `${variantConfig[secondaryVariant].btnClass} ${focusedButton === "secondary" ? "ring-3 ring-white/40 scale-105" : ""}`
                  : `border border-(--surface-active-border) bg-white/5 text-(--color-text) hover:bg-white/10 ${focusedButton === "secondary" ? "ring-3 ring-(--color-accent)/60 scale-105" : ""}`
                }`}
            >
              {secondaryLabel}
            </button>
          )}
          {tertiaryLabel && onTertiary && (
            <button
              ref={tertiaryRef}
              type="button"
              onClick={() => { onTertiary(); }}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl ${compact ? "px-4 py-2 text-xs" : "px-5 py-2.5 text-sm"} font-medium transition focus-visible:ring-2 focus-visible:ring-(--color-text)/20 ${tertiaryVariant
                  ? `${variantConfig[tertiaryVariant].btnClass} ${focusedButton === "tertiary" ? "ring-3 ring-white/40 scale-105" : ""}`
                  : `border border-(--surface-active-border) bg-white/5 text-(--color-text) hover:bg-white/10 ${focusedButton === "tertiary" ? "ring-3 ring-(--color-accent)/60 scale-105" : ""}`
                }`}
            >
              {tertiaryLabel}
            </button>
          )}
          {extraActions}
        </div>

        {isConsoleMode() && isGamepadDetected() && (() => {
          const hints = getConsoleInputHints();
          const selectKey = hints.select.match(/\[(.+?)\]/)?.[1] ?? "A";
          const backKey = hints.back.match(/\[(.+?)\]/)?.[1] ?? "B";
          return (
            <div className="mt-4 flex items-center justify-center gap-1 text-xs text-(--color-muted)/50">
              <kbd className="rounded border border-(--color-border)/30 px-1.5 py-0.5 font-mono text-[10px]">{selectKey}</kbd>
              <span>Select</span>
              <span className="mx-1">·</span>
              <kbd className="rounded border border-(--color-border)/30 px-1.5 py-0.5 font-mono text-[10px]">{backKey}</kbd>
              <span>Back</span>
            </div>
          );
        })()}
      </div>
    </div>,
    document.body
  );
}
