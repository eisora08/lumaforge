import { useEffect, useMemo, useState } from "react";
import {
  FileCode2,
  FolderSearch,
  Library,
  RefreshCcw,
  Settings,
  SlidersHorizontal,
} from "lucide-react";

import PageContainer from "../components/layout/PageContainer";
import GameLauncherTile from "../components/games/GameLauncherTile";
import LibraryGameDetails from "../components/library/LibraryGameDetails";
import StoreSourceSelectorModal from "../components/store/StoreSourceSelectorModal";

import { useSettings } from "../context/SettingsContext";
import { useLibraryGames } from "../context/LibraryGamesContext";
import {
  launchSteamApp,
  installSteamApp,
  scanInstalledLuaScripts,
  setLuaScriptEnabled,
  deleteLuaScript,
  computeFileHash,
  downloadAndInstallPackage,
  markSyncIndexItem,
} from "../services/tauri";
import { checkInstalledLuaUpdates } from "../services/installedLuaUpdateChecker";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { openExternalUrl } from "../services/externalLinks";
import { getSteamStoreUrl, getSteamDbUrl } from "../utils/steamLinks";

import type { LibraryGame } from "../types/libraryGame";
import type { InstalledLuaScript } from "../types/installedLua";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { PackageSource } from "../types/package";
import type { SyncIndexItem } from "../types/syncIndex";

import {
  showError,
  showSuccess,
  showWarning,
} from "../components/toast/GameToast";

export default function LibraryPage() {
  const { settings } = useSettings();
  const { games, warnings, loading, selectedId, setSelectedId, refresh } = useLibraryGames();
  const hasLuaPath = Boolean(settings.luaPath);

  const [luaScripts, setLuaScripts] = useState<InstalledLuaScript[]>([]);
  const [luaMetadata, setLuaMetadata] = useState<Record<number, SteamAppMetadata>>({});
  const [scanningLua, setScanningLua] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [sourceSelectorGame, setSourceSelectorGame] = useState<LibraryGame | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

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
      const id = `lua-${appId}`;
      return {
        id,
        appId: String(appId),
        title: meta?.name || `Steam App ${appId}`,
        source: "lua" as const,
        imageUrl: meta?.header_image || meta?.capsule_image || meta?.capsule_image_v5 || undefined,
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
  }, [luaScripts, luaMetadata, games]);

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
    return displayGames.filter((g) => {
      if (filter === "lua" && !g.hasLua) return false;
      if (filter === "installed" && !g.isPlayable && !g.steamInstalled) return false;
      if (filter === "disabled" && !g.isLuaDisabled) return false;
      return true;
    });
  }, [displayGames, filter]);

  const selectedGame = selectedId ? displayGames.find((g) => g.id === selectedId) || null : null;

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

  async function handleSyncGame(game: LibraryGame) {
    const script = game.luaScripts[0];
    if (!script || !hasLuaPath) {
      showWarning("No Lua script to sync.", { title: "Cannot sync" });
      return;
    }
    const availableSource = game.sources.find((s) => s.available && s.downloadUrl);
    if (!availableSource) {
      showWarning("No available source found.", { title: "No source" });
      return;
    }
    await performDownload(game, availableSource);
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

  async function handleToggleScript(game: LibraryGame) {
    const script = game.luaScripts[0];
    if (!script || !hasLuaPath) return;
    try {
      const result = await setLuaScriptEnabled({
        luaPath: settings.luaPath,
        fileName: script.file_name,
        enabled: script.is_disabled,
      });
      showSuccess(result.message, { title: script.is_disabled ? "Lua enabled" : "Lua disabled" });
      await scanLuaScripts();
      await refresh();
    } catch (error) {
      console.error(error);
      showError(error instanceof Error ? error.message : "Could not toggle Lua.", { title: "Error" });
    }
  }

  async function handleDeleteScript(game: LibraryGame) {
    const script = game.luaScripts[0];
    if (!script || !hasLuaPath) return;
    const accepted = window.confirm(`Delete ${script.file_name} permanently?`);
    if (!accepted) return;
    try {
      await deleteLuaScript({ luaPath: settings.luaPath, fileName: script.file_name });
      showSuccess("Lua deleted.", { title: "Deleted" });
      setSelectedId(null);
      await scanLuaScripts();
      await refresh();
    } catch (error) {
      console.error(error);
      showError(error instanceof Error ? error.message : "Could not delete Lua.", { title: "Error" });
    }
  }

  function handleOpenSteamStore(game: LibraryGame) {
    if (!game.appId) return;
    openExternalUrl(getSteamStoreUrl(Number(game.appId))).catch(() =>
      showError("Could not open Steam page.", { title: "Error" })
    );
  }

  function handleOpenSteamDb(game: LibraryGame) {
    if (!game.appId) return;
    openExternalUrl(getSteamDbUrl(Number(game.appId))).catch(() =>
      showError("Could not open SteamDB.", { title: "Error" })
    );
  }

  function handleOpenSourceSelector(game: LibraryGame) {
    setSourceSelectorGame(game);
  }

  const filters = [
    { key: "all", label: "All", count: displayGames.length },
    { key: "lua", label: "Lua", count: displayGames.filter((g) => g.hasLua).length },
    { key: "installed", label: "Installed", count: displayGames.filter((g) => g.isPlayable || g.steamInstalled).length },
    { key: "disabled", label: "Disabled", count: displayGames.filter((g) => g.isLuaDisabled).length },
  ];

  const showLuaSetup = !hasLuaPath;
  const showEmptyLua = hasLuaPath && luaScripts.length === 0 && !scanningLua;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {selectedGame ? (
          <LibraryGameDetails
            game={selectedGame}
            onPlay={handlePlay}
            onInstall={handleInstall}
            onSync={handleSyncGame}
            onToggleScript={handleToggleScript}
            onDeleteScript={handleDeleteScript}
            onOpenSteam={handleOpenSteamStore}
            onOpenSteamDb={handleOpenSteamDb}
            onOpenSourceSelector={handleOpenSourceSelector}
            onBack={() => setSelectedId(null)}
          />
        ) : showLuaSetup ? (
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
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
                  <Library className="h-3.5 w-3.5" />
                  Library
                </div>
                <h1 className="text-2xl font-bold text-(--color-text) lg:text-3xl">Biblioteca</h1>
                <p className="mt-1 text-sm text-(--color-muted)">
                  {filteredGames.length} game{filteredGames.length === 1 ? "" : "s"}
                  {loading && " (scanning...)"}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCheckUpdates}
                  disabled={checkingUpdates || luaScripts.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-2.5 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-50"
                  title="Check Updates"
                >
                  <RefreshCcw className={`h-3.5 w-3.5 ${checkingUpdates ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">Updates</span>
                </button>

                <button
                  type="button"
                  onClick={refresh}
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
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    filter === f.key
                      ? f.key === "disabled"
                        ? "bg-zinc-500 text-white"
                        : "bg-(--color-accent) text-black"
                      : "border border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:bg-white/10"
                  }`}
                >
                  {f.label} ({f.count})
                </button>
              ))}
            </div>

            {warnings.length > 0 && (
              <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
                <p className="mb-1 font-medium">Warnings:</p>
                <ul className="space-y-0.5">
                  {warnings.map((w, i) => <li key={i}>• {w}</li>)}
                </ul>
              </div>
            )}

            {filteredGames.length === 0 ? (
              <div className="rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-12 text-center">
                <FolderSearch className="mx-auto h-10 w-10 text-(--color-muted)" />
                <h2 className="mt-4 font-semibold text-(--color-text)">No games match these filters</h2>
                <p className="mt-1.5 text-sm text-(--color-muted)">Try adjusting your search or filter.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filteredGames.map((game) => (
                  <GameLauncherTile
                    key={game.id}
                    game={game}
                    onSelect={(g) => setSelectedId(g.id)}
                    onPlay={handlePlay}
                    onInstall={handleInstall}
                  />
                ))}
              </div>
            )}
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
          onDownloadSource={(source) => {
            if (sourceSelectorGame) handleDownloadSource(sourceSelectorGame, source);
          }}
          onOpenDetails={(_game) => {
            setSourceSelectorGame(null);
            if (sourceSelectorGame) setSelectedId(sourceSelectorGame.id);
          }}
        />

        {showFilters && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowFilters(false)}>
            <div className="w-80 rounded-2xl border border-(--surface-active-border) bg-(--color-bg) p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-4 text-sm font-bold text-(--color-text)">Filters</h3>
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-xs text-(--color-muted)">Status</p>
                  <div className="flex flex-wrap gap-1.5">
                    {filters.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => { setFilter(f.key); setShowFilters(false); }}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition ${
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
                className="mt-4 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/10"
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
