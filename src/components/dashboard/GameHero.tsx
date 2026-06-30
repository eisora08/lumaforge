import { useCallback, useEffect, useMemo, useState } from "react";
import { Gamepad2, Play, Square, Sparkles, Store } from "lucide-react";
import { getCachedSnapshot } from "../../services/startupSnapshotService";
import type { SnapshotGame } from "../../services/startupSnapshotService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useGameSession } from "../../context/GameSessionContext";
import { localPathToUrl } from "../../services/gameCacheService";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import { showWarning } from "../toast/GameToast";
import AsyncImage from "../common/AsyncImage";
import StopGameModal from "../library/StopGameModal";
import type { AppPage } from "../../types/navigation";

type GameHeroProps = {
  onNavigate?: (page: AppPage) => void;
};

type GameSession = {
  appId?: string;
  state: string;
  launchedAt?: number;
  gameKey?: string;
  title?: string;
  pid?: number;
  softSession?: boolean;
  trackingConfidence?: string;
};

type HeroGameResult = {
  game: SnapshotGame | null;
  isRunning: boolean;
  session?: GameSession;
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
  sessions: Record<string, GameSession>,
): HeroGameResult {
  const runningEntry = Object.entries(sessions).find(
    ([, session]) => session.state === "running",
  );

  if (runningEntry) {
    const [runningKey, runningSession] = runningEntry;

    if (runningSession?.appId) {
      const runningGame = snapshotGames.find(
        (game) => game.appId === runningSession.appId,
      );

      if (runningGame) {
        return {
          game: runningGame,
          isRunning: true,
          session: {
            ...runningSession,
            gameKey: runningKey,
          },
        };
      }
    }
  }

  const lastPlayedGame = [...snapshotGames]
    .filter((game) => game.lastPlayed)
    .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0];

  if (lastPlayedGame) {
    return {
      game: lastPlayedGame,
      isRunning: false,
    };
  }

  const installedGame = snapshotGames.find((game) => game.installed);

  if (installedGame) {
    return {
      game: installedGame,
      isRunning: false,
    };
  }

  return {
    game: snapshotGames[0] || null,
    isRunning: false,
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
    stopSession,
    clearSession,
    findGameProcessForSession,
  } = useGameSession();

  const [elapsed, setElapsed] = useState("");
  const [showStopModal, setShowStopModal] = useState(false);
  const [stopGameKey, setStopGameKey] = useState("");

  const snapshotGames = useMemo(() => {
    return snapshot?.library?.games ?? [];
  }, [snapshot]);

  const {
    game: heroGame,
    isRunning,
    session: runningSession,
  } = useMemo(() => {
    return findHeroGame(snapshotGames, sessions);
  }, [snapshotGames, sessions]);

  const heroAppId = heroGame?.appId;

  const libGame = useMemo(() => {
    if (!heroAppId) return undefined;
    return libraryGames.find((game) => game.appId === heroAppId);
  }, [libraryGames, heroAppId]);

  const bgUrl = useMemo(() => {
    const bgPath =
      heroGame?.media?.backgroundPath || heroGame?.media?.landscapePath;

    return bgPath ? localPathToUrl(bgPath) : null;
  }, [heroGame]);

  const lastPlayedStr = useMemo(() => {
    return formatLastPlayed(heroGame?.lastPlayed);
  }, [heroGame?.lastPlayed]);

  const isRunningSession = Boolean(isRunning && runningSession);

  const currentSession = stopGameKey ? sessions[stopGameKey] : undefined;

  const stopModalTitle =
    currentSession?.title || heroGame?.title || "Unknown Game";

  useEffect(() => {
    if (!isRunning || !runningSession?.launchedAt) {
      setElapsed("");
      return;
    }

    setElapsed(formatElapsed(runningSession.launchedAt));

    const interval = window.setInterval(() => {
      setElapsed(formatElapsed(runningSession.launchedAt!));
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isRunning, runningSession?.launchedAt]);

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
    if (!runningSession?.gameKey) return;

    setStopGameKey(runningSession.gameKey);
    setShowStopModal(true);
  }, [runningSession?.gameKey]);

  const handleCloseStopModal = useCallback(() => {
    setShowStopModal(false);
  }, []);

  const handleConfirmStop = useCallback(async () => {
    setShowStopModal(false);

    if (stopGameKey) {
      await stopSession(stopGameKey);
    }
  }, [stopGameKey, stopSession]);

  const handleMarkAsStopped = useCallback(() => {
    setShowStopModal(false);

    if (stopGameKey) {
      clearSession(stopGameKey);
    }
  }, [stopGameKey, clearSession]);

  const handleFindProcess = useCallback(async () => {
    if (!stopGameKey) return;

    const candidate = await findGameProcessForSession(stopGameKey);

    if (candidate) {
      showWarning(`Found process: ${candidate.name} (PID ${candidate.pid})`, {
        title: "Process Found",
      });
      return;
    }

    showWarning("Could not find the game process automatically.", {
      title: "Not Found",
    });
  }, [stopGameKey, findGameProcessForSession]);

  // ✅ Return condicional DESPUÉS de todos los hooks
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

      {!isRunningSession && (
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
      )}

      <div className="relative z-10 flex min-h-[300px] items-end px-6 pb-8 pt-16 sm:min-h-[340px] sm:px-8">
        <div className="flex-1">
          <div className="mb-3 flex items-center gap-3">
            {isRunningSession ? (
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
            ) : (
              <>
                {heroGame.installed && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-300 backdrop-blur-sm">
                    Installed
                  </span>
                )}

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
            {heroGame.title}
          </h1>

          <div className="mt-5 flex flex-wrap gap-3">
            {isRunningSession ? (
              <button
                onClick={handlePrimaryAction}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97]"
              >
                <Play className="h-4 w-4" />
                Focus Game
              </button>
            ) : heroGame.playable ? (
              <button
                onClick={handlePrimaryAction}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97]"
              >
                <Play className="h-4 w-4" />
                Play
              </button>
            ) : (
              <button
                onClick={handlePrimaryAction}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white/10 px-6 py-3 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/20"
              >
                Open Details
              </button>
            )}

            {isRunningSession ? (
              <button
                onClick={handleOpenStopModal}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-red-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-red-500/80 active:scale-[0.97]"
              >
                <Square className="h-4 w-4" />
                Stop
              </button>
            ) : (
              <button
                onClick={() => onNavigate?.("store")}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/6 px-5 py-3 text-sm text-white/80 backdrop-blur-sm transition hover:bg-white/10"
              >
                <Store className="h-4 w-4" />
                Browse Store
              </button>
            )}
          </div>
        </div>
      </div>

      <StopGameModal
        open={showStopModal}
        gameTitle={stopModalTitle}
        canTerminate={!!currentSession?.pid}
        isSoftSession={currentSession?.softSession ?? true}
        trackingConfidence={currentSession?.trackingConfidence}
        onClose={handleCloseStopModal}
        onConfirmStop={handleConfirmStop}
        onMarkStopped={handleMarkAsStopped}
        onFindProcess={handleFindProcess}
      />
    </section>
  );
}