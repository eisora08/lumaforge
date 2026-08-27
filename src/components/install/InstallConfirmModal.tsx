import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Gamepad2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LibraryGame } from "../../types/libraryGame";

type Props = {
  game: LibraryGame;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function InstallConfirmModal({
  game, open, onClose, onConfirm,
}: Props) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const installRef = useRef<HTMLButtonElement>(null);
  const [focusedButton, setFocusedButton] = useState<"cancel" | "install">("cancel");

  const isEpic = game.source === "epic";

  useEffect(() => {
    if (open) {
      setFocusedButton("cancel");
      const raf = requestAnimationFrame(() => cancelRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const btn = focusedButton === "install" ? installRef.current : cancelRef.current;
    btn?.focus();
  }, [focusedButton, open]);

  const handleConfirm = useCallback(() => onConfirm(), [onConfirm]);
  const handleCancel = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          setFocusedButton("cancel");
          break;
        case "ArrowRight":
          e.preventDefault();
          setFocusedButton("install");
          break;
        case "ArrowUp":
        case "ArrowDown":
          e.preventDefault();
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (focusedButton === "install") onConfirm();
          else onClose();
          break;
        case "Escape":
          e.preventDefault();
          onClose();
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

  const subtitle = isEpic
    ? t("install_confirm.epic_subtitle", "Epic Game")
    : t("install_confirm.steam_subtitle", "Steam Game");

  const desc = isEpic
    ? t("install_confirm.epic_desc", "Epic Games Launcher will open to handle the installation of {{title}}.", { title: game.title })
    : t("install_confirm.steam_desc", "{{title}} will open in Steam to handle the installation outside LumaForge.", { title: game.title });

  const afterText = isEpic
    ? t("install_confirm.epic_after", "After installation completes, LumaForge will detect it automatically and update your library.")
    : t("install_confirm.steam_after", "After installation completes, LumaForge will detect it automatically and update your library.");

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("install_confirm.title", "Install Game")}
        className="lf-surface relative mx-auto w-[clamp(340px,40vw,480px)] overflow-hidden rounded-2xl border border-(--color-border)/30 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-(--color-muted)/50 transition hover:bg-white/5 hover:text-(--color-muted)"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-4 px-6 pt-6 pb-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-(--color-surface)/60 shadow-lg ring-1 ring-white/[0.06]">
            {coverSrc ? (
              <img src={coverSrc} alt="" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Gamepad2 className="h-8 w-8 text-(--color-muted)/30" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-(--color-text) truncate">{game.title}</h2>
            <p className="text-sm text-(--color-muted) mt-0.5">{subtitle}</p>
          </div>
        </div>

        <div className="mx-6 h-px bg-gradient-to-r from-transparent via-(--color-border)/30 to-transparent" />

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm leading-relaxed text-(--color-muted)">{desc}</p>
          <p className="text-sm leading-relaxed text-(--color-muted)/70">{afterText}</p>
        </div>

        <div className="mx-6 h-px bg-gradient-to-r from-transparent via-(--color-border)/30 to-transparent" />

        <div className="flex items-center justify-end gap-3 px-6 py-4">
          <button
            ref={cancelRef}
            type="button"
            onClick={handleCancel}
            className={`rounded-xl border px-5 py-2.5 text-sm font-medium transition outline-none ${
              focusedButton === "cancel"
                ? "border-(--color-accent)/50 bg-(--color-accent)/10 text-(--color-text) ring-2 ring-(--color-accent)/50 ring-offset-2 ring-offset-(--color-surface)"
                : "border-(--color-border)/40 text-(--color-muted) hover:bg-(--color-surface)/40 hover:text-(--color-text)"
            }`}
          >
            {t("install_confirm.cancel", "Cancel")}
          </button>
          <button
            ref={installRef}
            type="button"
            onClick={handleConfirm}
            className={`inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-lg outline-none transition ${
              focusedButton === "install"
                ? "bg-(--color-accent) shadow-(--color-accent)/25 ring-2 ring-(--color-accent)/70 ring-offset-2 ring-offset-(--color-surface) brightness-110"
                : "bg-(--color-accent) shadow-(--color-accent)/25 hover:brightness-110"
            }`}
          >
            <Download className="h-4 w-4" />
            {t("install_confirm.install", "Install")}
          </button>
        </div>
      </div>
    </div>
  );
}
