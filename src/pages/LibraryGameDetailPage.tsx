import { useCallback, useEffect, useRef, useState } from "react";
import { useLibraryGames } from "../context/LibraryGamesContext";
import {
  installSteamApp,
  launchSteamApp,
  launchExecutable,
  terminateProcess,
  isProcessRunning,
} from "../services/tauri";
import { openExternalUrl } from "../services/externalLinks";
import { getSteamStoreUrl, getSteamDbUrl } from "../utils/steamLinks";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { resolveArtworkForAppIds } from "../services/storeArtworkResolver";
import LibraryGameDetails from "../components/library/LibraryGameDetails";
import { useSettings } from "../context/SettingsContext";

import type { LibraryGame } from "../types/libraryGame";
import type { SgdbArtworkData } from "../services/storeArtworkResolver";
import type { AppPage } from "../types/navigation";

import {
  showError,
  showWarning,
} from "../components/toast/GameToast";

type GameLaunchState = "idle" | "launching" | "running" | "stopping" | "error";

type GameLaunchInfo = {
  state: GameLaunchState;
  pid?: number;
  launchedAt?: number;
  error?: string;
};

const POLL_INTERVAL_MS = 5000;

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

  // --- Launch state management (per-game, resets when selectedGame changes) ---
  const [launchInfo, setLaunchInfo] = useState<GameLaunchInfo>({ state: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  // Reset launch state when the selected game changes
  useEffect(() => {
    setLaunchInfo({ state: "idle" });
    cancelledRef.current = false;
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    // Cleanup on unmount
    return () => {
      cancelledRef.current = true;
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [selectedGame?.id]);

  // Poll process lifecycle while running with PID
  useEffect(() => {
    if (launchInfo.state === "running" && launchInfo.pid != null) {
      if (pollRef.current !== null) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const running = await isProcessRunning(launchInfo.pid!);
          if (!running && !cancelledRef.current) {
            console.debug("[Launch] process exited, resetting state");
            setLaunchInfo({ state: "idle" });
          }
        } catch {
          // Ignore poll errors
        }
      }, POLL_INTERVAL_MS);
    } else {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [launchInfo.state, launchInfo.pid]);

  // --- Launch actions ---
  async function launchGame(game: LibraryGame) {
    console.debug("[Launch] clicked", {
      gameId: game.id,
      title: game.title,
      appId: game.appId,
      executablePath: game.executablePath,
      state: launchInfo.state,
    });

    if (cancelledRef.current) return;
    setLaunchInfo({ state: "launching", launchedAt: Date.now() });

    try {
      if (game.source === "steam" && game.appId) {
        console.debug("[Launch] using steam url", `steam://run/${game.appId}`);
        await launchSteamApp(Number(game.appId));
        console.debug("[Launch] steam dispatch success");
        // Steam games: soft running state (no PID tracking available)
        if (!cancelledRef.current) {
          setLaunchInfo({ state: "running", launchedAt: Date.now() });
        }
      } else if (game.source === "local" && game.executablePath) {
        console.debug("[Launch] using local exe", game.executablePath);
        const result = await launchExecutable(game.executablePath);
        console.debug("[Launch] local exe result", result);
        if (!cancelledRef.current) {
          setLaunchInfo({
            state: "running",
            pid: result.pid,
            launchedAt: Date.now(),
          });
        }
      } else {
        console.warn("[Launch] cannot determine launch method for game", game.id);
        setLaunchInfo({ state: "error", error: "Cannot launch this game" });
      }
    } catch (err) {
      console.warn("[Launch] failed", err);
      if (!cancelledRef.current) {
        setLaunchInfo({ state: "error", error: String(err) });
        setTimeout(() => {
          if (!cancelledRef.current) {
            setLaunchInfo({ state: "idle" });
          }
        }, 2000);
      }
    }
  }

  async function cancelLaunch() {
    const current = launchInfo;
    if (current.state !== "launching") return;

    console.debug("[Launch] cancel clicked, pid=", current.pid);

    if (current.pid != null) {
      try {
        await terminateProcess(current.pid);
      } catch {
        // Ignore termination errors during cancel
      }
    }
    cancelledRef.current = false;
    setLaunchInfo({ state: "idle" });
  }

  async function stopGame() {
    const current = launchInfo;
    if (current.state !== "running") return;

    console.debug("[Launch] stop clicked, pid=", current.pid);

    setLaunchInfo({ ...current, state: "stopping" });

    if (current.pid != null) {
      try {
        await terminateProcess(current.pid);
        console.debug("[Launch] process terminated");
        setLaunchInfo({ state: "idle" });
      } catch (err) {
        console.warn("[Launch] terminate failed", err);
        setLaunchInfo({ state: "running", pid: current.pid, error: String(err) });
      }
    } else {
      // Steam game with no PID — can't safely kill
      console.debug("[Launch] no PID — cannot stop Steam game safely");
      setLaunchInfo({ state: "running", error: "Cannot close Steam game safely" });
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

  async function handlePlay(game: LibraryGame) {
    if (game.source === "steam" && game.appId) {
      await launchGame(game);
    } else if (game.source === "local" && game.executablePath) {
      await launchGame(game);
    } else {
      showWarning("This game cannot be launched yet.", { title: "Not available" });
    }
  }

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

  return (
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
      onStopGame={stopGame}
    />
  );
}
