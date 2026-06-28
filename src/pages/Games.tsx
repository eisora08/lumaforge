import { useMemo, useState } from "react";
import {
  FolderSearch,
  Gamepad2,
  RefreshCcw,
  SlidersHorizontal,
} from "lucide-react";

import PageContainer from "../components/layout/PageContainer";
import GameLauncherTile from "../components/games/GameLauncherTile";

import { useLibraryGames } from "../context/LibraryGamesContext";
import { launchSteamApp, installSteamApp } from "../services/tauri";

import type { LibraryGame } from "../types/libraryGame";

import { showError, showWarning } from "../components/toast/GameToast";

export default function GamesPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { games, loading, setSelectedGame, refresh } = useLibraryGames();

  const [filter, setFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

  const filteredGames = useMemo(() => {
    const wukong = games.find((g) => g.appId === "2358720");
    if (wukong) {
      console.debug("[Games] Wukong:", { id: wukong.id, appId: wukong.appId, source: wukong.source, isPlayable: wukong.isPlayable, isInstallable: wukong.isInstallable, steamInstalled: wukong.steamInstalled });
    }
    return games.filter((g) => {
      if (filter === "steam" && g.source !== "steam") return false;
      if (filter === "local" && g.source !== "local") return false;
      if (filter === "playable" && !g.isPlayable) return false;
      return true;
    });
  }, [games, filter]);

  async function handlePlay(game: LibraryGame) {
    if (game.source === "steam" && game.appId) {
      try {
        await launchSteamApp(Number(game.appId));
      } catch (err) {
        showError(String(err), { title: "Error" });
      }
    } else if (game.source === "local" && game.executablePath) {
      showWarning("Local executable launching is not available yet.", { title: "Not available" });
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

  const filters = [
    { key: "all", label: "All", count: games.length },
    { key: "steam", label: "Steam", count: games.filter((g) => g.source === "steam").length },
    { key: "local", label: "Local", count: games.filter((g) => g.source === "local").length },
    { key: "playable", label: "Playable", count: games.filter((g) => g.isPlayable).length },
  ];

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <PageContainer className="py-5 lg:py-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
                  <Gamepad2 className="h-3.5 w-3.5" />
                  Games
                </div>
                <h1 className="text-2xl font-bold text-(--color-text) lg:text-3xl">Juegos</h1>
                <p className="mt-1 text-sm text-(--color-muted)">
                  {filteredGames.length} game{filteredGames.length === 1 ? "" : "s"}
                  {loading && " (scanning...)"}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={refresh}
                  disabled={loading}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-(--color-accent)/30 bg-(--color-accent)/10 px-2.5 py-2 text-xs font-medium text-(--color-accent) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Scan"
                >
                  <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">{loading ? "Scanning..." : "Scan"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowFilters(true)}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs transition ${
                    filter !== "all"
                      ? "border-(--color-accent)/30 bg-(--color-accent)/10 text-(--color-accent)"
                      : "border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
                  }`}
                  title="Filters"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Filters</span>
                </button>
              </div>
            </div>

            {/* Filter pills */}
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {filters.filter((f) => f.count > 0).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    filter === f.key
                      ? "bg-(--color-accent) text-black"
                      : "border border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:bg-white/10"
                  }`}
                >
                  {f.label} ({f.count})
                </button>
              ))}
            </div>

            {filteredGames.length === 0 ? (
              <div className="rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-12 text-center">
                <FolderSearch className="mx-auto h-10 w-10 text-(--color-muted)" />
                <h2 className="mt-4 font-semibold text-(--color-text)">No games match</h2>
                <p className="mt-1.5 text-sm text-(--color-muted)">Try adjusting your filter or scan for games.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filteredGames.map((game) => (
                  <GameLauncherTile
                    key={game.id}
                    game={game}
                    onSelect={(g) => { setSelectedGame(g); onNavigate?.("library-game-detail"); }}
                    onPlay={handlePlay}
                    onInstall={handleInstall}
                  />
                ))}
              </div>
            )}
        </PageContainer>

        {showFilters && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowFilters(false)}>
            <div className="w-80 rounded-2xl border border-(--surface-active-border) bg-(--color-bg) p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-4 text-sm font-bold text-(--color-text)">Filters</h3>
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-xs text-(--color-muted)">Source</p>
                  <div className="flex flex-wrap gap-1.5">
                    {filters.filter((f) => f.count > 0).map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => { setFilter(f.key); setShowFilters(false); }}
                        className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition ${
                          filter === f.key
                            ? "bg-(--color-accent) text-black"
                            : "border border-(--surface-active-border) bg-white/5 text-(--color-muted)"
                        }`}
                      >
                        {f.label} ({f.count})
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setFilter("all"); setShowFilters(false); }}
                className="mt-4 w-full cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/10"
              >
                Reset
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
