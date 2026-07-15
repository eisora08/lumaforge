import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderSearch,
  Gamepad2,
  RefreshCcw,
  SlidersHorizontal,
} from "lucide-react";

import PageContainer from "../components/layout/PageContainer";
import GameLauncherTile from "../components/games/GameLauncherTile";
import { GridSkeleton } from "../components/common/Skeleton";

import { useLibraryGames } from "../context/LibraryGamesContext";
import { useSettings } from "../context/SettingsContext";
import { useGameSession } from "../context/GameSessionContext";
import { installSteamApp, deleteLuaScript, scanInstalledLuaScripts } from "../services/tauri";
import { installTrackerService } from "../services/installTrackingService";

import type { LibraryGame } from "../types/libraryGame";

import { resolveArtworkForAppIds } from "../services/storeArtworkResolver";
import { enqueueMediaDownload, isAppIdInFlight } from "../services/mediaDownloadQueue";

import { showError, showSuccess, showWarning } from "../components/toast/GameToast";
import { useConfirm } from "../services/confirmService";

const DEBUG_LUA_DELETE = false;


export default function GamesPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { games, loading, initialLoading, setSelectedGame, refresh, appInfoMap } = useLibraryGames();
  const { settings } = useSettings();
  const session = useGameSession();

  const [filter, setFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const queuedMediaRef = useRef<Set<string>>(new Set());
  const { confirm } = useConfirm();

  const handleOpenGame = useCallback((game: LibraryGame) => {
    setSelectedGame(game);
    onNavigate?.("library-game-detail");
  }, [setSelectedGame, onNavigate]);

  async function handleDeleteScript(game: LibraryGame) {
    const script = game.luaScripts[0];
    if (!script) {
      showWarning("No Lua script to delete.", { title: "No script" });
      return;
    }
    if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][REQUEST] appid=${game.appId} title="${game.title}" file="${script.file_name}" path="${script.path}" luaPath="${settings.luaPath}"`);
    const result = await confirm({
      title: "Delete Lua script?",
      description: `This will permanently delete "${script.file_name}" for ${game.title} from the configured Lua folder. This action cannot be undone.`,
      confirmLabel: "Delete Lua",
      variant: "danger",
    });
    if (!result.confirmed) return;
    try {
      await deleteLuaScript({ luaPath: settings.luaPath, fileName: script.file_name });
      // Verify file is actually gone from disk
      const remaining = await scanInstalledLuaScripts(settings.luaPath);
      const stillPresent = remaining.some((s) => s.file_name === script.file_name);
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][VERIFY] appid=${game.appId} file="${script.file_name}" stillPresent=${stillPresent}`);
      if (stillPresent) {
        showError("File still exists on disk after deletion attempt.", { title: "Deletion failed" });
        return;
      }
      // Force refresh library state (bypass TTL) to reflect deletion
      await refresh({ force: true });
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][UI_RESULT] appid=${game.appId} file="${script.file_name}" success=true`);
      showSuccess("Lua script deleted.", { title: "Deleted" });
    } catch (err) {
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][UI_RESULT] appid=${game.appId} file="${script.file_name}" error="${String(err)}"`);
      showError(String(err), { title: "Error" });
    }
  }

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

  // Resolve artwork/cache for visible games — queued, throttled, cache-first
  // Intentionally does NOT depend on mediaCacheMap or appInfoMap to avoid re-enqueue loops.
  useEffect(() => {
    const gamesNeedingMedia = filteredGames.filter((g) => {
      if (!g.appId) return false;
      if (queuedMediaRef.current.has(g.appId)) return false;
      if (isAppIdInFlight(g.appId)) return false;
      return true;
    });

    if (gamesNeedingMedia.length === 0) return;

    const sgdbEnabled = settings.steamGridDbArtworkEnabled && !!settings.steamGridDbApiKey
      && (settings.libraryCardArtworkMode ?? "landscape") === "poster";

    for (const game of gamesNeedingMedia) {
      queuedMediaRef.current.add(game.appId!);

      if (sgdbEnabled) {
        const appIdNum = Number(game.appId);
        if (isNaN(appIdNum) || appIdNum <= 0) continue;

        resolveArtworkForAppIds([appIdNum], settings.steamGridDbApiKey)
          .then((result) => {
            if (result[game.appId!]) {
              const artworkData = result[game.appId!];
              const jobs: Array<{ mediaType: string; url?: string }> = [
                { mediaType: "landscape", url: artworkData.sgdbGridUrl || artworkData.sgdbGridThumbUrl || artworkData.sgdbHeroUrl },
                { mediaType: "cover", url: artworkData.sgdbCoverUrl },
              ];
              for (const { mediaType, url } of jobs) {
                if (!url) continue;
                enqueueMediaDownload({
                  id: `sgdb-${game.appId}-${mediaType}`,
                  appId: game.appId!,
                  provider: "steam",
                  mediaType: mediaType as any,
                  url,
                  target: "canonical",
                  priority: "normal",
                }).catch(() => {});
              }
            }
          })
          .catch(() => {});
      } else {
        const landscapeUrl = game.metadata?.capsule_image_v5 || game.metadata?.capsule_image || game.metadata?.header_image || game.metadata?.background_image || game.imageUrl || undefined;
        if (landscapeUrl) {
          enqueueMediaDownload({
            id: `store-${game.appId}-landscape`,
            appId: game.appId!,
            provider: "steam",
            mediaType: "landscape",
            url: landscapeUrl,
            target: "canonical",
            priority: "normal",
          }).catch(() => {});
        }
      }
    }
  }, [filteredGames, settings.steamGridDbArtworkEnabled, settings.steamGridDbApiKey]);

  // Viewport-based data loading is handled per-card in GameLauncherTile
  // using useInViewport hook — items request data when they enter the viewport.

  async function handlePlay(game: LibraryGame) {
    if (game.source === "steam" && game.appId) {
      try {
        await session.launchGame(game);
      } catch (err) {
        showError(String(err), { title: "Error" });
      }
    } else if ((game.source === "local" || game.source === "manual") && game.executablePath) {
      try {
        await session.launchGame(game);
      } catch (err) {
        showError(String(err), { title: "Error" });
      }
    } else {
      showWarning("This game cannot be launched yet.", { title: "Not available" });
    }
  }

  async function handleInstall(game: LibraryGame) {
    if (game.appId) {
      try {
        await installSteamApp(Number(game.appId));
        installTrackerService.startTracking(game.appId, settings.steamRoot, game.title || String(game.appId), game.imageUrl);
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
                  {loading && !initialLoading && " · scanning..."}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => refresh()}
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

            {initialLoading ? (
              <GridSkeleton
                poster={(settings.libraryCardArtworkMode ?? "landscape") === "poster"}
                count={8}
              />
            ) : filteredGames.length === 0 ? (
              <div className="rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-12 text-center">
                <FolderSearch className="mx-auto h-10 w-10 text-(--color-muted)" />
                <h2 className="mt-4 font-semibold text-(--color-text)">No games match</h2>
                <p className="mt-1.5 text-sm text-(--color-muted)">Try adjusting your filter or scan for games.</p>
              </div>
            ) : (
              <div className={
                (settings.libraryCardArtworkMode ?? "landscape") === "poster"
                  ? "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
                  : "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
              }>
                {filteredGames.map((game) => (
                  <GameLauncherTile
                    key={game.id}
                    game={game}
                    appInfoEntry={game.appId ? (appInfoMap[game.appId] ?? null) : null}
                    onSelect={handleOpenGame}
                    onPlay={handlePlay}
                    onInstall={handleInstall}
                    onDeleteScript={handleDeleteScript}
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
