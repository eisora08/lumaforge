import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileCode2,
  FolderSearch,
  Library,
  RefreshCcw,
  Settings,
} from "lucide-react";

import PageContainer from "../components/layout/PageContainer";
import GameLauncherTile from "../components/games/GameLauncherTile";
import LibraryFilterPanel from "../components/library/LibraryFilterPanel";
import type { LibraryFilter, LibrarySort } from "../components/library/LibraryFilterPanel";
import StoreSourceSelectorModal from "../components/store/StoreSourceSelectorModal";
import { GridSkeleton, LibrarySectionSkeleton } from "../components/common/Skeleton";

import { useSettings } from "../context/SettingsContext";
import { useLibraryGames } from "../context/LibraryGamesContext";
import { useGameSession } from "../context/GameSessionContext";
import {
  installSteamApp,
  deleteLuaScript,
  scanInstalledLuaScripts,
  computeFileHash,
  downloadAndInstallPackage,
  markSyncIndexItem,
} from "../services/tauri";
import { checkInstalledLuaUpdates } from "../services/installedLuaUpdateChecker";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { resolveArtworkForAppIds } from "../services/storeArtworkResolver";
import { enqueueMediaDownload, isAppIdInFlight } from "../services/mediaDownloadQueue";

import type { LibraryGame } from "../types/libraryGame";
import type { InstalledLuaScript } from "../types/installedLua";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { PackageGame, PackageSource } from "../types/package";
import type { SyncIndexItem } from "../types/syncIndex";
import type { AppPage } from "../types/navigation";

import {
  showError,
  showSuccess,
  showWarning,
} from "../components/toast/GameToast";



type Props = {
  onNavigate?: (page: AppPage) => void;
};

export default function LibraryPage({ onNavigate }: Props) {
  const { settings } = useSettings();
  const { games, warnings, loading, initialLoading, setSelectedGame, refresh, appInfoMap } = useLibraryGames();
  const session = useGameSession();
  const hasLuaPath = Boolean(settings.luaPath);
  const [, startTransition] = useTransition();

  const [luaScripts, setLuaScripts] = useState<InstalledLuaScript[]>([]);
  const [luaMetadata, setLuaMetadata] = useState<Record<number, SteamAppMetadata>>({});
  const [scanningLua, setScanningLua] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [sourceSelectorGame, setSourceSelectorGame] = useState<LibraryGame | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("name");
  const [searchQuery, setSearchQuery] = useState("");
  const queuedMediaRef = useRef<Set<string>>(new Set());

  // On mount: scan Lua scripts from config/lua
  useEffect(() => {
    if (hasLuaPath) {
      scanLuaScripts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLuaPath]);

  async function scanLuaScripts() {
    if (!hasLuaPath) return;
    try {
      setScanningLua(true);
      const results = await scanInstalledLuaScripts(settings.luaPath);
      setLuaScripts(results);
      const appIds = results.map((s) => s.app_id);
      if (appIds.length > 0) {
        const metadata = await resolveGameMetadata(appIds);
        setLuaMetadata(metadata);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setScanningLua(false);
    }
  }

  // Build Lua game items from scripts (old Biblioteca behavior)
  const luaGames: LibraryGame[] = useMemo(() => {
    return luaScripts.map((script) => {
      const appId = script.app_id;
      const meta = luaMetadata[appId];
      const appInfo = appInfoMap[String(appId)];
      const id = `lua-${appId}`;
      return {
        id,
        appId: String(appId),
        title: appInfo?.name || meta?.name || `Steam App ${appId}`,
        source: "lua" as const,
        imageUrl: appInfo?.header_image || meta?.header_image || meta?.capsule_image || meta?.capsule_image_v5 || undefined,
        metadata: meta,
        isPlayable: false,
        isInstallable: true,
        steamInstalled: games.some((g) => g.appId === String(appId) && g.steamInstalled),
        luaScripts: [script],
        hasLua: true,
        isLuaActive: !script.is_disabled,
        isLuaDisabled: script.is_disabled,
        hasLuaSource: false,
        sources: [],
      };
    });
  }, [luaScripts, luaMetadata, games, appInfoMap]);

  // Merge with context games for display
  const displayGames = useMemo(() => {
    const merged = [...games];
    for (const luaGame of luaGames) {
      const existing = merged.findIndex((g) => g.id === luaGame.id || g.appId === luaGame.appId);
      if (existing >= 0) {
        // Merge Lua-specific fields into existing game — preserve Steam core fields
        merged[existing] = {
          ...merged[existing],
          luaScripts: luaGame.luaScripts,
          hasLua: true,
          isLuaActive: luaGame.isLuaActive,
          isLuaDisabled: luaGame.isLuaDisabled,
          hasLuaSource: luaGame.hasLuaSource,
        };
      } else {
        merged.push(luaGame);
      }
    }
    return merged.sort((a, b) => a.title.localeCompare(b.title));
  }, [games, luaGames]);

  const filteredGames = useMemo(() => {
    let result = displayGames;

    // Local search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (g) => g.title.toLowerCase().includes(q) || g.appId?.toLowerCase().includes(q)
      );
    }

    // Status filter
    result = result.filter((g) => {
      if (filter === "lua" && !g.hasLua) return false;
      if (filter === "installed" && !g.isPlayable && !g.steamInstalled) return false;
      if (filter === "disabled" && !g.isLuaDisabled) return false;
      return true;
    });

    // Sort
    result = [...result].sort((a, b) => {
      if (sort === "size") return (b.sizeOnDisk || 0) - (a.sizeOnDisk || 0);
      if (sort === "updated") return (b.lastUpdated || 0) - (a.lastUpdated || 0);
      return a.title.localeCompare(b.title);
    });

    return result;
  }, [displayGames, filter, sort, searchQuery]);

  const PAGE_SIZES = [12, 24, 36, 48] as const;
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(24);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, sort, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredGames.length / pageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedGames = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredGames.slice(start, start + pageSize);
  }, [filteredGames, currentPage, pageSize]);

  // Resolve artwork/cache for visible games — queued, throttled, cache-first
  // Intentionally does NOT depend on mediaCacheMap to avoid re-enqueue loops.
  // queuedMediaRef persists across renders to prevent duplicate queueing.
  useEffect(() => {
    const visibleGames = paginatedGames.filter((g) => {
      if (!g.appId) return false;
      if (queuedMediaRef.current.has(g.appId)) return false;
      if (isAppIdInFlight(g.appId)) return false;
      return true;
    });

    if (visibleGames.length === 0) return;

    const sgdbEnabled = settings.steamGridDbArtworkEnabled && !!settings.steamGridDbApiKey
      && (settings.libraryCardArtworkMode ?? "landscape") === "poster";

    for (const game of visibleGames) {
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
                  provider: "steamgriddb",
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
  }, [paginatedGames, settings.steamGridDbApiKey, settings.steamGridDbArtworkEnabled]);

  // Viewport-based data loading is handled per-card in GameLauncherTile
  // using useInViewport hook — items request data when they enter the viewport.

  // Actions
  async function handlePlay(game: LibraryGame) {
    if (game.source === "steam" && game.appId) {
      try {
        await session.launchGame(game);
      } catch (err) {
        showError(String(err), { title: "Error" });
      }
    } else if (game.source === "local" && game.executablePath) {
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
      } catch (err) {
        showError(String(err), { title: "Error" });
      }
    } else {
      showWarning("This game cannot be installed through Steam because it has no AppID.", { title: "Not available" });
    }
  }

  async function handleDeleteScript(game: LibraryGame) {
    const script = game.luaScripts[0];
    if (!script) {
      showWarning("No Lua script to delete.", { title: "No script" });
      return;
    }
    if (!window.confirm(`Delete Lua script "${script.file_name}" for ${game.title}?`)) return;
    try {
      await deleteLuaScript({ luaPath: settings.luaPath, fileName: script.file_name });
      showSuccess("Lua script deleted.", { title: "Deleted" });
      await scanLuaScripts();
      await refresh();
    } catch (err) {
      showError(String(err), { title: "Error" });
    }
  }

  async function handleCheckUpdates() {
    if (!hasLuaPath) {
      showWarning("Configure a Lua path first.", { title: "Path required" });
      return;
    }
    if (luaScripts.length === 0) {
      showWarning("No Lua scripts to check.", { title: "No updates" });
      return;
    }
    try {
      setCheckingUpdates(true);
      await checkInstalledLuaUpdates(luaScripts, settings);
      showSuccess("Update check complete.", { title: "Checked" });
    } catch {
      showError("Update check failed.", { title: "Error" });
    } finally {
      setCheckingUpdates(false);
    }
  }

  async function handleDownloadSource(game: LibraryGame, source: PackageSource) {
    await performDownload(game, source);
  }

  async function performDownload(game: LibraryGame, source: PackageSource) {
    if (!settings.luaPath || !settings.depotcachePath) {
      showWarning("Configure Lua and Depot paths in Settings.", { title: "Paths required" });
      return;
    }
    if (!source.downloadUrl) {
      showError("Source has no download URL.", { title: "Invalid source" });
      return;
    }
    try {
      showSuccess(`Downloading from ${source.providerName}...`, { title: "Download started" });
      await downloadAndInstallPackage({
        jobId: `sync-${game.appId}-${Date.now()}`,
        downloadUrl: source.downloadUrl,
        luaTarget: settings.luaPath,
        depotcacheTarget: settings.depotcachePath,
        createBackups: true,
        headers: source.authHeaders,
      });
      const luaScript = game.luaScripts[0];
      let localHash: string | undefined;
      if (luaScript) {
        try {
          localHash = await computeFileHash(luaScript.path);
        } catch {
          // optional
        }
      }
      const now = new Date().toISOString();
      const syncItem: SyncIndexItem = {
        appId: game.appId || "",
        sourceKey: `${source.providerId}:${source.fileType}`,
        providerId: source.providerId,
        providerName: source.providerName,
        fileType: source.fileType,
        installedPath: luaScript?.path || "",
        lastDownloadUrl: source.downloadUrl,
        remoteHash: undefined,
        localHash: localHash || undefined,
        etag: undefined,
        lastModified: undefined,
        installedAt: now,
        updatedAt: now,
        lastCheckedAt: now,
        status: "up-to-date",
      };
      await markSyncIndexItem(syncItem);
      showSuccess(`Sync complete from ${source.providerName}.`, { title: "Synced" });
      await scanLuaScripts();
      await refresh();
    } catch (error) {
      console.error(error);
      showError(error instanceof Error ? error.message : "Sync failed.", { title: "Error" });
    }
  }

  const showLuaSetup = !hasLuaPath;
  const showEmptyLua = hasLuaPath && luaScripts.length === 0 && !scanningLua;

  function handleOpenGame(game: LibraryGame) {
    setSelectedGame(game);
    onNavigate?.("library-game-detail");
  }

  function handleResetFilters() {
    startTransition(() => {
      setFilter("all");
      setSort("name");
      setSearchQuery("");
    });
  }

  return (
    <div className="flex h-full lf-fade-in">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {showLuaSetup ? (
          <div className="flex flex-1 items-center justify-center p-5 lg:p-7">
            <div className="max-w-md text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-(--color-accent)/20 bg-(--color-accent)/10">
                <Settings className="h-8 w-8 text-(--color-accent)" />
              </div>
              <h2 className="mt-5 text-xl font-bold text-(--color-text)">Lua path is not configured</h2>
              <p className="mt-2 text-sm text-(--color-muted)">
                Configure or auto-detect Steam paths in Settings to scan for installed Lua scripts.
              </p>
              <p className="mt-4 text-xs text-(--color-muted)">Go to Settings → Steam Paths</p>
            </div>
          </div>
        ) : initialLoading ? (
          <PageContainer className="py-5 lg:py-7">
            <LibrarySectionSkeleton />
            <GridSkeleton
              poster={(settings.libraryCardArtworkMode ?? "landscape") === "poster"}
              count={8}
            />
          </PageContainer>
        ) : showEmptyLua ? (
          <div className="flex flex-1 items-center justify-center p-5 lg:p-7">
            <div className="max-w-md text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-(--surface-active-border) bg-white/5">
                <FileCode2 className="h-8 w-8 text-(--color-muted)" />
              </div>
              <h2 className="mt-5 text-xl font-bold text-(--color-text)">No installed Lua scripts found</h2>
              <p className="mt-2 text-sm text-(--color-muted)">
                Download Lua from the Store or sync a supported game.
              </p>
            </div>
          </div>
        ) : (
          <PageContainer className="py-6 lg:py-8">
            <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-6">
              <div className="min-w-0">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/15 bg-(--color-accent)/8 px-3 py-1 text-xs text-(--color-accent)">
                      <Library className="h-3.5 w-3.5" />
                      Library
                    </div>
                    <h1 className="text-2xl font-bold text-(--color-text) lg:text-3xl">Biblioteca</h1>
                    <p className="mt-1 text-sm text-(--color-muted)">
                      {filteredGames.length} game{filteredGames.length === 1 ? "" : "s"}
                      {loading && !initialLoading && " · scanning..."}
                      {scanningLua && " · scanning Lua..."}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCheckUpdates}
                      disabled={checkingUpdates || luaScripts.length === 0}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-2.5 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-50 lf-press-effect"
                      title="Check Updates"
                    >
                      <RefreshCcw className={`h-3.5 w-3.5 ${checkingUpdates ? "animate-spin" : ""}`} />
                      <span className="hidden sm:inline">Updates</span>
                    </button>

                    <button
                      type="button"
                      onClick={refresh}
                      disabled={loading}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-(--color-accent)/30 bg-(--color-accent)/10 px-2.5 py-2 text-xs font-medium text-(--color-accent) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lf-press-effect"
                      title="Scan"
                    >
                      <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                      <span className="hidden sm:inline">{loading ? "Scanning..." : "Scan"}</span>
                    </button>
                  </div>
                </div>

                {warnings.length > 0 && (
                  <div className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
                    <p className="mb-1 font-medium">Warnings:</p>
                    <ul className="space-y-0.5">
                      {warnings.map((w, i) => <li key={i}>• {w}</li>)}
                    </ul>
                  </div>
                )}


                {paginatedGames.length === 0 ? (
                  <div className="rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-12 text-center">
                    <FolderSearch className="mx-auto h-10 w-10 text-(--color-muted)" />
                    <h2 className="mt-4 font-semibold text-(--color-text)">No items match these filters.</h2>
                    <p className="mt-1.5 text-sm text-(--color-muted)">Try clearing filters or changing your search.</p>
                    {(filter !== "all" || searchQuery) && (
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-(--color-accent)/30 bg-(--color-accent)/10 px-3 py-2 text-xs font-medium text-(--color-accent) transition hover:opacity-90"
                    >
                      Reset filters
                    </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div className={
                      (settings.libraryCardArtworkMode ?? "landscape") === "poster"
                        ? "grid grid-cols-[repeat(auto-fill,minmax(165px,1fr))] gap-[22px] lf-card-stagger"
                        : "grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-[22px] lf-card-stagger"
                    }>
                      {paginatedGames.map((game) => (
                        <GameLauncherTile
                          key={game.id}
                          game={game}
                          appInfoEntry={game.appId ? (appInfoMap[game.appId] ?? null) : null}
                          onSelect={(g) => handleOpenGame(g)}
                          onPlay={handlePlay}
                          onInstall={handleInstall}
                          onDeleteScript={handleDeleteScript}
                        />
                      ))}
                    </div>
                    {/* Pagination */}
                    <div className="mt-7 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-(--color-muted)">
                        <span>Grid:</span>
                        <select
                          value={pageSize}
                          onChange={(e) => {
                            setPageSize(Number(e.target.value));
                            setCurrentPage(1);
                          }}
                          className="lf-select lf-popover-enter rounded-lg border px-2 py-1 text-xs outline-none focus:border-(--color-accent)/40"
                        >
                          {PAGE_SIZES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>

                      {totalPages > 1 && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={currentPage <= 1}
                            onClick={() => startTransition(() => setCurrentPage((p) => Math.max(1, p - 1)))}
                            className="inline-flex cursor-pointer items-center justify-center rounded-lg px-2 py-1 text-xs text-(--color-muted) transition hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                            <button
                              key={page}
                              type="button"
                              onClick={() => startTransition(() => setCurrentPage(page))}
                              className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-xs font-medium transition ${
                                page === currentPage
                                  ? "bg-(--color-accent)/20 text-(--color-accent)"
                                  : "text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
                              }`}
                            >
                              {page}
                            </button>
                          ))}
                          <button
                            type="button"
                            disabled={currentPage >= totalPages}
                            onClick={() => startTransition(() => setCurrentPage((p) => Math.min(totalPages, p + 1)))}
                            className="inline-flex cursor-pointer items-center justify-center rounded-lg px-2 py-1 text-xs text-(--color-muted) transition hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="hidden lg:block">
                <LibraryFilterPanel
                  filter={filter}
                  sort={sort}
                  query={searchQuery}
                  filteredCount={filteredGames.length}
                  totalCount={displayGames.length}
                  onFilterChange={setFilter}
                  onSortChange={setSort}
                  onQueryChange={setSearchQuery}
                  onReset={handleResetFilters}
                />
              </div>
            </div>
          </PageContainer>
        )}

        <StoreSourceSelectorModal
          open={Boolean(sourceSelectorGame)}
          game={sourceSelectorGame ? {
            appId: sourceSelectorGame.appId || "",
            title: sourceSelectorGame.title,
            developer: sourceSelectorGame.metadata?.developer || "",
            imageUrl: sourceSelectorGame.imageUrl || "",
            platforms: sourceSelectorGame.metadata?.platforms || [],
            sources: sourceSelectorGame.sources,
          } : null}
          selectedSource={sourceSelectorGame?.sources.find((s) => s.available)}
          onClose={() => setSourceSelectorGame(null)}
          onDownloadSource={(source: PackageSource) => {
            if (sourceSelectorGame) handleDownloadSource(sourceSelectorGame, source);
          }}
          onOpenDetails={(_game: PackageGame) => {
            setSourceSelectorGame(null);
            if (sourceSelectorGame) setSelectedGame(sourceSelectorGame);
          }}
        />
      </div>
    </div>
  );
}
