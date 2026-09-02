import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Trash2, X, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { deleteGameCompletely } from "../../services/tauri";

type Props = {
  open: boolean;
  onClose: () => void;
  gameId: string;
  gameTitle: string;
  appId?: string | null;
  onDeleted?: () => void;
};

export default function UninstallGameDialog({
  open,
  onClose,
  gameId,
  gameTitle,
  appId,
  onDeleted,
}: Props) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = useCallback(async () => {
    setDeleting(true);
    try {
      await deleteGameCompletely(gameId, appId ?? undefined);
      onDeleted?.();
      onClose();
    } catch (e) {
      console.error("[UninstallGameDialog] delete failed:", e);
    } finally {
      setDeleting(false);
    }
  }, [gameId, appId, onDeleted, onClose]);

  if (!open) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[9999] grid place-items-center bg-black/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-(--surface-active-border) lf-surface p-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
            <h2 className="text-sm font-semibold text-(--color-text)">
              {t("uninstall_dialog.title", "Eliminar juego")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/5 hover:text-(--color-text)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Game name */}
        <p className="text-xs text-(--color-muted) mb-4">
          {t("uninstall_dialog.confirm", "¿Eliminar")} <span className="font-medium text-(--color-text)">"{gameTitle}"</span> {t("uninstall_dialog.and_data", "y todos sus datos?")}
        </p>

        {/* Warning */}
        <div className="rounded-lg bg-red-500/5 border border-red-500/10 p-3 mb-4">
          <p className="text-[11px] text-red-300/80">
            {t("uninstall_dialog.warning", "Esta acción eliminará permanentemente el progreso, logros, sesiones de juego y todos los datos asociados. No se pueden deshacer.")}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="px-3 py-1.5 text-xs font-medium text-(--color-muted) rounded-lg transition hover:bg-white/5 hover:text-(--color-text) disabled:opacity-50"
          >
            {t("common.cancel", "Cancelar")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={deleting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-500/80 rounded-lg transition hover:bg-red-500 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? t("uninstall_dialog.deleting", "Eliminando...") : t("uninstall_dialog.delete", "Eliminar")}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
