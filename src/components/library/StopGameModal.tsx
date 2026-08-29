import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Search } from "lucide-react";
import ConfirmModal from "../common/ConfirmModal";

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
  isSoftSession: _isSoftSession,
  trackingConfidence,
  onClose,
  onConfirmStop,
  onMarkStopped,
  onFindProcess,
}: Props) {
  const [findingProcess, setFindingProcess] = useState(false);
  const { t } = useTranslation();

  const canKillByPid = canTerminate && trackingConfidence && trackingConfidence !== "none" && trackingConfidence !== "low";
  const showFindProcess = !canKillByPid && !!onFindProcess;

  const handleFindProcess = useCallback(async () => {
    if (!onFindProcess) return;
    setFindingProcess(true);
    try {
      await onFindProcess();
    } finally {
      setFindingProcess(false);
    }
  }, [onFindProcess]);

  const handleConfirm = useCallback(() => {
    onConfirmStop();
  }, [onConfirmStop]);

  const handleSecondary = useCallback(() => {
    onMarkStopped?.();
  }, [onMarkStopped]);

  return (
    <ConfirmModal
      open={open}
      variant="danger"
      title={t("library_details.stop_game", "Stop game?")}
      description={t("library_details.stop_game_desc", { gameTitle, defaultValue: "Are you sure you want to close {{gameTitle}}? Unsaved progress may be lost." })}
      confirmLabel={t("library_details.stop_game_confirm", "Stop Game")}
      cancelLabel={t("library_details.cancel", "Cancel")}
      onConfirm={handleConfirm}
      onCancel={onClose}
      centerActions={showFindProcess}
      aboveActions={onMarkStopped ? (
        <button
          type="button"
          onClick={handleSecondary}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm font-medium text-(--color-text) transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--color-text)/30"
        >
          {t("library_details.mark_stopped", "Mark as Stopped")}
        </button>
      ) : undefined}
      extraActions={showFindProcess ? (
        <button
          type="button"
          onClick={handleFindProcess}
          disabled={findingProcess}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-5 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--color-text)/30 disabled:opacity-50"
        >
          {findingProcess ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          {t("library_details.find_process", "Find Running Process")}
        </button>
      ) : undefined}
    />
  );
}
