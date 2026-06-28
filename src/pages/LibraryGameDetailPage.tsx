import { useCallback, useEffect, useRef, useState } from "react";
import { useLibraryGames } from "../context/LibraryGamesContext";
import {
  installSteamApp,
} from "../services/tauri";
import { openExternalUrl } from "../services/externalLinks";
import { getSteamStoreUrl, getSteamDbUrl } from "../utils/steamLinks";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { resolveArtworkForAppIds } from "../services/storeArtworkResolver";
import LibraryGameDetails from "../components/library/LibraryGameDetails";
import StopGameModal from "../components/library/StopGameModal";
import { useSettings } from "../context/SettingsContext";
import { useGameSession, computeGameKey } from "../context/GameSessionContext";
import { useGameLaunchState } from "../hooks/useGameLaunchState";
import { useGameActivity } from "../context/GameActivityContext";
import { useGamePlayStats } from "../services/gamePlayStats";

import type { LibraryGame } from "../types/libraryGame";
import type { SgdbArtworkData } from "../services/storeArtworkResolver";
import type { AppPage } from "../types/navigation";

import {
  showError,
  showWarning,
} from "../components/toast/GameToast";

type Props = {
  onBack?: () => void;
  onNavigate?: (page: AppPage) => void;
};

export default function LibraryGameDetailPage({ onBack, onNavigate }: Props) {
  const { selectedGame, setSelectedGame } = useLibraryGames();
  const { settings } = useSettings();
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [resolvedGame, setResolvedGame] = useState<LibraryGame | null>(null);
  const [artwork, setArtwork] = useState<SgdbArtworkData | null>(null);
  const currentRequest = useRef<number | null>(null);
  const artworkRequest = useRef<number | null>(null);
  const prevRunningRef = useRef(false);

  const gameKey = selectedGame ? computeGameKey(selectedGame) : "";
  const { launchInfo, launchGame, cancelLaunch } = useGameLaunchState(gameKey);
  const session = useGameSession();
  const { addActivity } = useGameActivity();
  const { recordSessionEnd } = useGamePlayStats(selectedGame?.id || "");
  const [showStopModal, setShowStopModal] = useState(false);

  // Playtime tracking: when session transitions from running to idle/cleared
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    const isRunning = launchInfo.state === "running";
    prevRunningRef.current = isRunning;

    if (wasRunning && !isRunning && launchInfo.launchedAt) {
      const durationMs = Date.now() - launchInfo.launchedAt;
      if (durationMs > 30000) {
        recordSessionEnd(durationMs);
        addActivity({
          gameId: selectedGame?.id || "",
          appId: selectedGame?.appId,
          kind: "game-closed",
          title: "Game session ended",
          description: `Played for ${Math.round(durationMs / 60000)}m`,
          source: "local",
          severity: "info",
        });
      }
    }
  }, [launchInfo.state, launchInfo.launchedAt, selectedGame, recordSessionEnd, addActivity]);

  async function handlePlay(game: LibraryGame) {
    if (game.source === "steam" && game.appId) {
      await launchGame(game);
    } else if (game.source === "local" && game.executablePath) {
      await launchGame(game);
    } else {
      showWarning("This game cannot be launched yet.", { title: "Not available" });
    }
  }

  async function handleConfirmStop() {
    console.debug("[StopModal] confirm stop", { gameKey });
    setShowStopModal(false);
    await session.stopSession(gameKey);
  }

  function handleMarkAsStopped() {
    console.debug("[StopModal] mark as stopped", { gameKey });
    setShowStopModal(false);
    session.clearSession(gameKey);
  }

  function handleOpenStopModal() {
    console.debug("[LaunchButton] opening stop modal", { gameKey });
    console.debug("[StopModal] set open true", { gameKey });
    setShowStopModal(true);
  }

  async function handleFindProcess() {
    console.debug("[StopModal] find process", { gameKey });
    const candidate = await session.findGameProcessForSession(gameKey);
    if (candidate) {
      showWarning(`Found process: ${candidate.name} (PID ${candidate.pid})`, { title: "Process found" });
    } else {
      showWarning("Could not find the game process automatically.", { title: "No process found" });
    }
  }

  // Resolve metadata when a game with an appId is selected but has no/incomplete metadata
  useEffect(() => {
    if (!selectedGame) {
      setResolvedGame(null);
      setMetadataLoading(false);
      return;
    }

    const appIdNum = selectedGame.appId ? Number(selectedGame.appId) : null;
    if (!appIdNum) {
      setResolvedGame(selectedGame);
      setMetadataLoading(false);
      return;
    }

    const meta = selectedGame.metadata;
    const hasResolvedMetadata = meta && meta.resolved === true && !!meta.name && meta.name !== `Steam App ${appIdNum}`;
    if (hasResolvedMetadata) {
      setResolvedGame(selectedGame);
      setMetadataLoading(false);
      return;
    }

    const requestId = Date.now();
    currentRequest.current = requestId;

    setMetadataLoading(true);
    setResolvedGame(selectedGame);
    resolveGameMetadata([appIdNum])
      .then((result) => {
        if (currentRequest.current !== requestId) return;
        const resolvedMeta = result[appIdNum];
        if (resolvedMeta) {
          setResolvedGame({
            ...selectedGame,
            metadata: resolvedMeta,
            imageUrl: selectedGame.imageUrl || resolvedMeta.header_image || resolvedMeta.capsule_image || resolvedMeta.capsule_image_v5 || undefined,
          });
        }
      })
      .catch(() => {
        // keep original game if resolution fails
      })
      .finally(() => {
        if (currentRequest.current === requestId) {
          setMetadataLoading(false);
        }
      });
  }, [selectedGame]);

  // Resolve SteamGridDB artwork after metadata is loaded
  useEffect(() => {
    if (!resolvedGame || !resolvedGame.appId) return;
    const appIdNum = Number(resolvedGame.appId);
    if (!appIdNum || !settings.steamGridDbArtworkEnabled || !settings.steamGridDbApiKey) return;

    const requestId = Date.now();
    artworkRequest.current = requestId;

    resolveArtworkForAppIds([appIdNum], settings.steamGridDbApiKey)
      .then((result) => {
        if (artworkRequest.current !== requestId) return;
        const entry = result[String(appIdNum)];
        if (entry) {
          console.debug("[SGDB] selected cover", appIdNum);
          setArtwork(entry);
        }
      })
      .catch(() => {
        // silent — artwork is optional
      });
  }, [resolvedGame, settings.steamGridDbArtworkEnabled, settings.steamGridDbApiKey]);

  const handleRefreshArtwork = useCallback(async () => {
    if (!selectedGame?.appId) {
      showWarning("No App ID available for this game.", { title: "Artwork" });
      return;
    }
    if (!settings.steamGridDbArtworkEnabled) {
      showWarning("Enable SteamGridDB Artwork in Settings.", { title: "Artwork" });
      return;
    }
    if (!settings.steamGridDbApiKey) {
      showWarning("Add a SteamGridDB API key in Settings to fetch artwork.", { title: "Artwork" });
      return;
    }

    const appIdNum = Number(selectedGame.appId);
    const { clearArtworkCache } = await import("../services/storeArtworkResolver");
    clearArtworkCache();

    console.debug("[SGDB] refresh artwork for", appIdNum);
    const result = await resolveArtworkForAppIds([appIdNum], settings.steamGridDbApiKey);
    const entry = result[String(appIdNum)];
    if (entry) {
      setArtwork(entry);
      showWarning("Artwork refreshed.", { title: "Artwork" });
    } else {
      showWarning("No artwork found for this game.", { title: "Artwork" });
    }
  }, [selectedGame, settings.steamGridDbArtworkEnabled, settings.steamGridDbApiKey]);

  async function handleInstall(game: LibraryGame) {
    if (game.appId) {
      try {
        await installSteamApp(Number(game.appId));
      } catch (err) {
        showError(String(err), { title: "Error" });
      }
    } else {
      showWarning("This game cannot be installed through Steam because it has no AppID.", { title: "Not available" });
    }
  }

  function handleOpenSteamStore(game: LibraryGame) {
    if (!game.appId) return;
    openExternalUrl(getSteamStoreUrl(Number(game.appId))).catch(() =>
      showError("Could not open Steam page.", { title: "Error" })
    );
  }

  function handleOpenSteamDb(game: LibraryGame) {
    if (!game.appId) return;
    openExternalUrl(getSteamDbUrl(Number(game.appId))).catch(() =>
      showError("Could not open SteamDB.", { title: "Error" })
    );
  }

  function handleBack() {
    setSelectedGame(null);
    onBack?.();
  }

  if (!selectedGame) {
    return (
      <div className="flex h-full items-center justify-center p-5 lg:p-7">
        <p className="text-(--color-muted)">No game selected.</p>
      </div>
    );
  }

  const displayGame = resolvedGame || selectedGame;
  const currentSession = session.getSession(gameKey);

  return (
    <>
      <LibraryGameDetails
        game={displayGame}
        artwork={artwork}
        loading={metadataLoading}
        onPlay={handlePlay}
        onInstall={handleInstall}
        onOpenSteam={handleOpenSteamStore}
        onOpenSteamDb={handleOpenSteamDb}
        onBack={handleBack}
        onRefreshArtwork={handleRefreshArtwork}
        onNavigate={onNavigate}
        launchInfo={launchInfo}
        onCancelLaunch={cancelLaunch}
        onOpenStopModal={handleOpenStopModal}
      />
      <StopGameModal
        open={showStopModal}
        gameTitle={displayGame.title}
        canTerminate={!!launchInfo.pid}
        isSoftSession={currentSession?.softSession ?? true}
        trackingConfidence={currentSession?.trackingConfidence}
        onClose={() => setShowStopModal(false)}
        onConfirmStop={handleConfirmStop}
        onMarkStopped={handleMarkAsStopped}
        onFindProcess={handleFindProcess}
      />
    </>
  );
}
