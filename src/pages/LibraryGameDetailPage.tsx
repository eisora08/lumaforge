import { useCallback, useEffect, useRef, useState } from "react";
import { useLibraryGames } from "../context/LibraryGamesContext";
import {
  installSteamApp,
} from "../services/tauri";
import { openExternalUrl } from "../services/externalLinks";
import { getSteamStoreUrl, getSteamDbUrl } from "../utils/steamLinks";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { loadSteamStats, mergeSteamStatsIntoGames } from "../services/gameStatsService";
import { resolveArtworkForAppIds } from "../services/storeArtworkResolver";
import {
  getMediaCacheForAppId,
  getLibraryGameDetails,
} from "../services/libraryLocalCacheService";
import type { GameMediaCacheEntry } from "../services/tauri";
import type { GameAppInfo } from "../services/gameCacheService";
import { loadGameAppInfoWithMediaFallback } from "../services/gameCacheService";
import { resolveGameMediaImageSrc } from "../services/localImageSrc";
import { enqueueMediaDownload, cancelMediaJobsForApp } from "../services/mediaDownloadQueue";
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
  const { selectedGame, setSelectedGame, appInfoMap } = useLibraryGames();
  const { settings } = useSettings();
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [resolvedGame, setResolvedGame] = useState<LibraryGame | null>(null);
  const [artwork, setArtwork] = useState<SgdbArtworkData | null>(null);
  const [mediaEntry, setMediaEntry] = useState<GameMediaCacheEntry | null>(null);
  const [canonicalAppInfo, setCanonicalAppInfo] = useState<GameAppInfo | null>(null);
  const [canonicalDiskFallback, setCanonicalDiskFallback] = useState<string | null>(null);
  const [localDetailsData, setLocalDetailsData] = useState<unknown>(null);
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

  // Load local cache (media cache + canonical appinfo + details/{appid}.json) immediately
  useEffect(() => {
    if (!selectedGame?.appId) {
      setMediaEntry(null);
      setCanonicalAppInfo(null);
      setCanonicalDiskFallback(null);
      setLocalDetailsData(null);
      return;
    }
    let cancelled = false;
    getMediaCacheForAppId(selectedGame.appId).then(setMediaEntry).catch(() => setMediaEntry(null));
    loadGameAppInfoWithMediaFallback(selectedGame.appId).then((info) => {
      if (!cancelled) {
        setCanonicalAppInfo(info);
        if (!info?.media?.landscapePath && !info?.media?.coverPath) {
          resolveGameMediaImageSrc(selectedGame.appId!).then((src) => {
            if (!cancelled && src) setCanonicalDiskFallback(src);
          }).catch(() => {});
        }
      }
    }).catch(() => { if (!cancelled) setCanonicalAppInfo(null); });
    getLibraryGameDetails(selectedGame.appId).then((entry) => {
      if (entry?.data) setLocalDetailsData(entry.data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedGame?.appId]);

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

  // Resolve artwork for this game via queue — cache-first, non-blocking
  // Uses ref-based tracking to prevent re-enqueue when canonicalAppInfo/mediaEntry update.
  const mediaEnqueuedRef = useRef(false);
  useEffect(() => {
    if (!resolvedGame?.appId) return;
    if (mediaEnqueuedRef.current) return;

    const appIdStr = resolvedGame.appId;
    const hasLandscape = !!canonicalAppInfo?.media?.landscapePath;
    const hasCover = !!canonicalAppInfo?.media?.coverPath;
    if (hasLandscape && hasCover) {
      mediaEnqueuedRef.current = true;
      return;
    }

    const sgdbEnabled = settings.steamGridDbArtworkEnabled && !!settings.steamGridDbApiKey;

    if (sgdbEnabled) {
      const appIdNum = Number(appIdStr);
      if (!appIdNum || isNaN(appIdNum)) return;

      mediaEnqueuedRef.current = true;
      const requestId = Date.now();
      artworkRequest.current = requestId;

      resolveArtworkForAppIds([appIdNum], settings.steamGridDbApiKey)
        .then((result) => {
          if (artworkRequest.current !== requestId) return;
          const entry = result[appIdStr];
          if (entry) {
            setArtwork(entry);
            const jobs: Array<{ mediaType: string; url?: string }> = [];
            if (!hasLandscape) {
              jobs.push({ mediaType: "landscape", url: entry.sgdbGridUrl || entry.sgdbGridThumbUrl || entry.sgdbHeroUrl });
            }
            if (!hasCover) {
              jobs.push({ mediaType: "cover", url: entry.sgdbCoverUrl });
            }
            for (const { mediaType, url } of jobs) {
              if (!url) continue;
              enqueueMediaDownload({
                id: `detail-sgdb-${appIdStr}-${mediaType}`,
                appId: appIdStr,
                provider: "steamgriddb",
                mediaType: mediaType as any,
                url,
                target: "canonical",
                priority: "high",
              }).catch(() => {});
            }
          }
        })
        .catch(() => {});
    } else {
      // No SGDB — fallback from store metadata URLs
      if (!hasLandscape) {
        const url = resolvedGame.metadata?.header_image || resolvedGame.metadata?.background_image;
        if (url) {
          mediaEnqueuedRef.current = true;
          enqueueMediaDownload({
            id: `detail-store-${appIdStr}-landscape`,
            appId: appIdStr,
            provider: "steam",
            mediaType: "landscape",
            url,
            target: "canonical",
            priority: "high",
          }).catch(() => {});
        }
      }
    }
  }, [resolvedGame, settings.steamGridDbArtworkEnabled, settings.steamGridDbApiKey]);

  // Lazy per-game stats refresh
  useEffect(() => {
    if (!resolvedGame || !resolvedGame.appId) return;
    const appIdNum = Number(resolvedGame.appId);
    if (!Number.isFinite(appIdNum)) return;

    loadSteamStats(settings.steamRoot || undefined, [appIdNum])
      .then((statsMap) => {
        const games = [resolvedGame];
        mergeSteamStatsIntoGames(games, statsMap);
        setResolvedGame({ ...games[0] });
      })
      .catch(() => { /* non-critical */ });
  }, [resolvedGame?.appId, settings.steamRoot]);

  const handleRefreshArtwork = useCallback(async () => {
    if (!selectedGame?.appId) {
      showWarning("No App ID available for this game.", { title: "Artwork" });
      return;
    }

    // Cancel any existing jobs for this app
    cancelMediaJobsForApp(selectedGame.appId);

    // Clear in-memory dedup state so downloads proceed
    const { clearMediaQueueState } = await import("../services/mediaDownloadQueue");
    clearMediaQueueState();

    const appIdStr = selectedGame.appId;
    const sgdbEnabled = settings.steamGridDbArtworkEnabled && !!settings.steamGridDbApiKey;

    if (sgdbEnabled) {
      const appIdNum = Number(appIdStr);
      if (!appIdNum || isNaN(appIdNum)) {
        showWarning("Invalid App ID.", { title: "Artwork" });
        return;
      }

      const { clearArtworkCache } = await import("../services/storeArtworkResolver");
      clearArtworkCache();

      // Clear local media so force-refresh works
      const { clearGameMediaCacheForGame } = await import("../services/libraryLocalCacheService");
      await clearGameMediaCacheForGame({ appId: appIdStr }).catch(() => {});

      const result = await resolveArtworkForAppIds([appIdNum], settings.steamGridDbApiKey);
      const entry = result[appIdStr];
      if (entry) {
        setArtwork(entry);
        const jobs: Array<{ mediaType: string; url?: string }> = [
          { mediaType: "landscape", url: entry.sgdbGridUrl || entry.sgdbGridThumbUrl || entry.sgdbHeroUrl },
          { mediaType: "cover", url: entry.sgdbCoverUrl },
        ];
        for (const { mediaType, url } of jobs) {
          if (!url) continue;
          enqueueMediaDownload({
            id: `refresh-${appIdStr}-${mediaType}-${Date.now()}`,
            appId: appIdStr,
            provider: "steamgriddb",
            mediaType: mediaType as any,
            url,
            target: "canonical",
            priority: "high",
            forceRefresh: true,
          }).catch(() => {});
        }
        showWarning("Artwork refresh queued.", { title: "Artwork" });
      } else {
        showWarning("No artwork found for this game.", { title: "Artwork" });
      }
    } else {
      showWarning("Enable SteamGridDB Artwork in Settings first.", { title: "Artwork" });
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
  const appInfoEntry = displayGame.appId ? (appInfoMap[displayGame.appId] ?? null) : null;
  const detailTitle = appInfoEntry?.name || displayGame.title || (displayGame.appId ? `Steam App ${displayGame.appId}` : "Unknown Game");

  return (
    <>
      <LibraryGameDetails
        game={displayGame}
        artwork={artwork}
        appInfoEntry={appInfoEntry}
        mediaEntry={mediaEntry}
        canonicalAppInfo={canonicalAppInfo}
        canonicalDiskFallback={canonicalDiskFallback}
        localDetailsData={localDetailsData}
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
        gameTitle={detailTitle}
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
