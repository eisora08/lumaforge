import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Gamepad2, X } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import { getConsoleInputHints } from "./consoleInputHints";
import type { ConsoleInputHintStyle } from "./consoleSettings";
import { useConsoleGamepadInput } from "./useConsoleGamepadInput";

const DEBUG = false;
const ACTIVATION_LOCK_MS = 300;

type FocusedButton = "cancel" | "install";

type Props = {
  game: LibraryGame;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  inputHints: ConsoleInputHintStyle;
};

export default function ConsoleInstallModal({
  game, open, onClose, onConfirm, inputHints,
}: Props) {
  useConsoleGamepadInput(open, { suppressHeldOnEnable: true });

  const hints = getConsoleInputHints(inputHints);
  const installRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [focusedButton, setFocusedButton] = useState<FocusedButton>("cancel");

  /* ── Single-fire activation lock ── */
  const activationLockRef = useRef(false);

  /* ── Opening cooldown: ignore Enter/Space for 250ms after open ── */
  const openedAtRef = useRef(0);

  /* ── Track input source for debug logs ── */
  const sourceRef = useRef<"mouse" | "keyboard" | "gamepad">("keyboard");

  /* ── Focus trap on open ── */
  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now();
      if (DEBUG) console.log(`[INSTALL_MODAL][OPEN] openedAt=${openedAtRef.current}`);
      setFocusedButton("cancel");
      const raf = requestAnimationFrame(() => {
        cancelRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  /* ── Move focus when focusedButton changes ── */
  useEffect(() => {
    if (!open) return;
    const btn = focusedButton === "install" ? installRef.current : cancelRef.current;
    btn?.focus();
  }, [focusedButton, open]);

  /* ── Keyboard ownership (capture phase) ── */
  const handleConfirm = useCallback(() => {
    if (DEBUG) console.log(`[INSTALL_MODAL][CONFIRM] source=${sourceRef.current}`);
    onConfirm();
  }, [onConfirm]);

  const handleCancel = useCallback(() => {
    if (DEBUG) console.log(`[INSTALL_MODAL][CANCEL] source=${sourceRef.current}`);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (!open) return;
      if (DEBUG) console.log(`[INSTALL_MODAL][KEY] key=${e.key} focused=${focusedButton}`);

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          e.stopImmediatePropagation();
          if (DEBUG) console.log(`[INSTALL_MODAL][FOCUS] from=${focusedButton} to=cancel`);
          setFocusedButton("cancel");
          break;
        case "ArrowRight":
          e.preventDefault();
          e.stopImmediatePropagation();
          if (DEBUG) console.log(`[INSTALL_MODAL][FOCUS] from=${focusedButton} to=install`);
          setFocusedButton("install");
          break;
        case "ArrowUp":
        case "ArrowDown":
          e.preventDefault();
          e.stopImmediatePropagation();
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          // Opening cooldown: ignore Enter/Space within 250ms of open
          // Prevents the opening A/Enter event from immediately selecting Cancel
          const age = Date.now() - openedAtRef.current;
          if (age < 250) {
            if (DEBUG) console.log(`[INSTALL_MODAL][IGNORED_OPENING_EVENT] key=${e.key} ageMs=${age}`);
            return;
          }
          if (DEBUG) console.log(`[INSTALL_MODAL][KEY] key=${e.key} focused=${focusedButton} ageMs=${age}`);

          // Single-fire lock — ignore if already activated within lock window
          if (activationLockRef.current) {
            if (DEBUG) console.log(`[INSTALL_MODAL][LOCKED_IGNORE] key=${e.key} focused=${focusedButton}`);
            return;
          }
          activationLockRef.current = true;
          setTimeout(() => { activationLockRef.current = false; }, ACTIVATION_LOCK_MS);

          sourceRef.current = "keyboard";
          if (focusedButton === "install") {
            if (DEBUG) console.log(`[INSTALL_MODAL][SELECT] focused=install action=confirm`);
            onConfirm();
          } else {
            if (DEBUG) console.log(`[INSTALL_MODAL][SELECT] focused=cancel action=close`);
            onClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          e.stopImmediatePropagation();
          onClose();
          break;
        // Block gamepad-triggered keys from reaching background handlers
        case "x":
        case "X":
        case "y":
        case "Y":
        case "q":
        case "Q":
        case "e":
        case "E":
        case "v":
        case "V":
        case "o":
        case "O":
        case "PageUp":
        case "PageDown":
        case "Alt":
        case "ContextMenu":
        case "Apps":
          e.preventDefault();
          e.stopImmediatePropagation();
          if (DEBUG) console.log(`[INSTALL_MODAL][KEY_BLOCKED] key=${e.key}`);
          break;
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, focusedButton, onConfirm, onClose]);

  if (!open) return null;

  const coverSrc = (() => {
    const meta = game.metadata as Record<string, unknown> | undefined;
    const caps = meta?.capsule_image ?? meta?.capsule_image_v5 ?? meta?.header_image;
    if (typeof caps === "string" && caps) return caps;
    return null;
  })();

  /* ── Extract key labels from hint system (A / ✕ / Enter) ── */
  const selectKey = hints.select.match(/^\[(.+?)\]/)?.[1] ?? "A";
  const backKey   = hints.back.match(/^\[(.+?)\]/)?.[1] ?? "B";

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Install game"
        className="lf-surface relative mx-auto w-[clamp(340px,40vw,480px)] overflow-hidden rounded-2xl border border-(--color-border)/30 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close X */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-(--color-muted)/50 transition hover:bg-white/5 hover:text-(--color-muted)"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header — cover + title */}
        <div className="flex items-center gap-4 px-6 pt-6 pb-4">
          {/* Cover thumbnail */}
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-(--color-surface)/60 shadow-lg ring-1 ring-white/[0.06]">
            {coverSrc ? (
              <img
                src={coverSrc}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Gamepad2 className="h-8 w-8 text-(--color-muted)/30" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-(--color-text) truncate">
              {game.title}
            </h2>
            <p className="text-sm text-(--color-muted) mt-0.5">
              Steam Game
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-6 h-px bg-gradient-to-r from-transparent via-(--color-border)/30 to-transparent" />

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm leading-relaxed text-(--color-muted)">
            Steam will open to handle the installation of{" "}
            <span className="font-medium text-(--color-text)">{game.title}</span>
            {" "}outside LumaForge.
          </p>

          <p className="text-sm leading-relaxed text-(--color-muted)/70">
            After installation completes, LumaForge will detect it
            automatically and update your library.
          </p>
        </div>

        {/* Divider */}
        <div className="mx-6 h-px bg-gradient-to-r from-transparent via-(--color-border)/30 to-transparent" />

        {/* Footer — buttons */}
        <div className="flex items-center justify-end gap-3 px-6 py-4">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => { sourceRef.current = "mouse"; handleCancel(); }}
            className={`rounded-xl border px-5 py-2.5 text-sm font-medium transition outline-none ${
              focusedButton === "cancel"
                ? "border-(--color-accent)/50 bg-(--color-accent)/10 text-(--color-text) ring-2 ring-(--color-accent)/50 ring-offset-2 ring-offset-(--color-surface)"
                : "border-(--color-border)/40 text-(--color-muted) hover:bg-(--color-surface)/40 hover:text-(--color-text)"
            }`}
          >
            Cancel
          </button>
          <button
            ref={installRef}
            type="button"
            onClick={() => { sourceRef.current = "mouse"; handleConfirm(); }}
            className={`inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-lg outline-none transition ${
              focusedButton === "install"
                ? "bg-(--color-accent) shadow-(--color-accent)/25 ring-2 ring-(--color-accent)/70 ring-offset-2 ring-offset-(--color-surface) brightness-110"
                : "bg-(--color-accent) shadow-(--color-accent)/25 hover:brightness-110"
            }`}
          >
            <Download className="h-4 w-4" />
            Install
          </button>
        </div>

        {/* Hint bar */}
        <div className="border-t border-(--color-border)/20 px-6 py-3">
          <div className="flex items-center justify-center gap-4">
            <HintPill
              label={`[${selectKey}] Select`}
              primary
            />
            <HintPill
              label={`[${backKey}] Back`}
              primary={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function HintPill({ label, primary }: { label: string; primary?: boolean }) {
  const m = label.match(/^\[(.+?)\]\s*(.*)$/);
  if (!m) return <span className="text-xs text-(--color-muted)/60">{label}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-(--color-muted)/70">
      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold leading-none ${
        primary
          ? "bg-(--color-accent) text-(--color-accent-text)"
          : "bg-white/[0.09] text-white/60"
      }`}>
        {m[1]}
      </span>
      <span>{m[2]}</span>
    </span>
  );
}
