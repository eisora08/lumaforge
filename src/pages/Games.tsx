import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  FolderSearch,
  Gamepad2,
  Play,
  Plus,
  RefreshCcw,
  SlidersHorizontal,
  Trash2,
  Settings,
  Clock,
} from "lucide-react";

import PageContainer from "../components/layout/PageContainer";
import GameLauncherTile from "../components/games/GameLauncherTile";
import GamesFilterPanel from "../components/filters/GamesFilterPanel";
import type { GamesSourceFilter, GamesInstallFilter, GamesSortKey, GamesViewMode } from "../components/filters/GamesFilterPanel";

import { useSettings } from "../context/SettingsContext";
import { resolveLauncherGames, type DetectionResult } from "../services/gameDetectionResolver";
import {
  loadCachedGames,
  saveCachedGames,
  isCacheExpired,
} from "../services/gameDetectionCache";
import { openExternalUrl } from "../services/externalLinks";

import type { LauncherGame } from "../types/launcherGame";

import {
  showError,
  showSuccess,
  showWarning,
} from "../components/toast/GameToast";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().trim() : "";
}

function stableIdFromString(prefix: string, value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0;
  }
  return `${prefix}-${Math.abs(hash).toString(36)}`;
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function GamesPage() {
  const { settings } = useSettings();
  console.log("[GamesPage] mounted with settings:", {
    steamRoot: settings.steamRoot,
    luaPath: settings.luaPath,
    depotcachePath: settings.depotcachePath,
    gameScanFoldersCount: settings.gameScanFolders.length,
    scanLocalGames: settings.scanLocalGames,
  });

  const [games, setGames] = useState<LauncherGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [detectionErrors, setDetectionErrors] = useState<string[]>([]);
  const [selectedGame, setSelectedGame] = useState<LauncherGame | null>(null);

  const [localQuery, setLocalQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<GamesSourceFilter>("all");
  const [installFilter, setInstallFilter] = useState<GamesInstallFilter>("all");
  const [sortBy, setSortBy] = useState<GamesSortKey>("name");
  const [viewMode, setViewMode] = useState<GamesViewMode>("grid");
  const [showFilters, setShowFilters] = useState(false);

  const [manualPath, setManualPath] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const manualInputRef = useRef<HTMLInputElement | null>(null);

  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const [hasDoneInitialScan, setHasDoneInitialScan] = useState(false);
  const initialLoadDone = useRef(false);

  async function runDetection() {
    console.log("[GamesPage] runDetection called");
    try {
      setLoading(true);
      setError(null);
      setDetectionErrors([]);
      setWarnings([]);
      const result: DetectionResult = await resolveLauncherGames(settings);
      console.log("[GamesPage] detection complete:", {
        gamesCount: result.games.length,
        warningsCount: result.warnings.length,
        errorsCount: result.errors.length,
      });
      setGames(result.games);
      setWarnings(result.warnings);
      setDetectionErrors(result.errors);
      setIsFromCache(false);
      setCacheTimestamp(Date.now());
      saveCachedGames(result.games, result.warnings, result.errors);
    } catch (error) {
      console.error("[GamesPage] detection error:", error);
      setError(error instanceof Error ? error.message : "Could not detect games.");
    } finally {
      setLoading(false);
      setHasDoneInitialScan(true);
    }
  }

  async function loadGames() {
    console.log("[GamesPage] loadGames called (user-initiated scan)");
    await runDetection();
  }

  // On mount: load cache first, then optionally refresh
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const cached = loadCachedGames();
    if (cached) {
      console.log("[GamesPage] loaded from cache, savedAt:", new Date(cached.savedAt).toISOString());
      setGames(cached.games);
      setWarnings(cached.warnings || []);
      setDetectionErrors(cached.errors || []);
      setCacheTimestamp(cached.savedAt);
      setIsFromCache(true);
      setHasDoneInitialScan(true);

      if (isCacheExpired(cached)) {
        console.log("[GamesPage] cache expired, refreshing in background");
        runDetection();
      } else {
        console.log("[GamesPage] cache still valid, skipping auto-scan");
      }
    } else {
      console.log("[GamesPage] no cache, running detection");
      runDetection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePlay(game: LauncherGame) {
    if (game.source === "steam" && game.appId) {
      try {
        await openExternalUrl(`steam://run/${game.appId}`);
      } catch {
        showError("No se pudo abrir Steam.", { title: "Error" });
      }
    } else if (game.source === "local" && game.executablePath) {
      try {
        await openExternalUrl(`file:///${game.executablePath.replace(/\\/g, "/")}`);
      } catch {
        showError("No se pudo abrir el ejecutable local.", { title: "Error" });
      }
    } else {
      showWarning("This game cannot be launched yet.", {
        title: "Not available",
      });
    }
  }

  async function handleInstall(game: LauncherGame) {
    if (game.source === "steam" && game.appId) {
      try {
        await openExternalUrl(`steam://install/${game.appId}`);
      } catch {
        showError("No se pudo abrir Steam.", { title: "Error" });
      }
    }
  }

  function handleRemoveLocalExe(exePath: string) {
    setGames((prev) => {
      const targetId = stableIdFromString("local", exePath);
      showSuccess("Local game removed.", { title: "Removed" });
      return prev.filter((g) => g.id !== targetId);
    });
  }

  function handleAddManualExe() {
    const trimmed = manualPath.trim();
    if (!trimmed) return;
    if (!trimmed.toLowerCase().endsWith(".exe")) {
      showWarning("Path must point to a .exe file.", { title: "Invalid path" });
      return;
    }
    const exePath = trimmed;
    const fileName = exePath.split("\\").pop()?.split("/").pop() || exePath;
    const dirName = exePath.split("\\").slice(-2, -1)[0]?.split("/").slice(-1)[0] || "";

    const newGame: LauncherGame = {
      id: stableIdFromString("local", exePath),
      title: fileName,
      source: "local",
      executablePath: exePath,
      installDir: dirName,
      isInstalled: true,
      isPlayable: true,
    };

    setGames((prev) => {
      if (prev.some((g) => g.id === newGame.id)) return prev;
      return [...prev, newGame].sort((a, b) => a.title.localeCompare(b.title));
    });

    setManualPath("");
    setShowManualInput(false);
    showSuccess("Local executable added.", { title: "Added" });
  }

  const filteredGames = useMemo(() => {
    const normalizedQuery = normalizeText(localQuery);
    const filtered = games.filter((g) => {
      const gameTitle = normalizeText(g.title);
      const matchesQuery =
        !normalizedQuery ||
        gameTitle.includes(normalizedQuery) ||
        normalizeText(g.appId).includes(normalizedQuery) ||
        normalizeText(g.executablePath || "").includes(normalizedQuery);

      const matchesSource =
        sourceFilter === "all" ||
        (sourceFilter === "steam" && g.source === "steam") ||
        (sourceFilter === "local" && g.source === "local");

      const matchesInstall =
        installFilter === "all" ||
        (installFilter === "installed" && g.isInstalled) ||
        (installFilter === "not-installed" && !g.isInstalled) ||
        (installFilter === "missing-path" && !g.isInstalled && !g.executablePath);

      return matchesQuery && matchesSource && matchesInstall;
    });

    if (sortBy === "name") {
      return filtered.sort((a, b) => a.title.localeCompare(b.title));
    }

    return filtered.sort((a, b) => {
      if (a.isInstalled !== b.isInstalled) return a.isInstalled ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
  }, [games, localQuery, sourceFilter, installFilter, sortBy]);

  function resetFilters() {
    setLocalQuery("");
    setSourceFilter("all");
    setInstallFilter("all");
    setSortBy("name");
    setViewMode("grid");
  }

  // ---- Loading state (first load only) ----
  if (loading && games.length === 0 && !hasDoneInitialScan) {
    return (
      <div className="flex h-full items-center justify-center p-5 lg:p-7">
        <div className="flex items-center gap-3 text-(--color-muted)">
          <RefreshCcw className="h-5 w-5 animate-spin" />
          <span className="text-sm">Detecting games...</span>
        </div>
      </div>
    );
  }

  // ---- Empty / error state ----
  if (!loading && games.length === 0 && hasDoneInitialScan) {
    return (
      <div className="p-5 lg:p-7">
        <div className="mb-5">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
            <Gamepad2 className="h-3.5 w-3.5" />
            Games
          </div>
          <h1 className="text-2xl font-bold text-(--color-text) lg:text-3xl">
            Juegos
          </h1>
          <p className="mt-1 text-sm text-(--color-muted)">
            Ejecuta juegos de Steam y accesos locales desde LumaForge.
          </p>
        </div>

        {error || detectionErrors.length > 0 ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center lg:p-12">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
              <Gamepad2 className="h-6 w-6 text-red-400" />
            </div>
            <p className="font-semibold text-(--color-text)">Could not detect games</p>
            {error && (
              <p className="mt-1.5 text-sm text-(--color-muted) max-w-md mx-auto">{error}</p>
            )}
            {detectionErrors.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-(--color-muted) max-w-md mx-auto">
                {detectionErrors.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            )}
            <div className="mt-4 space-y-1.5">
              <p className="text-xs text-(--color-muted)">Check your configuration:</p>
              <ul className="text-xs text-(--color-muted) space-y-1">
                <li>• Verify Steam path in Settings → Paths</li>
                <li>• Verify Game Scan Folders in Settings → Game Detection</li>
                <li>• Make sure Steam is installed and has appmanifest files</li>
                <li>• Run Scan again after fixing paths</li>
              </ul>
            </div>
            <button
              type="button"
              onClick={loadGames}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-black transition hover:opacity-90"
            >
              <RefreshCcw className="h-4 w-4" />
              Retry Scan
            </button>
          </div>
        ) : (
          <div className="max-w-md text-center mx-auto mt-12">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-(--surface-active-border) bg-white/5">
              <Gamepad2 className="h-8 w-8 text-(--color-muted)" />
            </div>
            <h2 className="mt-5 text-xl font-bold text-(--color-text)">
              No games detected yet
            </h2>
            <p className="mt-2 text-sm text-(--color-muted)">
              Scan Steam libraries or add a game scan folder to begin.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={loadGames}
                className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-black transition hover:opacity-90"
              >
                <RefreshCcw className="h-4 w-4" />
                Scan Steam
              </button>
              <button
                type="button"
                onClick={() => openExternalUrl("#/settings")}
                className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10"
              >
                <Settings className="h-4 w-4" />
                Open Settings
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- Games list view ----
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        {selectedGame ? (
          <div className="flex h-full flex-col">
            <div className="shrink-0 border-b border-(--surface-active-border) bg-white/[0.02] px-5 py-3 lg:px-7">
              <button
                type="button"
                onClick={() => setSelectedGame(null)}
                className="inline-flex items-center gap-2 text-sm text-(--color-muted) transition hover:text-(--color-text)"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Games
              </button>
            </div>

            <div className="flex flex-1 items-center justify-center p-5 lg:p-7">
              <div className="max-w-md text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-(--surface-active-border) bg-white/5">
                  {selectedGame.imageUrl ? (
                    <img
                      src={selectedGame.imageUrl}
                      alt={selectedGame.title}
                      className="h-full w-full rounded-3xl object-cover"
                    />
                  ) : (
                    <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
                  )}
                </div>

                <h1 className="mt-4 text-2xl font-bold text-(--color-text)">
                  {selectedGame.title}
                </h1>

                {selectedGame.appId && (
                  <p className="mt-1 text-sm text-(--color-muted)">
                    App ID: {selectedGame.appId}
                  </p>
                )}

                {selectedGame.executablePath && (
                  <p className="mt-1 text-xs text-(--color-muted) break-all">
                    {selectedGame.executablePath}
                  </p>
                )}

                <div className="mt-3 flex items-center justify-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs font-medium text-(--color-accent)">
                    <Gamepad2 className="h-3.5 w-3.5" />
                    {selectedGame.source === "steam" ? "Steam" : "Local"}
                  </span>
                  {selectedGame.isInstalled ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                      Installed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-500/20 bg-zinc-500/10 px-3 py-1 text-xs font-medium text-zinc-300">
                      Not Installed
                    </span>
                  )}
                </div>

                <div className="mt-6 flex items-center justify-center gap-3">
                  {selectedGame.isPlayable && (
                    <button
                      type="button"
                      onClick={() => handlePlay(selectedGame)}
                      className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-5 py-2.5 text-sm font-bold text-black transition hover:opacity-90"
                    >
                      <Play className="h-4 w-4" />
                      Play
                    </button>
                  )}
                  {!selectedGame.isInstalled && selectedGame.source === "steam" && (
                    <button
                      type="button"
                      onClick={() => handleInstall(selectedGame)}
                      className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-5 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                    >
                      <Download className="h-4 w-4" />
                      Install
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <PageContainer className="py-5 lg:py-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
                  <Gamepad2 className="h-3.5 w-3.5" />
                  Games
                </div>
                <h1 className="text-2xl font-bold text-(--color-text) lg:text-3xl">
                  Juegos
                </h1>
                <p className="mt-1 text-sm text-(--color-muted)">
                  {filteredGames.length} game{filteredGames.length === 1 ? "" : "s"}
                  {loading && " (scanning...)"}
                </p>
                {isFromCache && cacheTimestamp && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-(--color-muted)">
                    <Clock className="h-3 w-3" />
                    Last scanned {formatTimeAgo(cacheTimestamp)}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {settings.scanLocalGames && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setShowManualInput(!showManualInput);
                        if (!showManualInput) {
                          setTimeout(() => manualInputRef.current?.focus(), 50);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-2.5 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
                      title="Add Local EXE"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Add EXE</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={loadGames}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-(--color-accent)/30 bg-(--color-accent)/10 px-2.5 py-2 text-xs font-medium text-(--color-accent) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Scan"
                >
                  <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">{loading ? "Scanning..." : "Scan"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowFilters(true)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs transition ${
                    sourceFilter !== "all" || installFilter !== "all"
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

            {warnings.length > 0 && (
              <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
                <p className="mb-1 font-medium">Detection warnings:</p>
                <ul className="space-y-0.5">
                  {warnings.map((w, i) => <li key={i}>• {w}</li>)}
                </ul>
              </div>
            )}

            {showManualInput && (
              <div className="mb-4 flex items-center gap-2">
                <input
                  ref={manualInputRef}
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddManualExe();
                    if (e.key === "Escape") {
                      setShowManualInput(false);
                      setManualPath("");
                    }
                  }}
                  placeholder="Paste path to .exe file..."
                  className="flex-1 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)"
                />
                <button
                  type="button"
                  onClick={handleAddManualExe}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-bold text-black transition hover:opacity-90"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
            )}

            {filteredGames.length === 0 ? (
              <div className="rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-12 text-center">
                <FolderSearch className="mx-auto h-10 w-10 text-(--color-muted)" />
                <h2 className="mt-4 font-semibold text-(--color-text)">
                  No games match these filters
                </h2>
                <p className="mt-1.5 text-sm text-(--color-muted)">
                  Try adjusting your search or filter.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {filteredGames.map((game) => (
                    <div key={game.id} className="relative group">
                      <GameLauncherTile
                        game={game}
                        onSelect={(g) => setSelectedGame(g)}
                        onPlay={handlePlay}
                        onInstall={handleInstall}
                      />
                      {game.source === "local" && (
                        <button
                          type="button"
                          onClick={() => {
                            if (game.executablePath) handleRemoveLocalExe(game.executablePath);
                          }}
                          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white/60 opacity-0 transition hover:bg-red-500/70 hover:text-white group-hover:opacity-100"
                          title="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {loading && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-sm text-(--color-muted)">
                    <RefreshCcw className="h-4 w-4 animate-spin" />
                    Scanning...
                  </div>
                )}
              </>
            )}
          </PageContainer>
        )}
      </div>

      <GamesFilterPanel
        open={showFilters}
        sourceFilter={sourceFilter}
        installFilter={installFilter}
        localQuery={localQuery}
        sortBy={sortBy}
        viewMode={viewMode}
        count={filteredGames.length}
        total={games.length}
        onLocalQueryChange={setLocalQuery}
        onSourceFilterChange={setSourceFilter}
        onInstallFilterChange={setInstallFilter}
        onSortByChange={setSortBy}
        onViewModeChange={setViewMode}
        onClose={() => setShowFilters(false)}
        onReset={() => {
          resetFilters();
          setShowFilters(false);
        }}
      />
    </div>
  );
}
