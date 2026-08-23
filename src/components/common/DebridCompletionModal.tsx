import { useCallback, useEffect, useRef, useState } from "react";
import PackageInstallSuccessModal from "./PackageInstallSuccessModal";
import {
  getPendingCompletion,
  popPendingCompletion,
  updateDebridGame,
  subscribeDebridGames,
} from "../../services/debridGameStore";
import { setupDebridGame } from "../../services/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { showError, showSuccess } from "../toast/GameToast";

type Props = {
  onNavigateToLibrary?: (appId?: string) => void;
};

export default function DebridCompletionModal({ onNavigateToLibrary }: Props) {
  const [completion, setCompletion] = useState(() => getPendingCompletion());
  const completionRef = useRef(completion);
  completionRef.current = completion;

  // Subscribe to store changes so modal appears as soon as markDebridGameExtracted fires
  useEffect(() => {
    const unsub = subscribeDebridGames(() => {
      const next = getPendingCompletion();
      // Use ref to avoid stale closure — always reads the latest completion value
      if (next && !completionRef.current) {
        setCompletion(next);
      }
    });
    return unsub;
  }, []); // stable subscription — ref avoids stale closure

  const handleInstallNow = useCallback(async () => {
    const info = popPendingCompletion();
    if (!info) return;
    setCompletion(null);

    if (info.needsExePath) {
      // Show native file picker for the game executable
      try {
        const selected = await open({
          title: "Select game executable",
          filters: [{ name: "Executables", extensions: ["exe", "com", "bat"] }],
          defaultPath: "C:\\",
          multiple: false,
        });
        if (selected) {
          updateDebridGame(info.providerGameId, info.installDir, selected);
          showSuccess("Game executable set. Ready to play!");
          onNavigateToLibrary?.(info.appId ?? info.providerGameId);
        } else {
          // User cancelled — re-show modal
          setCompletion(info);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showError(`File picker failed: ${msg}`);
        setCompletion(info);
      }
      return;
    }

    try {
      const result = await setupDebridGame({
        installerPath: info.installerPath,
        installDir: info.installDir,
      });

      if (result.success) {
        updateDebridGame(info.providerGameId, info.installDir, result.executablePath ?? undefined);
        onNavigateToLibrary?.(info.appId ?? info.providerGameId);
      } else {
        showError(result.message || "Setup failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError(`Setup failed: ${msg}`);
    }
  }, [onNavigateToLibrary]);

  const handleContinueBrowsing = useCallback(() => {
    popPendingCompletion();
    setCompletion(null);
  }, []);

  if (!completion) return null;

  return (
      <PackageInstallSuccessModal
        open={true}
        gameTitle={completion.title}
        appId={completion.appId}
        jobId={`debrid-completion-${completion.providerGameId}`}
        imageUrl={completion.imageUrl}
        providerName={completion.repacker ?? "Debrid"}
        primaryButtonLabel={completion.needsExePath ? "Select Executable" : "Install Now"}
        onViewInLibrary={handleInstallNow}
        onContinueBrowsing={handleContinueBrowsing}
      />
  );
}
