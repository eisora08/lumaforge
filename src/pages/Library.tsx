import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  FileCode2,
  FolderSearch,
  Gamepad2,
  Grid3X3,
  List,
  Plus,
  RefreshCcw,
  Settings,
  X,
  Search,
  ChevronDown,
  Pencil,
  Scan,
} from "lucide-react";

import PageContainer from "../components/layout/PageContainer";
import GameLauncherTile from "../components/games/GameLauncherTile";
import GameHoverPreview from "../components/games/GameHoverPreview";
import GameEditDialog from "../components/games/GameEditDialog";
import GameScannerModal from "../components/games/GameScannerModal";
import type { ScannedProgram } from "../components/games/GameScannerModal";
import LibraryFilterPanel from "../components/library/LibraryFilterPanel";
import type { LibraryFilter, LibrarySort } from "../components/library/LibraryFilterPanel";
import StoreSourceSelectorModal from "../components/store/StoreSourceSelectorModal";
import { GridSkeleton, LibrarySectionSkeleton } from "../components/common/Skeleton";

import { useSettings } from "../context/SettingsContext";
import { useLibraryGames } from "../context/LibraryGamesContext";
import { useGameSession } from "../context/GameSessionContext";
import { useDownloadQueueContext } from "../context/DownloadQueueContext";
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
import { isAppIdInFlight } from "../services/mediaDownloadQueue";
import { detectAndQueueMissingMedia, isSystemToolApp } from "../services/gameCacheService";
import { isBootReady } from "../services/appBootCoordinator";
import { isSidebarInstalledGame } from "../services/gameCacheService";
import { consumePendingLibraryFocus } from "../services/libraryNavigationService";
import { setAmbientSource, clearAmbientSource, getLastLibraryDetailsUrl } from "../services/ambientBackgroundStore";
import { saveManualGame } from "../services/manualGameStore";
import type { ManualGameEntry } from "../services/manualGameStore";

import DebridSourceSelectorModal from "../components/debrid/DebridSourceSelectorModal";
import { DEBRID_INSTALL_ENABLED, DEBRID_LIBRARY_ENABLED, DEBUG_DEBRID_INSTALL } from "../features/debrid/debridFeatureFlag";
import type { RepackQueryResult } from "../services/tauri";
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
import { resolveDebridInstallUri } from "../services/debridInstallChoice";

const DEBUG_LUA_DELETE = false;

type Props = {
  onNavigate?: (page: AppPage) => void;
};

export default function LibraryPage({ onNavigate }: Props) {
  const { settings } = useSettings();
  const { games, warnings, loading, initialLoading, setSelectedGame, refresh, appInfoMap } = useLibraryGames();
  const session = useGameSession();
  const downloadQueue = useDownloadQueueContext();
  const hasLuaPath = Boolean(settings.luaPath);
  const [, startTransition] = useTransition();

  const [sourceSelectorGame, setSourceSelectorGame] = useState<LibraryGame | null>(null);
  const [addGameOpen, setAddGameOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [tileOverlayOpen, setTileOverlayOpen] = useState(false);
  const [debridRepacks, setDebridRepacks] = useState<RepackQueryResult[]>([]);
  const [debridInstallGame, setDebridInstallGame] = useState<LibraryGame | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("name");
  const [searchQuery, setSearchQuery] = useState("");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const queuedMediaRef = useRef<Map<string, number>>(new Map());
  const { confirm } = useConfirm();

  // Game hover preview state
  const [hoveredGame, setHoveredGame] = useState<LibraryGame | null>(null);
  const [gamePosition, setGamePosition] = useState<DOMRect | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHoverStart = useCallback((game: LibraryGame, rect: DOMRect) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredGame(game);
      setGamePosition(rect);
    }, 500);
  }, []);

  const handleHoverEnd = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoveredGame(null);
    setGamePosition(null);
  }, []);

  // Clear hover preview on scroll
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    function handleScroll() {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
      setHoveredGame(null);
      setGamePosition(null);
    }
    main.addEventListener('scroll', handleScroll, { passive: true });
    return () => main.removeEventListener('scroll', handleScroll);
  }, []);

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
      console.log(`[LIBRARY_FOCUS][MOUNT] appid=${pending.appId} title="${pending.title || ""}"`);
    }
  }, []);

  // Ambient background: keep showing the last library game's details art while
  // the grid is mounted. LibraryGameDetails remembers it before unmounting; the
  // detail cleanup runs before this effect, so the grid never falls back to the
  // static page-context right after returning from a game detail.
  useEffect(() => {
    const url = getLastLibraryDetailsUrl();
    if (url) setAmbientSource("library-page", url);
    return () => clearAmbientSource("library-page");
  }, []);

  const displayGames = useMemo(() => {
    const sorted = [...games].sort((a, b) => a.title.localeCompare(b.title));
    if (focusAppId) {
      return sorted.filter((g) => g.appId === focusAppId);
    }
    return sorted;
  }, [games, focusAppId]);

  const filteredGames = useMemo(() => {
    let result = displayGames;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (g) => g.title.toLowerCase().includes(q) || g.appId?.toLowerCase().includes(q)
      );
    }

    result = result.filter((g) => {
      if (filter === "lua" && !g.hasLua) return false;
      if (filter === "installed" && !isSidebarInstalledGame(g)) return false;
      if (filter === "disabled" && !g.isLuaDisabled) return false;
      if (filter === "epic" && g.source !== "epic") return false;
      return true;
    });

    result = [...result].sort((a, b) => {
      if (sort === "size") return (b.sizeOnDisk || 0) - (a.sizeOnDisk || 0);
      if (sort === "updated") return (b.lastUpdated || 0) - (a.lastUpdated || 0);
      return a.title.localeCompare(b.title);
    });

    return result;
  }, [displayGames, filter, sort, searchQuery]);

  // ─── Infinite scroll ───────────────────────────────────────────────────────
  const INFINITE_CHUNK = 44;
  const [renderedCount, setRenderedCount] = useState(INFINITE_CHUNK);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset rendered count when filters change
  useEffect(() => {
    setRenderedCount(INFINITE_CHUNK);
  }, [filter, sort, searchQuery, focusAppId]);

  // IntersectionObserver to load more cards
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setRenderedCount((prev) => {
            if (prev >= filteredGames.length) return prev;
            return Math.min(prev + INFINITE_CHUNK, filteredGames.length);
          });
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredGames.length]);

  const visibleGames = useMemo(() => {
    return filteredGames.slice(0, renderedCount);
  }, [filteredGames, renderedCount]);

  // Resolve artwork/cache for visible games — queued, throttled, cache-first
  const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes before retry
  useEffect(() => {
    const now = Date.now();
    const toQueue = visibleGames.filter((g) => {
      if (!g.appId) return false;
      if (isAppIdInFlight(g.appId)) return false;
      const lastAttempt = queuedMediaRef.current.get(g.appId);
      if (lastAttempt && now - lastAttempt < RETRY_INTERVAL_MS) return false;
      return true;
    });

    if (toQueue.length === 0) return;

    for (const game of toQueue) {
      queuedMediaRef.current.set(game.appId!, Date.now());
      detectAndQueueMissingMedia(game.appId!, "library-visible").catch(() => {});
    }
  }, [visibleGames, settings.steamGridDbApiKey, settings.steamGridDbArtworkEnabled]);

  // Idle-phase bulk artwork download — runs once after boot is ready + 10s idle
  // Downloads missing artworks for ALL library games in batches of 8
  const IDLE_BULK_BATCH = 8;
  const IDLE_BULK_DELAY_MS = 10_000; // 10s after boot
  useEffect(() => {
    if (games.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runIdleBulk = async () => {
      // Wait for boot to be ready
      while (!isBootReady() && !cancelled) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (cancelled) return;
      // Wait additional idle time
      await new Promise((r) => { timer = setTimeout(r, IDLE_BULK_DELAY_MS); });
      if (cancelled) return;

      // Process all games with appId in batches
      const allGames = games.filter((g) => g.appId && !isSystemToolApp(g.appId));
      for (let i = 0; i < allGames.length; i += IDLE_BULK_BATCH) {
        if (cancelled) break;
        const batch = allGames.slice(i, i + IDLE_BULK_BATCH);
        await Promise.allSettled(
          batch.map((g) =>
            detectAndQueueMissingMedia(g.appId!, "idle-bulk").catch(() => {})
          )
        );
        // Small delay between batches to avoid disk thrashing
        if (!cancelled && i + IDLE_BULK_BATCH < allGames.length) {
          await new Promise((r) => { timer = setTimeout(r, 2000); });
        }
      }
    };

    runIdleBulk();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [games]);

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
    if (game.source === "debrid" && DEBRID_INSTALL_ENABLED && DEBRID_LIBRARY_ENABLED) {
      if (game.appId) {
        const { getRepacksForAppId } = await import("../services/repackCatalogService");
        const repacks = await getRepacksForAppId(Number(game.appId));
        if (repacks.length > 1) {
          if (DEBUG_DEBRID_INSTALL) console.log(`[DEBRID][INSTALL_SELECTOR] appId=${game.appId} title="${game.title}" repacks=${repacks.length}`);
          setDebridRepacks(repacks);
          setDebridInstallGame(game);
          return;
        }
        if (repacks.length === 1) {
          const rawEntry = repacks[0];
          const resolved = await resolveDebridInstallUri(rawEntry.downloadUris, confirm, game.title);
          if (!resolved.ok) {
            if (resolved.reason === "no-uri") {
              showWarning("No download URI available for this Debrid game.", { title: "Not available" });
            }
            return;
          }
          downloadQueue.addDebridInstallJob(
            rawEntry.id,
            game.title,
            resolved.uri,
            rawEntry.installerType || "zip",
            game.appId ?? "",
            undefined,
            rawEntry.repacker,
            resolved.method,
          );
          return;
        }
      }
      const { getDebridRepackEntry } = await import("../services/debridGameStore");
      const providerGameId = game.providerGameId ?? game.id;
      const rawEntry = getDebridRepackEntry(providerGameId);
      if (!rawEntry) {
        showWarning("Debrid game entry not found.", { title: "Not available" });
        return;
      }
      const resolved = await resolveDebridInstallUri(rawEntry.downloadUris, confirm, game.title);
      if (!resolved.ok) {
        if (resolved.reason === "no-uri") {
          showWarning("No download URI available for this Debrid game.", { title: "Not available" });
        }
        return;
      }
      downloadQueue.addDebridInstallJob(
        providerGameId,
        game.title,
        resolved.uri,
        rawEntry.installerType || "zip",
        game.appId ?? "",
        undefined,
        game.repacker,
        resolved.method,
      );
      return;
    }

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
      const remaining = await scanInstalledLuaScripts(settings.luaPath, { force: true });
      const stillPresent = remaining.some((s) => s.file_name === script.file_name);
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][VERIFY] appid=${game.appId} file="${script.file_name}" stillPresent=${stillPresent}`);
      if (stillPresent) {
        showError("File still exists on disk after deletion attempt.", { title: "Deletion failed" });
        return;
      }
      await refresh({ force: true });
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][UI_RESULT] appid=${game.appId} file="${script.file_name}" success=true`);
      showSuccess("Lua script deleted.", { title: "Deleted" });
    } catch (err) {
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][UI_RESULT] appid=${game.appId} file="${script.file_name}" error="${String(err)}"`);
      showError(String(err), { title: "Error" });
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

  const handleOpenGame = useCallback((game: LibraryGame) => {
    setSelectedGame(game);
    onNavigate?.("library-game-detail");
  }, [setSelectedGame, onNavigate]);

  const handleScanAdd = useCallback((programs: ScannedProgram[]) => {
    for (const p of programs) {
      const entry: ManualGameEntry = {
        id: `manual:${crypto.randomUUID()}`,
        name: p.name,
        executablePath: p.exePath || undefined,
        installDir: p.installPath || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveManualGame(entry);
    }
    setScannerOpen(false);
  }, []);

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
          <PageContainer className={`flex flex-1 flex-col py-6 lg:py-8 ${settings.libraryUseFullWidth ? "!max-w-none" : ""}`}>
            <div className="flex-1 lg:grid lg:gap-6" style={{ gridTemplateColumns: `1fr ${settings.libraryFilterPanelWidth}px` }}>
              <div className="min-w-0 flex flex-col">
                <div>
                  <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h1 className="text-2xl font-bold text-(--color-text) lg:text-3xl">Biblioteca</h1>
                      <p className="mt-1 text-sm text-(--color-muted)">
                        {filteredGames.length} game{filteredGames.length === 1 ? "" : "s"}
                        {loading && !initialLoading && " · scanning..."}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <div className="flex">
                          <button
                            type="button"
                            onClick={() => setAddGameOpen(true)}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-l-xl bg-white/[0.04] px-2.5 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) focus-visible:ring-2 focus-visible:ring-(--color-accent)/30 lf-press-effect"
                            title="Add Manual Game"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Add Game</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddMenuOpen((v) => !v)}
                            className="inline-flex cursor-pointer items-center rounded-r-xl border-l border-white/[0.06] bg-white/[0.04] px-1.5 py-2 text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) focus-visible:ring-2 focus-visible:ring-(--color-accent)/30 lf-press-effect"
                            title="More options"
                          >
                            <ChevronDown className={`h-3 w-3 transition-transform ${addMenuOpen ? "rotate-180" : ""}`} />
                          </button>
                        </div>
                        {addMenuOpen && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setAddMenuOpen(false)} />
                            <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface) shadow-2xl shadow-black/50">
                              <button
                                onClick={() => { setAddGameOpen(true); setAddMenuOpen(false); }}
                                className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/5 hover:text-(--color-text)"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                <div>
                                  <div className="font-medium">Manual Entry</div>
                                  <div className="text-[10px] text-(--color-muted)/50">Create game from scratch</div>
                                </div>
                              </button>
                              <div className="mx-2 border-t border-(--surface-active-border)/30" />
                              <button
                                onClick={() => { setScannerOpen(true); setAddMenuOpen(false); }}
                                className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/5 hover:text-(--color-text)"
                              >
                                <Scan className="h-3.5 w-3.5" />
                                <div>
                                  <div className="font-medium">Scan Installed</div>
                                  <div className="text-[10px] text-(--color-muted)/50">Detect games on your PC</div>
                                </div>
                              </button>
                            </div>
                          </>
                        )}
                      </div>

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

                      {/* Grid/List toggle */}
                      <div className="flex items-center overflow-hidden rounded-xl border border-(--surface-active-border)/30 bg-(--color-surface)">
                        <button
                          type="button"
                          onClick={() => setLayout("grid")}
                          className={`inline-flex cursor-pointer items-center gap-1 px-2.5 py-2 text-[11px] transition ${
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
                          className={`inline-flex cursor-pointer items-center gap-1 px-2.5 py-2 text-[11px] transition ${
                            layout === "list"
                              ? "bg-(--color-accent)/15 text-(--color-accent)"
                              : "text-(--color-muted) hover:text-(--color-text)"
                          }`}
                          title="List view"
                        >
                          <List className="h-3.5 w-3.5" />
                        </button>
                      </div>
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
                            onHoverStart={handleHoverStart}
                            onHoverEnd={handleHoverEnd}
                            onOverlayToggle={setTileOverlayOpen}
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
                              {game.source === "debrid" && (
                                <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-400">
                                  {game.repacker ? game.repacker.toUpperCase() : "Debrid"}
                                </span>
                              )}
                              {game.steamInstalled && <span className="hidden text-[10px] text-(--color-muted)/50 sm:inline">Installed</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Infinite scroll sentinel */}
                    {renderedCount < filteredGames.length && (
                      <div ref={sentinelRef} className="flex justify-center py-8">
                        <RefreshCcw className="h-5 w-5 animate-spin text-(--color-muted)/40" />
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
        )}
      </div>

      <DebridSourceSelectorModal
        open={debridRepacks.length > 0 && Boolean(debridInstallGame)}
        repacks={debridRepacks}
        gameTitle={debridInstallGame?.title ?? ""}
        appId={debridInstallGame?.appId}
        onInstallSource={async (repack: RepackQueryResult) => {
          if (!debridInstallGame) return;
          const resolved = await resolveDebridInstallUri(repack.downloadUris, confirm, debridInstallGame.title);
          if (!resolved.ok) {
            if (resolved.reason === "no-uri") {
              showWarning("No download URI available for this Debrid source.", { title: "Not available" });
            }
            return;
          }
          downloadQueue.addDebridInstallJob(
            repack.id,
            debridInstallGame.title,
            resolved.uri,
            repack.installerType || "zip",
            debridInstallGame.appId ?? "",
            undefined,
            debridInstallGame.repacker,
            resolved.method,
          );
        }}
        onClose={() => {
          setDebridRepacks([]);
          setDebridInstallGame(null);
        }}
      />
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
        initialTab="details"
        settings={{
          rawgApiKey: settings?.rawgApiKey ?? "",
          igdbClientId: settings?.igdbClientId ?? "",
          igdbClientSecret: settings?.igdbClientSecret ?? "",
          steamGridDbApiKey: settings?.steamGridDbApiKey ?? "",
          steamGridDbArtworkEnabled: settings?.steamGridDbArtworkEnabled ?? false,
        }}
      />
      <GameScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onAdd={handleScanAdd}
        games={games}
      />
      {hoveredGame && gamePosition && !tileOverlayOpen && !sourceSelectorGame && !addGameOpen && !scannerOpen && (
        <GameHoverPreview
          game={hoveredGame}
          position={gamePosition}
        />
      )}
    </div>
  );
}
