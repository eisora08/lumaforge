import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Gamepad2, Loader2, Play, Square, Sparkles, Store, XCircle } from "lucide-react";
import { getCachedSnapshot, subscribeSnapshotUpdated } from "../../services/startupSnapshotService";
import type { SnapshotGame } from "../../services/startupSnapshotService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useGameSession } from "../../context/GameSessionContext";
import { useFavorites } from "../../context/FavoritesContext";
import { getPlaytimeEntryByAppId, getPlaytimeSecondsForAppId, resolvePlaytimeKey, getPlaytimeEntryByGameKey } from "../../services/playtimeService";
import { resolveGameMediaUrl, resolveProviderMediaPreviewUrl, resolveDashboardTitles, isPendingUninstall, clearPendingUninstall, subscribePendingUninstall, getPendingUninstallVersion } from "../../services/gameCacheService";

const DEBUG_NAME_HERO = false;
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import { showInfo, showWarning } from "../toast/GameToast";
import { useDownloadQueueContext } from "../../context/DownloadQueueContext";
import AsyncImage from "../common/AsyncImage";
import StopGameModal from "../library/StopGameModal";
import type { AppPage } from "../../types/navigation";
import type { GameSessionState } from "../../context/GameSessionContext";

type GameHeroProps = {
  onNavigate?: (page: AppPage) => void;
};

type HeroGameResult = {
  game: SnapshotGame | null;
  sessionKey: string | null;
  /** When set, the hero is a manual LibraryGame (not in snapshot) */
  manualGame?: import("../../types/libraryGame").LibraryGame;
};

function formatElapsed(startedAt: number): string {
  const diff = Date.now() - startedAt;
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);

  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatLastPlayed(timestamp?: number | null): string | null {
  if (timestamp == null) return null;
  return new Date(timestamp * 1000).toLocaleDateString();
}

function hasValidMedia(game: SnapshotGame): boolean {
  const m = game.media;
  if (!m) return false;
  return !!(m.landscapePath || m.coverPath || m.backgroundPath || m.logoPath || m.iconPath);
}

function hasManualValidMedia(game: import("../../types/libraryGame").LibraryGame): boolean {
  return !!(game.imageUrl || game.iconPath);
}

function getEffectiveLastPlayedMs(game: SnapshotGame): number {
  const entry = getPlaytimeEntryByAppId(game.appId);
  if (entry?.lastPlayedAt) return entry.lastPlayedAt * 1000;
  if (game.lastPlayed) return game.lastPlayed * 1000;
  return 0;
}

function findHeroGame(
  snapshotGames: SnapshotGame[],
  sessionKeysByAppId: Record<string, string>,
  favoriteIds: Set<string>,
  manualGames: import("../../types/libraryGame").LibraryGame[],
): HeroGameResult {
  // Priority 1: Running session game (check both snapshot and manual)
  for (const [appId, key] of Object.entries(sessionKeysByAppId)) {
    const matchingGame = snapshotGames.find((g) => g.appId === appId);
    if (matchingGame) {
      return { game: matchingGame, sessionKey: key };
    }
    // Check manual games by id
    const matchingManual = manualGames.find((g) => g.id === appId);
    if (matchingManual) {
      return { game: null, sessionKey: key, manualGame: matchingManual };
    }
  }

  // Build playtime entries for manual games
  const manualPlaytime = new Map<string, { lastPlayedAt: number; totalSeconds: number }>();
  for (const mg of manualGames) {
    const ptKey = resolvePlaytimeKey(mg);
    const entry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
    if (entry) {
      manualPlaytime.set(mg.id, {
        lastPlayedAt: entry.lastPlayedAt ?? 0,
        totalSeconds: entry.totalPlaytimeSeconds,
      });
    }
  }

  // Priority 2: Most recently played game (snapshot + manual combined)
  const allWithPlaytime: Array<{ type: "snapshot" | "manual"; game: SnapshotGame | import("../../types/libraryGame").LibraryGame; lastPlayedMs: number }> = [];

  for (const g of snapshotGames) {
    if (g.appId && g.title) {
      const lp = getEffectiveLastPlayedMs(g);
      if (lp > 0) allWithPlaytime.push({ type: "snapshot", game: g, lastPlayedMs: lp });
    }
  }
  for (const mg of manualGames) {
    if (!mg.title) continue;
    const mp = manualPlaytime.get(mg.id);
    const lp = (mp?.lastPlayedAt ?? 0) * 1000;
    if (lp > 0) allWithPlaytime.push({ type: "manual", game: mg, lastPlayedMs: lp });
  }

  allWithPlaytime.sort((a, b) => b.lastPlayedMs - a.lastPlayedMs);
  if (allWithPlaytime.length > 0) {
    const top = allWithPlaytime[0];
    if (top.type === "snapshot") return { game: top.game as SnapshotGame, sessionKey: null };
    return { game: null, sessionKey: null, manualGame: top.game as import("../../types/libraryGame").LibraryGame };
  }

  // Priority 3: Most recent favorite with valid media (snapshot + manual)
  const favWithMedia: Array<{ type: "snapshot" | "manual"; game: SnapshotGame | import("../../types/libraryGame").LibraryGame; updatedAt: number }> = [];
  for (const g of snapshotGames) {
    if (g.appId && favoriteIds.has(g.appId) && hasValidMedia(g)) {
      favWithMedia.push({ type: "snapshot", game: g, updatedAt: g.updatedAt ?? 0 });
    }
  }
  for (const mg of manualGames) {
    const favKey = mg.libraryId || mg.id;
    if (favoriteIds.has(favKey) && hasManualValidMedia(mg)) {
      favWithMedia.push({ type: "manual", game: mg, updatedAt: 0 });
    }
  }
  favWithMedia.sort((a, b) => b.updatedAt - a.updatedAt);
  if (favWithMedia.length > 0) {
    const top = favWithMedia[0];
    if (top.type === "snapshot") return { game: top.game as SnapshotGame, sessionKey: null };
    return { game: null, sessionKey: null, manualGame: top.game as import("../../types/libraryGame").LibraryGame };
  }

  // Priority 4: Most recent game with valid media
  const withMedia: Array<{ type: "snapshot" | "manual"; game: SnapshotGame | import("../../types/libraryGame").LibraryGame; updatedAt: number }> = [];
  for (const g of snapshotGames) {
    if (g.appId && g.title && hasValidMedia(g)) {
      withMedia.push({ type: "snapshot", game: g, updatedAt: g.updatedAt ?? 0 });
    }
  }
  for (const mg of manualGames) {
    if (mg.title && hasManualValidMedia(mg)) {
      withMedia.push({ type: "manual", game: mg, updatedAt: 0 });
    }
  }
  withMedia.sort((a, b) => b.updatedAt - a.updatedAt);
  if (withMedia.length > 0) {
    const top = withMedia[0];
    if (top.type === "snapshot") return { game: top.game as SnapshotGame, sessionKey: null };
    return { game: null, sessionKey: null, manualGame: top.game as import("../../types/libraryGame").LibraryGame };
  }

  // Priority 5: First installed game with title
  const installedGame = snapshotGames.find((game) => game.installed && game.title);
  if (installedGame) {
    return { game: installedGame, sessionKey: null };
  }

  // Manual games are always "installed"
  if (manualGames.length > 0 && manualGames[0].title) {
    return { game: null, sessionKey: null, manualGame: manualGames[0] };
  }

  // Priority 6: Stable fallback — first game with a title
  const titledGame = snapshotGames.find((game) => game.title);
  if (titledGame) {
    return { game: titledGame, sessionKey: null };
  }

  // Last resort
  return {
    game: snapshotGames[0] || null,
    sessionKey: null,
  };
}

function EmptyHero({ onNavigate }: GameHeroProps) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-(--surface-active-border) bg-gradient-to-br from-(--color-accent)/10 via-purple-900/20 to-black">
      <div className="relative z-10 flex flex-col items-center justify-center px-8 py-20 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-4 py-1.5 text-xs text-(--color-accent)">
          <Sparkles className="h-3.5 w-3.5" />
          LumaForge
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-(--color-text)">
          Your Game Launcher
        </h1>

        <p className="mt-2 max-w-lg text-sm text-(--color-muted)">
          Discover, manage, and play your games with Lua modding support.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => onNavigate?.("store")}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-5 py-3 text-sm font-medium text-black transition hover:opacity-90"
          >
            <Store className="h-4 w-4" />
            Browse Store
          </button>

          <button
            onClick={() => onNavigate?.("library")}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/6 px-5 py-3 text-sm text-(--color-text) backdrop-blur-xl transition hover:bg-white/10"
          >
            <Gamepad2 className="h-4 w-4" />
            Open Library
          </button>
        </div>
      </div>
    </section>
  );
}

export default function GameHero({ onNavigate }: GameHeroProps) {
  const snapshot = getCachedSnapshot();
  const [, setSnapshotWriteVersion] = useState(0);

  // Re-read snapshot after background snapshot writes (playtime/lastPlayed updates)
  useEffect(() => {
    const unsub = subscribeSnapshotUpdated(() => setSnapshotWriteVersion(v => v + 1));
    return unsub;
  }, []);

  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { favoriteIds } = useFavorites();

  const {
    sessions,
    getState,
    getSession,
    stopSession,
    clearSession,
    findGameProcessForSession,
  } = useGameSession();

  const [elapsed, setElapsed] = useState("");
  const [showStopModal, setShowStopModal] = useState(false);

  const snapshotGames = useMemo(() => {
    return snapshot?.library?.games ?? [];
  }, [snapshot]);

  const manualGames = useMemo(
    () => libraryGames.filter((g) => g.source === "manual" && g.title),
    [libraryGames],
  );

  // Build a map of appId → sessionKey for all active sessions
  const sessionKeysByAppId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [key, s] of Object.entries(sessions)) {
      if (s.appId && (s.state === "running" || s.state === "stopping" || s.state === "launching")) {
        map[s.appId] = key;
      }
    }
    return map;
  }, [sessions]);

  const { game: heroGame, sessionKey, manualGame: heroManualGame } = useMemo(() => {
    return findHeroGame(snapshotGames, sessionKeysByAppId, favoriteIds, manualGames);
  }, [snapshotGames, sessionKeysByAppId, favoriteIds, manualGames]);

  // Read session state from the single source of truth
  const heroGameState: GameSessionState = sessionKey ? getState(sessionKey) : "idle";
  const heroSession = sessionKey ? getSession(sessionKey) : undefined;

  const isRunning = heroGameState === "running";
  const isStopping = heroGameState === "stopping";
  const isLaunching = heroGameState === "launching";
  const hasActiveSession = isRunning || isStopping || isLaunching;

  const heroAppId = heroGame?.appId;
  const { getJobByAppId } = useDownloadQueueContext();
  const heroInstallJob = heroAppId ? getJobByAppId(heroAppId) : undefined;
  const activeInstallStatuses = ["queued", "waiting", "checking", "downloading", "extracting", "installing", "paused"];
  const hasActiveInstall = heroInstallJob?.type === "steam-install" && activeInstallStatuses.includes(heroInstallJob.status);
  // Subscribe to pending uninstall state changes so React re-renders when the module-level Map changes
  useSyncExternalStore(subscribePendingUninstall, getPendingUninstallVersion, getPendingUninstallVersion);
  const heroPendingUninstall = heroAppId ? isPendingUninstall(heroAppId) : false;

  // Diagnostic logs — once per selection change
  const prevHeroRef = useRef<string | null>(null);
  const prevRunningRef = useRef<string | null>(null);

  useEffect(() => {
    const displayId = heroManualGame?.libraryId || heroAppId;
    const reason = sessionKey
      ? "running-session"
      : (heroGame && getEffectiveLastPlayedMs(heroGame) > 0
        ? "last-played"
        : (heroManualGame
          ? "manual-game"
          : (heroGame && heroGame.appId && favoriteIds.has(heroGame.appId)
            ? "favorite"
            : (heroGame && hasValidMedia(heroGame)
              ? "valid-media"
              : (heroGame?.installed
                ? "installed"
                : (heroGame?.title
                  ? "titled-fallback"
                  : "last-resort"))))));
    if (prevHeroRef.current !== displayId) {
      prevHeroRef.current = displayId || null;
      console.log(`[DASH][HERO_SELECT] running=${displayId && sessionKey ? displayId : null} selected=${displayId || "empty"} reason=${reason}`);
    }
  }, [heroAppId, heroGame, sessionKey, favoriteIds, heroManualGame]);

  useEffect(() => {
    const displayId = heroManualGame?.libraryId || heroAppId;
    if (isRunning && displayId) {
      if (prevRunningRef.current !== displayId) {
        console.log(`[DASH][HERO_RUNNING] appid=${displayId} running=true focused=true`);
      }
      prevRunningRef.current = displayId;
    }
    if (!isRunning && prevRunningRef.current != null) {
      const wasAppId = prevRunningRef.current;
      console.log(`[DASH][HERO_CLEAR_RUNNING] appid=${wasAppId} reason=process-ended`);
      prevRunningRef.current = null;
    }
    if (!isRunning && !displayId) {
      prevRunningRef.current = null;
    }
  }, [isRunning, heroAppId, heroManualGame]);

  const libGame = useMemo(() => {
    if (heroManualGame) return heroManualGame;
    if (!heroAppId) return undefined;
    return libraryGames.find((game) => game.appId === heroAppId);
  }, [libraryGames, heroAppId, heroManualGame]);

  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [heroTitle, setHeroTitle] = useState<string>("");
  useEffect(() => {
    let cancelled = false;

    if (heroManualGame) {
      // Manual game: resolve background via provider media
      const rawBg = heroManualGame.imageUrl;
      if (rawBg) {
        resolveProviderMediaPreviewUrl(rawBg).then((url) => {
          if (!cancelled) setBgUrl(url);
        });
      } else {
        setBgUrl(null);
      }
      setHeroTitle(heroManualGame.title);
      return () => { cancelled = true; };
    }

    // Snapshot game
    const bgPath = heroGame?.media?.backgroundPath || heroGame?.media?.landscapePath;
    if (!bgPath || !heroAppId) { setBgUrl(null); return; }
    resolveGameMediaUrl(heroAppId, bgPath).then((url) => {
      if (!cancelled) setBgUrl(url);
    });
    if (heroAppId && heroGame) {
      resolveDashboardTitles([heroGame]).then((r: Record<string, { title: string; source: string }>) => {
        if (!cancelled) {
          const entry = r[heroAppId!];
          const resolved = entry?.title;
          setHeroTitle(resolved ?? heroGame!.title);
          if (DEBUG_NAME_HERO) console.log(`[NAME][HERO] appid=${heroAppId} source=${entry?.source ?? "snapshot"} title=${resolved ?? heroGame!.title}`);
        }
      });
    }
    return () => { cancelled = true; };
  }, [heroGame, heroAppId, heroManualGame]);

  const lastPlayedStr = useMemo(() => {
    // For manual games, look up playtime by game key
    if (heroManualGame) {
      const ptKey = resolvePlaytimeKey(heroManualGame);
      const entry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
      if (entry?.lastPlayedAt) return formatLastPlayed(entry.lastPlayedAt);
      return null;
    }
    const entry = getPlaytimeEntryByAppId(heroAppId);
    if (entry?.lastPlayedAt) return formatLastPlayed(entry.lastPlayedAt);
    return formatLastPlayed(heroGame?.lastPlayed);
  }, [heroAppId, heroGame?.lastPlayed, heroManualGame]);

  const heroPlaytimeStr = useMemo(() => {
    if (heroManualGame) {
      const ptKey = resolvePlaytimeKey(heroManualGame);
      const entry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
      const seconds = entry?.totalPlaytimeSeconds ?? 0;
      if (seconds > 0) return `${Math.round(seconds / 60)} min`;
      return null;
    }
    const seconds = getPlaytimeSecondsForAppId(heroAppId);
    if (seconds > 0) return `${Math.round(seconds / 60)} min`;
    if (heroGame?.playtime != null) return `${heroGame.playtime} min`;
    return null;
  }, [heroAppId, heroGame?.playtime, heroManualGame]);

  const stopModalTitle = heroSession?.title || heroGame?.title || "Unknown Game";

  // Elapsed timer (only when session is running)
  useEffect(() => {
    if (!isRunning || !heroSession?.launchedAt) {
      setElapsed("");
      return;
    }

    setElapsed(formatElapsed(heroSession.launchedAt));

    const interval = window.setInterval(() => {
      setElapsed(formatElapsed(heroSession.launchedAt!));
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isRunning, heroSession?.launchedAt]);

  // HERO priority: load game data at highest priority immediately
  useEffect(() => {
    if (heroAppId) {
      void requestGameData(heroAppId, LoadPriority.HERO);
    }
  }, [heroAppId]);

  const handlePrimaryAction = useCallback(() => {
    if (!heroGame) return;

    if (isRunning && libGame) {
      setSelectedGame(libGame);
      onNavigate?.("library-game-detail");
      return;
    }

    if (libGame) {
      setSelectedGame(libGame);
      onNavigate?.("library-game-detail");
      return;
    }

    if (heroGame.appId) {
      onNavigate?.("store");
    }
  }, [heroGame, isRunning, libGame, setSelectedGame, onNavigate]);

  const handleOpenStopModal = useCallback(() => {
    if (!sessionKey) return;
    setShowStopModal(true);
  }, [sessionKey]);

  const handleCloseStopModal = useCallback(() => {
    setShowStopModal(false);
  }, []);

  const handleConfirmStop = useCallback(async () => {
    setShowStopModal(false);
    if (sessionKey) {
      await stopSession(sessionKey);
    }
  }, [sessionKey, stopSession]);

  const handleMarkAsStopped = useCallback(() => {
    setShowStopModal(false);
    if (sessionKey) {
      clearSession(sessionKey);
    }
  }, [sessionKey, clearSession]);

  const handleFindProcess = useCallback(async () => {
    if (!sessionKey) return;
    const candidate = await findGameProcessForSession(sessionKey);
    if (candidate) {
      showWarning(`Found process: ${candidate.name} (PID ${candidate.pid})`, {
        title: "Process Found",
      });
      return;
    }
    showWarning("Could not find the game process automatically.", {
      title: "Not Found",
    });
  }, [sessionKey, findGameProcessForSession]);

  if (!heroGame && !heroManualGame) {
    return <EmptyHero onNavigate={onNavigate} />;
  }

  return (
    <section className="relative min-h-[300px] overflow-hidden rounded-2xl border border-(--surface-active-border) sm:min-h-[340px]">
      {bgUrl ? (
        <div className="absolute inset-0">
          <AsyncImage
            src={bgUrl}
            alt=""
            className="h-full w-full"
            fallback={
              <div className="h-full w-full bg-gradient-to-br from-(--color-accent)/20 via-purple-900/30 to-black" />
            }
          />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-(--color-accent)/20 via-purple-900/30 to-black" />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30" />

      {!hasActiveSession && (
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
      )}

      <div className="relative z-10 flex min-h-[300px] items-end px-6 pb-8 pt-16 sm:min-h-[340px] sm:px-8">
        <div className="flex-1">
          <div className="mb-3 flex items-center gap-3">
            {isRunning ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-300 backdrop-blur-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  Running
                </span>
                {elapsed && (
                  <span className="text-xs text-white/60">
                    {elapsed} elapsed
                  </span>
                )}
              </>
            // ) : isStopping ? (
            //   <>
            //     <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-300 backdrop-blur-sm">
            //       <Loader2 className="h-3 w-3 animate-spin" />
            //       Stopping...
            //     </span>
            //   </>
            // ) : isLaunching ? (
            //   <>
            //     <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-300 backdrop-blur-sm">
            //       <Loader2 className="h-3 w-3 animate-spin" />
            //       Launching...
            //     </span>
            //   </>
            ) : (
              <>
                {/* {heroGame.installed && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-300 backdrop-blur-sm">
                    Installed
                  </span>
                )} */}
                {lastPlayedStr && (
                  <span className="text-xs text-white/60">
                    Last played: {lastPlayedStr}
                  </span>
                )}
                {heroPlaytimeStr && (
                  <span className="text-xs text-white/60">
                    {heroPlaytimeStr}
                  </span>
                )}
              </>
            )}
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-lg sm:text-3xl">
            {heroTitle || heroGame?.title}
          </h1>

          <div className="mt-5 flex flex-wrap gap-3">
            {isStopping ? (
              <>
                <button
                  disabled
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-black opacity-60 transition"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Stopping...
                </button>
                <span className="inline-flex items-center gap-1 text-xs text-(--color-muted)">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Stopping...
                </span>
              </>
            ) : isLaunching ? (
              <>
                <button
                  disabled
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-black opacity-60 transition"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Launching...
                </button>
              </>
            ) : isRunning ? (
              <>
                <button
                  onClick={handlePrimaryAction}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97]"
                >
                  <Play className="h-4 w-4" />
                  Focus Game
                </button>
                <button
                  onClick={handleOpenStopModal}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-red-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-red-500/80 active:scale-[0.97]"
                >
                  <Square className="h-4 w-4" />
                  Stop
                </button>
              </>
            ) : heroPendingUninstall ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-2 rounded-xl bg-amber-500/10 px-5 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                  <span className="text-sm font-medium text-amber-400">Uninstalling…</span>
                </div>
                <button
                  onClick={() => {
                    if (!heroAppId) return;
                    console.log(`[UNINSTALL_PENDING] appid=${heroAppId} phase=manual-cancel before=${isPendingUninstall(heroAppId)}`);
                    clearPendingUninstall(heroAppId);
                    showInfo(`"${heroTitle || heroGame?.title || heroAppId}" uninstall tracking cancelled.`);
                    console.log(`[UNINSTALL_PENDING] appid=${heroAppId} phase=manual-cancel after=${isPendingUninstall(heroAppId)}`);
                  }}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-(--color-muted) transition hover:bg-white/5"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Cancel tracking
                </button>
              </div>
            ) : hasActiveInstall ? (
              <div className="inline-flex items-center gap-2 rounded-xl bg-amber-500/10 px-5 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                <span className="text-sm font-medium text-amber-400">
                  {heroInstallJob.status === "waiting" || heroInstallJob.status === "queued"
                    ? "Waiting for Steam\u2026"
                    : heroInstallJob.status === "downloading"
                      ? "Downloading"
                      : "Installing\u2026"}
                </span>
              </div>
            ) : heroGame?.playable ? (
              <>
                <button
                  onClick={handlePrimaryAction}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97]"
                >
                  <Play className="h-4 w-4" />
                  Play
                </button>
                <button
                  onClick={() => onNavigate?.("store")}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/6 px-5 py-3 text-sm text-white/80 backdrop-blur-sm transition hover:bg-white/10"
                >
                  <Store className="h-4 w-4" />
                  Browse Store
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handlePrimaryAction}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white/10 px-6 py-3 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/20"
                >
                  Open Details
                </button>
                <button
                  onClick={() => onNavigate?.("store")}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/6 px-5 py-3 text-sm text-white/80 backdrop-blur-sm transition hover:bg-white/10"
                >
                  <Store className="h-4 w-4" />
                  Browse Store
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <StopGameModal
        open={showStopModal}
        gameTitle={stopModalTitle}
        canTerminate={!!heroSession?.pid}
        isSoftSession={heroSession?.softSession ?? true}
        trackingConfidence={heroSession?.trackingConfidence}
        onClose={handleCloseStopModal}
        onConfirmStop={handleConfirmStop}
        onMarkStopped={handleMarkAsStopped}
        onFindProcess={handleFindProcess}
      />
    </section>
  );
}