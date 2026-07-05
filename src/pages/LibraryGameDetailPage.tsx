import { useCallback, useEffect, useRef, useState } from "react";
import { countRender } from "../services/perfCounters";
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
import { loadGameAppInfoWithMediaFallback, resolveCanonicalDisplayTitle } from "../services/gameCacheService";
import { resolveGameMediaImageSrc } from "../services/localImageSrc";
import { enqueueMediaDownload, cancelMediaJobsForApp } from "../services/mediaDownloadQueue";
import LibraryGameDetails from "../components/library/LibraryGameDetails";
import StopGameModal from "../components/library/StopGameModal";
import { useSettings } from "../context/SettingsContext";
import { useGameSession, computeGameKey } from "../context/GameSessionContext";
import { useGameLaunchState } from "../hooks/useGameLaunchState";
import { useGameActivity } from "../context/GameActivityContext";
import { useGamePlayStats } from "../services/gamePlayStats";
import { importExternalPlaytime } from "../services/playtimeService";

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
  countRender("LibraryGameDetailPage");
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
  const prevRunningRef = useRef(false);
  const _prevAppIdRef = useRef<string | null>(null);

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
    setShowStopModal(false);
    await session.stopSession(gameKey);
  }

  function handleMarkAsStopped() {
    setShowStopModal(false);
    session.clearSession(gameKey);
  }

  function handleOpenStopModal() {
    setShowStopModal(true);
  }

  async function handleFindProcess() {
    const candidate = await session.findGameProcessForSession(gameKey);
    if (candidate) {
      showWarning(`Found process: ${candidate.name} (PID ${candidate.pid})`, { title: "Process found" });
    } else {
      showWarning("Could not find the game process automatically.", { title: "No process found" });
    }
  }

  // Load local cache (media cache + canonical appinfo + details/{appid}.json) immediately
  // Clear ALL state on any appId change to prevent stale cross-appId data during async fetch.
  useEffect(() => {
    // Cancel pending media downloads for any previously-active appId
    if (_prevAppIdRef.current) {
      cancelMediaJobsForApp(_prevAppIdRef.current);
    }
    _prevAppIdRef.current = selectedGame?.appId ?? null;
    setMediaEntry(null);
    setCanonicalAppInfo(null);
    setCanonicalDiskFallback(null);
    setLocalDetailsData(null);

    if (!selectedGame?.appId) return;

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

  // Check if media files actually exist on disk — if not, queue targeted repair
  // Resets when appId changes so a new game gets its own repair check.
  const mediaCheckDoneRef = useRef(false);
  useEffect(() => {
    mediaCheckDoneRef.current = false;
  }, [selectedGame?.appId]);
  useEffect(() => {
    if (!resolvedGame?.appId) return;
    if (mediaCheckDoneRef.current) return;
    mediaCheckDoneRef.current = true;

    const appIdStr = resolvedGame.appId;

    // Check actual files on disk (not just appinfo paths)
    const checkMedia = async () => {
      const { detectAndQueueMissingMedia } = await import("../services/gameCacheService");
      const queued = await detectAndQueueMissingMedia(appIdStr);
      if (queued.length > 0) {
        console.log(`[MEDIA][DETAILS_REPAIR] appid=${appIdStr} missing=${queued.join(",")} queued=true`);
      }
    };
    checkMedia();
  }, [resolvedGame, canonicalAppInfo?.media?.landscapePath, canonicalAppInfo?.media?.coverPath, canonicalAppInfo?.media?.backgroundPath, canonicalAppInfo?.media?.logoPath, canonicalAppInfo?.media?.iconPath]);

  // Lazy per-game stats refresh
  useEffect(() => {
    if (!resolvedGame || !resolvedGame.appId) return;
    const appIdNum = Number(resolvedGame.appId);
    if (!Number.isFinite(appIdNum)) return;

    loadSteamStats(settings.steamRoot || undefined, [appIdNum], { forceRefresh: true })
      .then((statsMap) => {
        const stat = statsMap.get(appIdNum);
        if (resolvedGame.appId === "268910") {
          console.log(`[ACTIVITY][TRACE_STEAM_STATS] appid=268910 statFound=${!!stat} lastPlayed=${stat?.lastPlayed ?? "null"} playtimeMinutes=${stat?.playtimeMinutes ?? "null"}`);
          console.log(`[ACTIVITY][TRACE_SQLITE] appid=268910 preMergeSteamLastPlayed=${resolvedGame.steamLastPlayedAt ?? "null"} steamPlaytimeMinutes=${resolvedGame.steamPlaytimeMinutes ?? "null"}`);
        }
        const games = [resolvedGame];
        mergeSteamStatsIntoGames(games, statsMap);
        setResolvedGame({ ...games[0] });
        if (resolvedGame.appId === "268910") {
          console.log(`[ACTIVITY][TRACE_STEAM_STATS] appid=268910 postMergeSteamLastPlayed=${games[0].steamLastPlayedAt ?? "null"} postMergeSteamPlaytimeMinutes=${games[0].steamPlaytimeMinutes ?? "null"}`);
        }

        // Import Steam playtime when available
        if (stat?.playtimeMinutes && stat.playtimeMinutes > 0) {
          if (resolvedGame.appId === "268910") {
            console.log(`[ACTIVITY][TRACE_PLAYTIME_IMPORT] appid=268910 playtimeMinutes=${stat.playtimeMinutes} calling importExternalPlaytime`);
          }
          importExternalPlaytime({
            gameKey: `app-${resolvedGame.appId}`,
            appId: resolvedGame.appId,
            provider: "steam",
            title: resolvedGame.title,
            externalPlaytimeSeconds: stat.playtimeMinutes * 60,
            externalSource: "steam",
          }).catch(() => { /* non-critical */ });
        }
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

    // Clear session cache so next load picks up fresh files from disk
    const { clearResolvedMediaSessionCache, resetRepairedAppInfoIds } = await import("../services/gameCacheService");
    clearResolvedMediaSessionCache();
    resetRepairedAppInfoIds();

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
          { mediaType: "background", url: entry.sgdbHeroUrl },
          { mediaType: "logo", url: entry.sgdbLogoUrl },
          { mediaType: "icon", url: entry.sgdbIconUrl },
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
  const detailTitle = resolveCanonicalDisplayTitle(
    displayGame.appId ?? "",
    displayGame,
    appInfoEntry,
    canonicalAppInfo,
  );

  // Disabled by default. Set window.__DEBUG_NAME_TRACE = true in dev console to enable.
  if ((window as any).__DEBUG_NAME_TRACE) {
    console.log(`[NAME][DISPLAY] appid=${displayGame.appId} title=${detailTitle}`);
  }

  return (
    <>
      <LibraryGameDetails
        key={"library:game-details:steam:" + displayGame.appId}
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
