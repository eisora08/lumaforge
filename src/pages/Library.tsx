import { useEffect, useMemo, useState } from "react";
import {
  FileCode2,
  FolderSearch,
  Library,
  RefreshCcw,
  Search,
  Settings,
} from "lucide-react";

import InstalledGameTile from "../components/installed/InstalledGameTile";
import InstalledGameDetails from "../components/installed/InstalledGameDetails";
import StoreSourceSelectorModal from "../components/store/StoreSourceSelectorModal";

import { useSettings } from "../context/SettingsContext";
import {
  computeFileHash,
  deleteLuaScript,
  downloadAndInstallPackage,
  markSyncIndexItem,
  scanInstalledLuaScripts,
  scanSteamInstalledGames,
  setLuaScriptEnabled,
} from "../services/tauri";
import { openExternalUrl } from "../services/externalLinks";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { checkInstalledLuaUpdates } from "../services/installedLuaUpdateChecker";

import type { InstalledLibraryGame, LibraryFilter, LibrarySort } from "../types/installedLibrary";
import type { SyncIndexItem } from "../types/syncIndex";
import type { InstalledLuaScript } from "../types/installedLua";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { PackageSource } from "../types/package";

import { getSteamDbUrl, getSteamStoreUrl } from "../utils/steamLinks";

import {
  showError,
  showSuccess,
  showWarning,
} from "../components/toast/GameToast";

function buildLibraryGame(
  script: InstalledLuaScript,
  metadata: Record<number, SteamAppMetadata>,
  steamInstalled: Record<string, boolean>,
): InstalledLibraryGame {
  const appId = String(script.app_id);
  const meta = metadata[script.app_id];

  return {
    appId,
    title: meta?.name || `Steam App ${script.app_id}`,
    developer: meta?.developer || undefined,
    imageUrl: meta?.header_image || meta?.capsule_image || meta?.capsule_image_v5 || undefined,
    metadata: meta,
    steamInstalled: steamInstalled[appId] === true,
    installStatus: script.is_disabled ? "disabled" : "active",
    luaScripts: [script],
    sources: [],
    hasLuaInstalled: true,
    hasAvailableSource: false,
  };
}

export default function LibraryPage() {
  const { settings } = useSettings();

  const [scripts, setScripts] = useState<InstalledLuaScript[]>([]);
  const [gameMetadata, setGameMetadata] = useState<Record<number, SteamAppMetadata>>({});
  const [steamInstalledGames, setSteamInstalledGames] = useState<Record<string, boolean>>({});

  const [scanningLua, setScanningLua] = useState(false);
  const [scanningSteam, setScanningSteam] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sortBy, setSortBy] = useState<LibrarySort>("name");
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [sourceSelectorGame, setSourceSelectorGame] = useState<InstalledLibraryGame | null>(null);

  const hasLuaPath = Boolean(settings.luaPath);

  async function scanLua() {
    if (!settings.luaPath) return;
    try {
      setScanningLua(true);
      const results = await scanInstalledLuaScripts(settings.luaPath);
      setScripts(results);
      const appIds = results.map((s) => s.app_id);
      const metadata = await resolveGameMetadata(appIds);
      setGameMetadata(metadata);
    } catch (error) {
      console.error(error);
    } finally {
      setScanningLua(false);
    }
  }

  async function scanSteam() {
    try {
      setScanningSteam(true);
      const games = await scanSteamInstalledGames({
        steamPath: settings.steamRoot || undefined,
        luaPath: settings.luaPath || undefined,
        depotcachePath: settings.depotcachePath || undefined,
      });
      const map: Record<string, boolean> = {};
      for (const g of games) {
        if (g.isInstalled) {
          map[String(g.appId)] = true;
        }
      }
      setSteamInstalledGames(map);
    } catch (error) {
      console.error(error);
    } finally {
      setScanningSteam(false);
    }
  }

  async function handleScan() {
    if (!settings.luaPath) {
      showWarning("Configura o detecta la ruta config/lua antes de escanear.", {
        title: "Ruta requerida",
      });
      return;
    }
    try {
      setScanningLua(true);
      const results = await scanInstalledLuaScripts(settings.luaPath);
      setScripts(results);
      const appIds = results.map((s) => s.app_id);
      const metadata = await resolveGameMetadata(appIds);
      setGameMetadata(metadata);
      showSuccess(`Se detectaron ${results.length} script(s) Lua.`, {
        title: "Biblioteca actualizada",
      });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "No se pudo escanear la carpeta Lua.";
      showError(message, { title: "Error escaneando Lua" });
    } finally {
      setScanningLua(false);
    }
  }

  async function handleCheckUpdates() {
    if (!settings.luaPath) {
      showWarning("Configura o detecta la ruta config/lua antes de revisar updates.", {
        title: "Ruta requerida",
      });
      return;
    }
    if (scripts.length === 0) {
      showWarning("No hay scripts Lua instalados para revisar.", {
        title: "Biblioteca vacía",
      });
      return;
    }
    try {
      setCheckingUpdates(true);
      await checkInstalledLuaUpdates(scripts, settings);
      showSuccess("La revisión de updates terminó correctamente.", {
        title: "Updates revisados",
      });
    } catch (error) {
      console.error(error);
      showError("No se pudieron revisar los updates.", { title: "Revisión fallida" });
    } finally {
      setCheckingUpdates(false);
    }
  }

  async function handlePlay(game: InstalledLibraryGame) {
    try {
      await openExternalUrl(`steam://run/${game.appId}`);
    } catch {
      showError("No se pudo abrir Steam.", { title: "Error" });
    }
  }

  async function handleInstallSteam(game: InstalledLibraryGame) {
    try {
      await openExternalUrl(`steam://install/${game.appId}`);
    } catch {
      showError("No se pudo abrir Steam.", { title: "Error" });
    }
  }

  function handleOpenSourceSelector(game: InstalledLibraryGame) {
    setSourceSelectorGame(game);
  }

  async function handleToggleScript(game: InstalledLibraryGame) {
    const script = game.luaScripts[0];
    if (!script) return;
    try {
      const result = await setLuaScriptEnabled({
        luaPath: settings.luaPath,
        fileName: script.file_name,
        enabled: script.is_disabled,
      });
      showSuccess(result.message, {
        title: script.is_disabled ? "Lua activado" : "Lua deshabilitado",
      });
      await scanLua();
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "No se pudo cambiar el estado del Lua.";
      showError(message, { title: "Acción fallida" });
    }
  }

  async function handleDeleteScript(game: InstalledLibraryGame) {
    const script = game.luaScripts[0];
    if (!script) return;
    const accepted = window.confirm(`¿Eliminar definitivamente ${script.file_name}?`);
    if (!accepted) return;
    try {
      const result = await deleteLuaScript({
        luaPath: settings.luaPath,
        fileName: script.file_name,
      });
      showSuccess(result.message, { title: "Lua eliminado" });
      setSelectedAppId(null);
      await scanLua();
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "No se pudo eliminar el Lua.";
      showError(message, { title: "Eliminación fallida" });
    }
  }

  async function handleOpenSteamStore(game: InstalledLibraryGame) {
    try {
      await openExternalUrl(getSteamStoreUrl(Number(game.appId)));
    } catch {
      showError("No se pudo abrir la página de Steam.", { title: "Error abriendo enlace" });
    }
  }

  async function handleOpenSteamDb(game: InstalledLibraryGame) {
    try {
      await openExternalUrl(getSteamDbUrl(Number(game.appId)));
    } catch {
      showError("No se pudo abrir SteamDB.", { title: "Error abriendo enlace" });
    }
  }

  async function performDownload(
    game: InstalledLibraryGame,
    source: PackageSource
  ) {
    if (!settings.luaPath || !settings.depotcachePath) {
      showWarning("Configura las rutas de Steam antes de descargar.", {
        title: "Rutas requeridas",
      });
      return;
    }
    if (!source.downloadUrl) {
      showError("La fuente seleccionada no tiene URL de descarga.", {
        title: "Error de fuente",
      });
      return;
    }
    try {
      showSuccess(`Descargando desde ${source.providerName}...`, {
        title: "Descarga iniciada",
      });
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
          // hash computation is optional for tracking
        }
      }
      const now = new Date().toISOString();
      const syncItem: SyncIndexItem = {
        appId: game.appId,
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
      showSuccess(`Sincronización completa desde ${source.providerName}.`, {
        title: "Sincronizado",
      });
      await scanLua();
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Error durante la sincronización.";
      showError(message, { title: "Error de sincronización" });
    }
  }

  async function handleDownloadSource(
    game: InstalledLibraryGame,
    source: PackageSource
  ) {
    await performDownload(game, source);
  }

  async function handleSyncGame(game: InstalledLibraryGame) {
    const availableSource = game.sources.find((s) => s.available && s.downloadUrl);
    if (!availableSource) {
      showWarning("No hay una fuente disponible para sincronizar.", {
        title: "Sin fuentes",
      });
      return;
    }
    await performDownload(game, availableSource);
  }

  // On mount: lightweight local scan only
  useEffect(() => {
    if (hasLuaPath) {
      scanLua();
    }
    scanSteam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLuaPath]);

  const libraryGames: InstalledLibraryGame[] = useMemo(() => {
    return scripts.map((script) =>
      buildLibraryGame(script, gameMetadata, steamInstalledGames)
    );
  }, [scripts, gameMetadata, steamInstalledGames]);

  const filteredGames = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return libraryGames
      .filter((game) => {
        const matchesQuery =
          !normalizedQuery ||
          game.appId.includes(normalizedQuery) ||
          game.title.toLowerCase().includes(normalizedQuery);
        const matchesFilter =
          filter === "all" ||
          (filter === "active" && game.installStatus === "active") ||
          (filter === "disabled" && game.installStatus === "disabled") ||
          (filter === "lua-ready" && game.hasAvailableSource) ||
          (filter === "updates" && game.hasUpdate);
        return matchesQuery && matchesFilter;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.title.localeCompare(b.title);
        if (sortBy === "appid") return Number(a.appId) - Number(b.appId);
        if (sortBy === "modified") {
          const aModified = a.luaScripts[0]?.modified_at || 0;
          const bModified = b.luaScripts[0]?.modified_at || 0;
          return bModified - aModified;
        }
        if (sortBy === "size") {
          const aSize = a.luaScripts[0]?.file_size || 0;
          const bSize = b.luaScripts[0]?.file_size || 0;
          return bSize - aSize;
        }
        return 0;
      });
  }, [libraryGames, query, filter, sortBy]);

  const selectedGame = selectedAppId
    ? libraryGames.find((g) => g.appId === selectedAppId) || null
    : null;

  const filters: { key: LibraryFilter; label: string }[] = [
    { key: "all", label: `All (${libraryGames.length})` },
    { key: "active", label: `Lua (${libraryGames.filter((g) => g.installStatus === "active").length})` },
    { key: "lua-ready", label: `Lua Ready (${libraryGames.filter((g) => g.hasAvailableSource && g.installStatus !== "active").length})` },
    { key: "disabled", label: `Disabled (${libraryGames.filter((g) => g.installStatus === "disabled").length})` },
  ];

  if (!hasLuaPath) {
    return (
      <div className="flex h-full items-center justify-center p-5 lg:p-7">
        <div className="max-w-md text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-(--color-accent)/20 bg-(--color-accent)/10">
            <Settings className="h-8 w-8 text-(--color-accent)" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-(--color-text)">
            Lua path is not configured
          </h2>
          <p className="mt-2 text-sm text-(--color-muted)">
            Configure or auto-detect Steam paths in Settings to scan for installed Lua scripts.
          </p>
          <p className="mt-4 text-xs text-(--color-muted)">
            Go to Settings → Steam Paths
          </p>
        </div>
      </div>
    );
  }

  if (scanningLua && scripts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-5 lg:p-7">
        <div className="flex items-center gap-3 text-(--color-muted)">
          <RefreshCcw className="h-5 w-5 animate-spin" />
          <span className="text-sm">Scanning installed Lua scripts...</span>
        </div>
      </div>
    );
  }

  if (!scanningLua && scripts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-5 lg:p-7">
        <div className="max-w-md text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-(--surface-active-border) bg-white/5">
            <FileCode2 className="h-8 w-8 text-(--color-muted)" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-(--color-text)">
            No installed Lua scripts found
          </h2>
          <p className="mt-2 text-sm text-(--color-muted)">
            Download Lua from the Store or sync a supported game.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        {selectedGame ? (
          <InstalledGameDetails
            game={selectedGame}
            onPlay={handlePlay}
            onInstallSteam={handleInstallSteam}
            onSync={handleSyncGame}
            onToggle={handleToggleScript}
            onDelete={handleDeleteScript}
            onOpenSteam={handleOpenSteamStore}
            onOpenSteamDb={handleOpenSteamDb}
            onOpenSourceSelector={handleOpenSourceSelector}
            onBack={() => setSelectedAppId(null)}
          />
        ) : (
          <div className="p-5 lg:p-7">
            {/* Header row */}
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
                  <Library className="h-3.5 w-3.5" />
                  Library
                </div>
                <h1 className="text-2xl font-bold text-(--color-text) lg:text-3xl">
                  Biblioteca
                </h1>
                <p className="mt-1 text-sm text-(--color-muted)">
                  {filteredGames.length} game{filteredGames.length === 1 ? "" : "s"}
                </p>
              </div>

              {/* Compact actions */}
              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-(--color-muted)" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search..."
                    className="w-28 bg-transparent text-xs text-(--color-text) outline-none placeholder:text-(--color-muted)"
                  />
                </div>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as LibrarySort)}
                  className="rounded-xl border border-(--surface-active-border) bg-white/5 px-2.5 py-2 text-xs text-(--color-text) outline-none"
                >
                  <option className="bg-black text-white" value="name">Name</option>
                  <option className="bg-black text-white" value="appid">App ID</option>
                  <option className="bg-black text-white" value="modified">Modified</option>
                  <option className="bg-black text-white" value="size">Size</option>
                </select>

                <button
                  type="button"
                  onClick={handleCheckUpdates}
                  disabled={checkingUpdates || scripts.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-2.5 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-50"
                  title="Check Updates"
                >
                  <RefreshCcw className={`h-3.5 w-3.5 ${checkingUpdates ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">Updates</span>
                </button>

                <button
                  type="button"
                  onClick={handleScan}
                  disabled={scanningLua || scanningSteam}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-2.5 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-50"
                  title="Scan"
                >
                  <RefreshCcw className={`h-3.5 w-3.5 ${scanningLua ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">Scan</span>
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
                      ? f.key === "active"
                        ? "bg-(--color-accent) text-black"
                        : f.key === "disabled"
                          ? "bg-zinc-500 text-white"
                          : f.key === "lua-ready"
                            ? "bg-emerald-500 text-black"
                            : "bg-(--color-accent) text-black"
                      : "border border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:bg-white/10"
                  }`}
                >
                  {f.label}
                </button>
              ))}
              {gameMetadata && scripts.some((s) => steamInstalledGames[String(s.app_id)]) && (
                <button
                  type="button"
                  onClick={() => setFilter(filter === "active" ? "all" : "active")}
                  className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300"
                >
                  Steam: {Object.keys(steamInstalledGames).length} installed
                </button>
              )}
            </div>

            {/* Grid */}
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filteredGames.map((game) => (
                  <InstalledGameTile
                    key={game.appId}
                    game={game}
                    onSelect={(g) => setSelectedAppId(g.appId)}
                    onPlay={handlePlay}
                    onInstallSteam={handleInstallSteam}
                    onSync={handleSyncGame}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <StoreSourceSelectorModal
        open={Boolean(sourceSelectorGame)}
        game={sourceSelectorGame ? {
          appId: sourceSelectorGame.appId,
          title: sourceSelectorGame.title,
          developer: sourceSelectorGame.developer || "",
          imageUrl: sourceSelectorGame.imageUrl || "",
          platforms: sourceSelectorGame.metadata?.platforms || [],
          sources: sourceSelectorGame.sources,
        } : null}
        selectedSource={sourceSelectorGame?.sources.find((s) => s.available)}
        onClose={() => setSourceSelectorGame(null)}
        onDownloadSource={(source) => {
          if (sourceSelectorGame) {
            handleDownloadSource(sourceSelectorGame, source);
          }
        }}
        onOpenDetails={(game) => {
          setSourceSelectorGame(null);
          setSelectedAppId(game.appId);
        }}
      />
    </div>
  );
}
