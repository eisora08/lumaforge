import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  launchSteamApp,
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
import type { SgdbArtworkData } from "../services/storeArtworkResolver";

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
  const hasLuaPath = Boolean(settings.luaPath);

  const [luaScripts, setLuaScripts] = useState<InstalledLuaScript[]>([]);
  const [luaMetadata, setLuaMetadata] = useState<Record<number, SteamAppMetadata>>({});
  const [scanningLua, setScanningLua] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [sourceSelectorGame, setSourceSelectorGame] = useState<LibraryGame | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("name");
  const [searchQuery, setSearchQuery] = useState("");
  const [artworkByAppId, setArtworkByAppId] = useState<Record<string, SgdbArtworkData>>({});
  const artworkRequest = useRef(0);

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
        if (luaGame.appId === "2358720" && existing >= 0) {
          console.debug("[Library] Merging Lua into Wukong:", {
            before: { isPlayable: merged[existing].isPlayable, isInstallable: merged[existing].isInstallable, steamInstalled: merged[existing].steamInstalled },
            lua: { isPlayable: luaGame.isPlayable, isInstallable: luaGame.isInstallable },
          });
        }
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

  // Resolve SGDB artwork for visible games (poster mode only)
  useEffect(() => {
    console.debug("[SGDB] enabled", settings.steamGridDbArtworkEnabled);
    console.debug("[SGDB] apiKey configured", Boolean(settings.steamGridDbApiKey));
    if (!settings.steamGridDbArtworkEnabled) return;
    if ((settings.libraryCardArtworkMode ?? "landscape") !== "poster") return;
    if (!settings.steamGridDbApiKey) return;

    const visibleAppIds = paginatedGames
      .map((g) => Number(g.appId))
      .filter((id): id is number => !isNaN(id) && id > 0);

    if (visibleAppIds.length === 0) return;

    const requestId = Date.now();
    artworkRequest.current = requestId;

    console.debug("[Library] Resolving SGDB artwork for", visibleAppIds.length, "games");
    resolveArtworkForAppIds(visibleAppIds, settings.steamGridDbApiKey)
      .then((result) => {
        if (artworkRequest.current !== requestId) return;
        setArtworkByAppId((prev) => ({ ...prev, ...result }));
      })
      .catch(() => {});
  }, [paginatedGames, settings.libraryCardArtworkMode, settings.steamGridDbApiKey]);

  // Actions
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
    setFilter("all");
    setSort("name");
    setSearchQuery("");
  }

  return (
    <div className="flex h-full">
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
          <PageContainer className="py-5 lg:py-7">
            <div className="lg:grid lg:grid-cols-[1fr_280px] lg:gap-6">
              <div className="min-w-0">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
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
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-2.5 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-50"
                      title="Check Updates"
                    >
                      <RefreshCcw className={`h-3.5 w-3.5 ${checkingUpdates ? "animate-spin" : ""}`} />
                      <span className="hidden sm:inline">Updates</span>
                    </button>

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
                  </div>
                </div>

                {warnings.length > 0 && (
                  <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
                    <p className="mb-1 font-medium">Warnings:</p>
                    <ul className="space-y-0.5">
                      {warnings.map((w, i) => <li key={i}>• {w}</li>)}
                    </ul>
                  </div>
                )}

                {paginatedGames.length === 0 ? (
                  <div className="rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-12 text-center">
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
                        ? "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
                        : "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                    }>
                      {paginatedGames.map((game) => (
                        <GameLauncherTile
                          key={game.id}
                          game={game}
                          artwork={game.appId ? artworkByAppId[game.appId] : undefined}
                          appInfoEntry={game.appId ? (appInfoMap[game.appId] ?? null) : null}
                          onSelect={(g) => handleOpenGame(g)}
                          onPlay={handlePlay}
                          onInstall={handleInstall}
                          onDeleteScript={handleDeleteScript}
                        />
                      ))}
                    </div>
                    {/* Pagination */}
                    <div className="mt-6 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-(--color-muted)">
                        <span>Grid:</span>
                        <select
                          value={pageSize}
                          onChange={(e) => {
                            setPageSize(Number(e.target.value));
                            setCurrentPage(1);
                          }}
                          className="rounded-lg border border-(--surface-active-border) bg-white/5 px-2 py-1 text-xs text-(--color-text) outline-none focus:border-(--color-accent)/40"
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
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            className="inline-flex cursor-pointer items-center justify-center rounded-lg px-2 py-1 text-xs text-(--color-muted) transition hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                            <button
                              key={page}
                              type="button"
                              onClick={() => setCurrentPage(page)}
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
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
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
