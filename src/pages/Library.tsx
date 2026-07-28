import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileCode2,
  FolderSearch,
  Gamepad2,
  Grid3X3,
  Library,
  List,
  Plus,
  RefreshCcw,
  Settings,
  X,
  Search,
} from "lucide-react";

import PageContainer from "../components/layout/PageContainer";
import GameLauncherTile from "../components/games/GameLauncherTile";
import GameEditDialog from "../components/games/GameEditDialog";
import LibraryFilterPanel from "../components/library/LibraryFilterPanel";
import type { LibraryFilter, LibrarySort } from "../components/library/LibraryFilterPanel";
import StoreSourceSelectorModal from "../components/store/StoreSourceSelectorModal";
import { GridSkeleton, LibrarySectionSkeleton } from "../components/common/Skeleton";

import { useSettings } from "../context/SettingsContext";
import { useLibraryGames } from "../context/LibraryGamesContext";
import { useGameSession } from "../context/GameSessionContext";
import { installTrackerService } from "../services/installTrackingService";
import {
  installSteamApp,
  deleteLuaScript,
  scanInstalledLuaScripts,
  computeFileHash,
  downloadAndInstallPackage,
  markSyncIndexItem,
} from "../services/tauri";
import { getEffectiveProviderAuthHeaders } from "../services/providerSearch";
import { saveProviderStatusAfterInstall, type ProviderStatusOptions } from "../services/providerStatusService";
import { runInstalledLuaScan, getUpdateStatus, subscribeUpdateStatus } from "../services/installedLuaScanner";
import { resolveArtworkForAppIds } from "../services/storeArtworkResolver";
import { enqueueMediaDownload, isAppIdInFlight } from "../services/mediaDownloadQueue";
import { isSidebarInstalledGame } from "../services/gameCacheService";
import { consumePendingLibraryFocus } from "../services/libraryNavigationService";

import type { LibraryGame } from "../types/libraryGame";
import type { PackageGame, PackageSource } from "../types/package";
import type { SyncIndexItem } from "../types/syncIndex";
import type { AppPage } from "../types/navigation";

import {
  showError,
  showSuccess,
  showWarning,
} from "../components/toast/GameToast";
import { useConfirm } from "../services/confirmService";

const DEBUG_LUA_DELETE = false;


// ─── Compact pagination token generator ──────────────────────────────────────
type PaginationToken =
  | { type: "page"; value: number }
  | { type: "ellipsis"; key: string };

const DEBUG_LIBRARY_PAGINATION = false;

function getPaginationTokens(
  currentPage: number,
  totalPages: number,
  siblingCount = 1,
): PaginationToken[] {
  // Compact pagination for 5+ pages; show all for fewer
  if (totalPages < 5) {
    return Array.from({ length: totalPages }, (_, i) => ({
      type: "page" as const,
      value: i + 1,
    }));
  }

  // Base sibling window around current page, clamped to inner pages (page 1 and last are always shown separately)
  let rangeStart = Math.max(2, currentPage - siblingCount);
  let rangeEnd = Math.min(totalPages - 1, currentPage + siblingCount);

  // Ensure at least 2 visible pages in the numeric range (expands right at beginning, left at end)
  if (rangeEnd - rangeStart + 1 < 2) {
    rangeEnd = Math.min(totalPages - 1, rangeStart + 1);
  }

  const tokens: PaginationToken[] = [];

  // Page 1 is always visible
  tokens.push({ type: "page", value: 1 });

  // Left ellipsis when there's a gap between page 1 and the range
  if (rangeStart > 2) {
    tokens.push({ type: "ellipsis", key: "left" });
  }

  // Visible sibling range
  for (let i = rangeStart; i <= rangeEnd; i++) {
    tokens.push({ type: "page", value: i });
  }

  // Right ellipsis when there's a gap between the range and last page
  if (rangeEnd < totalPages - 1) {
    tokens.push({ type: "ellipsis", key: "right" });
  }

  // Last page is always visible
  if (totalPages > 1) {
    tokens.push({ type: "page", value: totalPages });
  }

  return tokens;
}

type Props = {
  onNavigate?: (page: AppPage) => void;
};

export default function LibraryPage({ onNavigate }: Props) {
  const { settings } = useSettings();
  const { games, warnings, loading, initialLoading, setSelectedGame, refresh, appInfoMap } = useLibraryGames();
  const session = useGameSession();
  const hasLuaPath = Boolean(settings.luaPath);
  const [, startTransition] = useTransition();

  // Subscribe to provider-status store so the updates filter re-renders immediately
  const [, forceRerender] = useState(0);
  useEffect(() => {
    const unsub = subscribeUpdateStatus(() => forceRerender((v) => v + 1));
    return unsub;
  }, []);

  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [sourceSelectorGame, setSourceSelectorGame] = useState<LibraryGame | null>(null);
  const [addGameOpen, setAddGameOpen] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("name");
  const [searchQuery, setSearchQuery] = useState("");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const queuedMediaRef = useRef<Set<string>>(new Set());
  const { confirm } = useConfirm();

  // Library focus mode — when navigating from Store after package download
  const [focusAppId, setFocusAppId] = useState<string | null>(null);
  const [focusTitle, setFocusTitle] = useState<string | null>(null);

  // Consume pending library focus on mount (set by Store after package download)
  useEffect(() => {
    const pending = consumePendingLibraryFocus();
    if (pending) {
      setFocusAppId(pending.appId);
      setFocusTitle(pending.title);
      // Reset filters so the focus game is visible regardless of prior filter state
      setFilter("all");
      setSort("name");
      setSearchQuery("");
      setCurrentPage(1);
      console.log(`[LIBRARY_FOCUS][MOUNT] appid=${pending.appId} title="${pending.title || ""}"`);
    }
  }, []);

  // displayGames comes directly from context — no separate luaGames list.
  // Games from LibraryGamesContext already have hasLua flag merged via
  // libraryGameResolver.ts, which uses Lua as an overlay, not a source.
  const displayGames = useMemo(() => {
    const sorted = [...games].sort((a, b) => a.title.localeCompare(b.title));
    // Focus mode: show only the target game
    if (focusAppId) {
      return sorted.filter((g) => g.appId === focusAppId);
    }
    return sorted;
  }, [games, focusAppId]);

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
      if (filter === "installed" && !isSidebarInstalledGame(g)) return false;
      if (filter === "disabled" && !g.isLuaDisabled) return false;
      if (filter === "epic" && g.source !== "epic") return false;
      if (filter === "updates" && g.appId) {
        const s = getUpdateStatus(g.appId);
        if (s !== "update-available") return false;
      }
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

  const PAGE_SIZES = [22, 34, 44] as const;
  const SHOW_ALL = -1;
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(22);

  const isShowAll = pageSize === SHOW_ALL;

  useEffect(() => {
    if (!isShowAll) setCurrentPage(1);
  }, [filter, sort, searchQuery]);

  const totalPages = isShowAll ? 1 : Math.max(1, Math.ceil(filteredGames.length / pageSize));

  useEffect(() => {
    if (!isShowAll && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages, isShowAll]);

  const paginatedGames = useMemo(() => {
    if (isShowAll) return filteredGames;
    const start = (currentPage - 1) * pageSize;
    return filteredGames.slice(start, start + pageSize);
  }, [filteredGames, currentPage, pageSize, isShowAll]);

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
  }, [paginatedGames, settings.steamGridDbApiKey, settings.steamGridDbArtworkEnabled]);

  // Progressive render for large grids — render in chunks to avoid blocking the UI
  const PROGRESSIVE_CHUNK = 44;
  const [renderedCardCount, setRenderedCardCount] = useState(PROGRESSIVE_CHUNK);

  useEffect(() => {
    if (isShowAll && filteredGames.length > PROGRESSIVE_CHUNK) {
      setRenderedCardCount(PROGRESSIVE_CHUNK);
      const timer = setTimeout(() => {
        setRenderedCardCount(filteredGames.length);
      }, 200);
      return () => clearTimeout(timer);
    }
    setRenderedCardCount(filteredGames.length);
  }, [isShowAll, filteredGames.length]);

  const visibleGames = useMemo(() => {
    return paginatedGames.slice(0, isShowAll ? renderedCardCount : paginatedGames.length);
  }, [paginatedGames, isShowAll, renderedCardCount]);

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
    } else if (game.source === "epic" && game.isPlayable) {
      try {
        await session.launchGame(game);
      } catch (err) {
        showError(String(err), { title: "Error" });
      }
    } else if (game.source === "epic" && !game.isPlayable) {
      showWarning("Epic launch is not enabled for this game.", { title: "Not available" });
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
      const deleteResult = await deleteLuaScript({ luaPath: settings.luaPath, fileName: script.file_name });
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][RUST_RESULT] appid=${game.appId} file="${script.file_name}" success=${deleteResult.success} message="${deleteResult.message}"`);
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

  async function handleCheckUpdates() {
    if (!hasLuaPath) {
      showWarning("Configure a Lua path first.", { title: "Path required" });
      return;
    }
    try {
      setCheckingUpdates(true);
      const hubcapSettings = settings.providers?.hubcapdb;
      const hubcapConfig = hubcapSettings?.enabled && hubcapSettings?.baseUrl && hubcapSettings?.apiKey
        ? { baseUrl: hubcapSettings.baseUrl, apiKey: hubcapSettings.apiKey }
        : undefined;
      const summary = await runInstalledLuaScan({ luaDir: settings.luaPath, hubcapConfig, force: true });
      const updates = summary.updates;
      if (updates > 0) {
        showSuccess(`${updates} update${updates === 1 ? "" : "s"} found.`, { title: "Updates" });
        setFilter("updates");
      } else {
        showSuccess("All packages up to date.", { title: "Checked" });
      }
      console.log(`[LIBRARY][FILTER_UPDATES] count=${updates}`);
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
    // Rebuild auth headers from settings at request time (never from cache)
    const effectiveHeaders = source.authHeaders ?? getEffectiveProviderAuthHeaders(source.providerId, settings);
    try {
      showSuccess(`Downloading from ${source.providerName}...`, { title: "Download started" });
      await downloadAndInstallPackage({
        jobId: `sync-${game.appId}-${Date.now()}`,
        downloadUrl: source.downloadUrl,
        luaTarget: settings.luaPath,
        depotcacheTarget: settings.depotcachePath,
        createBackups: true,
        headers: effectiveHeaders,
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

      if (game.appId) {
        const hubcapConfig = (settings.providers?.hubcapdb?.baseUrl && settings.providers?.hubcapdb?.apiKey)
          ? { baseUrl: settings.providers.hubcapdb.baseUrl, apiKey: settings.providers.hubcapdb.apiKey }
          : undefined;
        const providerOpts: ProviderStatusOptions = {
          luaDir: settings.luaPath || undefined,
          steamRoot: settings.steamRoot || undefined,
        };
        await saveProviderStatusAfterInstall(game.appId, source.providerId, hubcapConfig, providerOpts);
      }

      showSuccess(`Sync complete from ${source.providerName}.`, { title: "Synced" });
      await refresh();
    } catch (error) {
      console.error(error);
      showError(error instanceof Error ? error.message : "Sync failed.", { title: "Error" });
    }
  }

  const showLuaSetup = !hasLuaPath;
  const hasLuaGames = games.some((g) => g.hasLua);

  const handleOpenGame = useCallback((game: LibraryGame) => {
    setSelectedGame(game);
    onNavigate?.("library-game-detail");
  }, [setSelectedGame, onNavigate]);

  function handleResetFilters() {
    startTransition(() => {
      setFilter("all");
      setSort("name");
      setSearchQuery("");
    });
  }

  return (
    <div className="flex h-full flex-col lf-page-in">
      <div className="flex min-w-0 flex-1 flex-col">
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
          <PageContainer className="flex flex-1 flex-col py-5 lg:py-7">
            <LibrarySectionSkeleton />
            <GridSkeleton
              poster={(settings.libraryCardArtworkMode ?? "landscape") === "poster"}
              count={8}
            />
          </PageContainer>
        ) : (
          <>
            <PageContainer className={`flex flex-1 flex-col py-6 lg:py-8 ${settings.libraryUseFullWidth ? "!max-w-none" : ""}`}>
              <div className="flex-1 lg:grid lg:gap-6" style={{ gridTemplateColumns: `1fr ${settings.libraryFilterPanelWidth}px` }}>
                <div className="min-w-0 flex flex-col">
                  <div>
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
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setAddGameOpen(true)}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-white/[0.04] px-2.5 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) focus-visible:ring-2 focus-visible:ring-(--color-accent)/30 lf-press-effect"
                          title="Add Game"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Add Game</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleCheckUpdates}
                          disabled={checkingUpdates || !hasLuaGames}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-white/[0.04] px-2.5 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-(--color-accent)/30 lf-press-effect"
                          title="Check Updates"
                        >
                          <RefreshCcw className={`h-3.5 w-3.5 ${checkingUpdates ? "animate-spin" : ""}`} />
                          <span className="hidden sm:inline">Updates</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => refresh()}
                          disabled={loading}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent)/10 px-2.5 py-2 text-xs font-medium text-(--color-accent) transition hover:bg-(--color-accent)/15 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-(--color-accent)/30 lf-press-effect"
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

                    {focusAppId && (
                      <div className="mb-5 flex items-center gap-3 rounded-xl border border-(--color-accent)/20 bg-(--color-accent)/5 px-4 py-3">
                        <Search className="h-4 w-4 shrink-0 text-(--color-accent)" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-(--color-text)">
                            Showing: {focusTitle || `Game ${focusAppId}`}
                          </p>
                          <p className="mt-0.5 text-xs text-(--color-muted)">
                            {displayGames.length > 0
                              ? "Game found in your library."
                              : "Game not yet in library — try refreshing or installing."}
                          </p>
                        </div>
                        {displayGames.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setFocusAppId(null);
                              setFocusTitle(null);
                              console.log(`[LIBRARY_FOCUS][CLEAR] reason=user-dismiss`);
                            }}
                            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
                          >
                            <X className="h-3.5 w-3.5" />
                            Show all games
                          </button>
                        )}
                        {displayGames.length === 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              refresh();
                              console.log(`[LIBRARY_FOCUS][REFRESH] appid=${focusAppId}`);
                            }}
                            disabled={loading}
                            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent)/10 px-2.5 py-1.5 text-xs font-medium text-(--color-accent) transition hover:bg-(--color-accent)/15 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                            Refresh library
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                    {visibleGames.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-12 text-center">
                      {filter === "lua" ? (
                        <>
                          <FileCode2 className="mx-auto h-10 w-10 text-(--color-muted)" />
                          <h2 className="mt-4 font-semibold text-(--color-text)">No installed Lua scripts found</h2>
                          <p className="mt-1.5 text-sm text-(--color-muted)">
                            Download Lua from the Store or sync a supported game.
                          </p>
                        </>
                      ) : filter === "updates" ? (
                        <>
                          <FolderSearch className="mx-auto h-10 w-10 text-(--color-muted)" />
                          <h2 className="mt-4 font-semibold text-(--color-text)">No package updates available</h2>
                          <p className="mt-1.5 text-sm text-(--color-muted)">All installed Lua packages are up to date.</p>
                        </>
                      ) : (
                        <>
                          <FolderSearch className="mx-auto h-10 w-10 text-(--color-muted)" />
                          <h2 className="mt-4 font-semibold text-(--color-text)">No items match these filters.</h2>
                          <p className="mt-1.5 text-sm text-(--color-muted)">Try clearing filters or changing your search.</p>
                        </>
                      )}
                      {(filter !== "all" || searchQuery) && (
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent)/10 px-3 py-2 text-xs font-medium text-(--color-accent) transition hover:bg-(--color-accent)/15 focus-visible:ring-2 focus-visible:ring-(--color-accent)/30"
                      >
                        Reset filters
                      </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1">
                      {layout === "grid" ? (
                        <div
                          className="grid lf-card-stagger"
                          style={{
                            gridTemplateColumns: `repeat(auto-fill, minmax(${settings.libraryCardArtworkMode === "landscape" ? settings.libraryLandscapeCardSize : settings.libraryCardSize}px, 1fr))`,
                            gap: `${settings.libraryCardArtworkMode === "landscape" ? settings.libraryLandscapeGap : settings.libraryGridGap}px`,
                          }}>
                          {visibleGames.map((game) => (
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
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          {visibleGames.map((game) => (
                            <button
                              key={game.id}
                              type="button"
                              onClick={() => handleOpenGame(game)}
                              className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-(--color-accent)/30 lf-press-effect"
                            >
                              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
                                {game.imageUrl ? (
                                  <img src={game.imageUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <Gamepad2 className="h-4 w-4 text-(--color-muted)" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium text-(--color-text)">{game.title}</p>
                                <p className="truncate text-[11px] text-(--color-muted)">
                                  {game.metadata?.developer || game.source || ""}
                                  {game.sizeOnDisk ? ` · ${(game.sizeOnDisk / 1073741824).toFixed(1)} GB` : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {game.hasLua && <span className="rounded bg-(--color-accent)/10 px-1.5 py-0.5 text-[9px] text-(--color-accent)">Lua</span>}
                                {game.source === "epic" && <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] text-blue-400">Epic</span>}
                                {game.steamInstalled && <span className="hidden text-[10px] text-(--color-muted)/50 sm:inline">Installed</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="hidden lg:block">
                  <LibraryFilterPanel
                    filter={filter}
                    sort={sort}
                    query={searchQuery}
                    filteredCount={filteredGames.length}
                    totalCount={displayGames.length}
                    panelWidth={settings.libraryFilterPanelWidth}
                    onFilterChange={setFilter}
                    onSortChange={setSort}
                    onQueryChange={setSearchQuery}
                    onReset={handleResetFilters}
                  />
                </div>
              </div>
            </PageContainer>

            {visibleGames.length > 0 && (
              <div className="shrink-0 bg-(--color-bg)/60">
                <div className={`mx-auto flex w-full items-center justify-between px-6 py-2.5 lg:px-8 xl:px-10 ${settings.libraryUseFullWidth ? "" : "max-w-[1900px]"}`}>
                  <div className="flex items-center gap-2 text-sm text-(--color-muted)">
                    {/* Layout toggle */}
                    <div className="mr-2 flex items-center overflow-hidden rounded-lg border border-(--surface-active-border)/30 bg-(--color-surface)">
                      <button
                        type="button"
                        onClick={() => setLayout("grid")}
                        className={`inline-flex cursor-pointer items-center gap-1 px-2.5 py-1.5 text-[11px] transition ${
                          layout === "grid"
                            ? "bg-(--color-accent)/15 text-(--color-accent)"
                            : "text-(--color-muted) hover:text-(--color-text)"
                        }`}
                        title="Grid view"
                      >
                        <Grid3X3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setLayout("list")}
                        className={`inline-flex cursor-pointer items-center gap-1 px-2.5 py-1.5 text-[11px] transition ${
                          layout === "list"
                            ? "bg-(--color-accent)/15 text-(--color-accent)"
                            : "text-(--color-muted) hover:text-(--color-text)"
                        }`}
                        title="List view"
                      >
                        <List className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <span className="text-xs font-medium uppercase tracking-wider text-(--color-muted)/60">{layout === "grid" ? "Grid" : "List"}</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="lf-select rounded-lg bg-(--color-surface) px-3 py-1.5 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-(--color-accent)/20"
                    >
                      {PAGE_SIZES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                      <option value={SHOW_ALL}>Show All</option>
                    </select>
                  </div>

                  {totalPages > 1 && (
                    <nav className="flex items-center gap-1.5" aria-label="Library pagination">
                      {DEBUG_LIBRARY_PAGINATION && (() => {
                        const tokens = getPaginationTokens(currentPage, totalPages);
                        console.log("[LIBRARY_PAGINATION][TOKENS]", { file: "Library.tsx", currentPage, totalPages, compactMode: totalPages >= 5, tokens: tokens.map((t) => t.type === "ellipsis" ? "..." : t.value) });
                        return null;
                      })()}
                      <button
                        type="button"
                        disabled={currentPage <= 1}
                        aria-label="Previous page"
                        onClick={() => startTransition(() => setCurrentPage((p) => Math.max(1, p - 1)))}
                        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-sm text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      {getPaginationTokens(currentPage, totalPages).map((token) =>
                        token.type === "ellipsis" ? (
                          <span
                            key={token.key}
                            className="inline-flex h-8 w-8 items-center justify-center text-sm font-medium text-(--color-muted)/50"
                            aria-hidden="true"
                          >
                            ...
                          </span>
                        ) : (
                          <button
                            key={token.value}
                            type="button"
                            aria-label={`Go to page ${token.value}`}
                            aria-current={token.value === currentPage ? "page" : undefined}
                            onClick={() => {
                              if (token.value !== currentPage) {
                                startTransition(() => setCurrentPage(token.value));
                              }
                            }}
                            className={`inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-sm font-medium transition ${
                              token.value === currentPage
                                ? "bg-(--color-accent)/20 text-(--color-accent)"
                                : "text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
                            }`}
                          >
                            {token.value}
                          </button>
                        ),
                      )}
                      <button
                        type="button"
                        disabled={currentPage >= totalPages}
                        aria-label="Next page"
                        onClick={() => startTransition(() => setCurrentPage((p) => Math.min(totalPages, p + 1)))}
                        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-sm text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </nav>
                  )}

                  <div className="text-xs text-(--color-muted)/60">
                    {filteredGames.length} game{filteredGames.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

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
      <GameEditDialog
        open={addGameOpen}
        onClose={() => setAddGameOpen(false)}
        initialTab="general"
        settings={{
          rawgApiKey: settings?.rawgApiKey ?? "",
          igdbClientId: settings?.igdbClientId ?? "",
          igdbClientSecret: settings?.igdbClientSecret ?? "",
          steamGridDbApiKey: settings?.steamGridDbApiKey ?? "",
          steamGridDbArtworkEnabled: settings?.steamGridDbArtworkEnabled ?? false,
        }}
      />
    </div>
  );
}
