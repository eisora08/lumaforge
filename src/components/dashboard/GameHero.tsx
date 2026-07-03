import { useCallback, useEffect, useMemo, useState } from "react";
import { Gamepad2, Loader2, Play, Square, Sparkles, Store } from "lucide-react";
import { getCachedSnapshot } from "../../services/startupSnapshotService";
import type { SnapshotGame } from "../../services/startupSnapshotService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useGameSession } from "../../context/GameSessionContext";
import { resolveGameMediaUrl, resolveCanonicalDisplayTitle } from "../../services/gameCacheService";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import { showWarning } from "../toast/GameToast";
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

function findHeroGame(
  snapshotGames: SnapshotGame[],
  sessionKeysByAppId: Record<string, string>,
): HeroGameResult {
  // Priority 1: Find a game that has a running session
  for (const [appId, key] of Object.entries(sessionKeysByAppId)) {
    const matchingGame = snapshotGames.find((g) => g.appId === appId);
    if (matchingGame) {
      return { game: matchingGame, sessionKey: key };
    }
  }

  // Priority 2: Last played game
  const lastPlayedGame = [...snapshotGames]
    .filter((game) => game.lastPlayed)
    .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0];

  if (lastPlayedGame) {
    return { game: lastPlayedGame, sessionKey: null };
  }

  // Priority 3: First installed game
  const installedGame = snapshotGames.find((game) => game.installed);
  if (installedGame) {
    return { game: installedGame, sessionKey: null };
  }

  // Priority 4: First available game
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

  const { games: libraryGames, setSelectedGame } = useLibraryGames();

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

  const { game: heroGame, sessionKey } = useMemo(() => {
    return findHeroGame(snapshotGames, sessionKeysByAppId);
  }, [snapshotGames, sessionKeysByAppId]);

  // Read session state from the single source of truth
  const heroGameState: GameSessionState = sessionKey ? getState(sessionKey) : "idle";
  const heroSession = sessionKey ? getSession(sessionKey) : undefined;

  const isRunning = heroGameState === "running";
  const isStopping = heroGameState === "stopping";
  const isLaunching = heroGameState === "launching";
  const hasActiveSession = isRunning || isStopping || isLaunching;

  const heroAppId = heroGame?.appId;

  const libGame = useMemo(() => {
    if (!heroAppId) return undefined;
    return libraryGames.find((game) => game.appId === heroAppId);
  }, [libraryGames, heroAppId]);

  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [heroTitle, setHeroTitle] = useState<string>("");
  useEffect(() => {
    const bgPath = heroGame?.media?.backgroundPath || heroGame?.media?.landscapePath;
    if (!bgPath || !heroAppId) { setBgUrl(null); return; }
    let cancelled = false;
    resolveGameMediaUrl(heroAppId, bgPath).then((url) => {
      if (!cancelled) setBgUrl(url);
    });
    if (heroAppId && heroGame) {
      setHeroTitle(resolveCanonicalDisplayTitle(heroAppId, heroGame));
    }
    const selection = heroGame?.media?.backgroundPath ? "background" : "landscape";
    console.log(`[MEDIA][HERO] appid=${heroAppId} selected=${selection} bgExists=${!!bgPath} title=${heroTitle || heroGame?.title}`);
    return () => { cancelled = true; };
  }, [heroGame, heroAppId]);

  const lastPlayedStr = useMemo(() => {
    return formatLastPlayed(heroGame?.lastPlayed);
  }, [heroGame?.lastPlayed]);

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

  if (!heroGame || !heroGame.appId) {
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
                {heroGame.playtime != null && (
                  <span className="text-xs text-white/60">
                    {heroGame.playtime} min
                  </span>
                )}
              </>
            )}
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-lg sm:text-3xl">
            {heroTitle || heroGame.title}
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
            ) : heroGame.playable ? (
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