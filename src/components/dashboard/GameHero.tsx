import { useMemo } from "react";
import { Gamepad2, Play, Sparkles, Store } from "lucide-react";
import { getCachedSnapshot } from "../../services/startupSnapshotService";
import type { SnapshotGame } from "../../services/startupSnapshotService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useGameSession } from "../../context/GameSessionContext";
import { localPathToUrl } from "../../services/gameCacheService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";

type GameHeroProps = {
  onNavigate?: (page: AppPage) => void;
};

function findHeroGame(
  snapshotGames: SnapshotGame[],
  sessions: Record<string, { appId?: string; state: string }>,
): SnapshotGame | null {
  const running = Object.values(sessions).find((s) => s.state === "running");
  if (running?.appId) {
    const match = snapshotGames.find((g) => g.appId === running.appId);
    if (match) return match;
  }

  const withLastPlayed = snapshotGames
    .filter((g) => g.lastPlayed)
    .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  if (withLastPlayed.length > 0) return withLastPlayed[0];

  const installed = snapshotGames.find((g) => g.installed);
  if (installed) return installed;

  return snapshotGames[0] || null;
}

export default function GameHero({ onNavigate }: GameHeroProps) {
  const snapshot = getCachedSnapshot();
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { sessions } = useGameSession();

  const snapshotGames = snapshot?.library?.games || [];
  const heroGame = useMemo(
    () => findHeroGame(snapshotGames, sessions),
    [snapshotGames, sessions],
  );

  if (!heroGame || !heroGame.appId) {
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

  const bgPath = heroGame.media?.backgroundPath || heroGame.media?.landscapePath;
  const bgUrl = bgPath ? localPathToUrl(bgPath) : null;
  const libGame = libraryGames.find((g) => g.appId === heroGame.appId);
  const lastPlayedStr =
    heroGame.lastPlayed != null
      ? new Date(heroGame.lastPlayed * 1000).toLocaleDateString()
      : null;

  function handlePrimaryAction() {
    if (!heroGame) return;
    if (libGame) {
      setSelectedGame(libGame);
      onNavigate?.("library-game-detail");
    } else if (heroGame.appId) {
      onNavigate?.("store");
    }
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
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />

      <div className="relative z-10 flex min-h-[300px] items-end px-6 pb-8 pt-16 sm:min-h-[340px] sm:px-8">
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-lg sm:text-3xl">
            {heroGame.title}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-3">
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
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {heroGame.playable ? (
              <button
                onClick={handlePrimaryAction}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-medium text-black transition hover:opacity-90"
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
            <button
              onClick={() => onNavigate?.("store")}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/6 px-5 py-3 text-sm text-white/80 backdrop-blur-sm transition hover:bg-white/10"
            >
              <Store className="h-4 w-4" />
              Browse Store
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
