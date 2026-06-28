import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  FolderSearch,
  Gamepad2,
  Play,
  RefreshCcw,
  Search,
  Settings,
} from "lucide-react";

import GameLauncherTile from "../components/games/GameLauncherTile";

import { useSettings } from "../context/SettingsContext";
import { scanSteamInstalledGames } from "../services/tauri";
import { openExternalUrl } from "../services/externalLinks";
import { resolveGameMetadata } from "../services/gameMetadataResolver";

import type { LauncherGame } from "../types/launcherGame";
import type { SteamInstalledGame } from "../types/steamInstalled";

import {
  showError,
  showWarning,
} from "../components/toast/GameToast";

type GamesFilter = "all" | "steam" | "installed" | "not-installed";

function buildLauncherGame(
  steamGame: SteamInstalledGame,
  imageUrl?: string,
): LauncherGame {
  return {
    id: `steam-${steamGame.appId}`,
    appId: String(steamGame.appId),
    title: steamGame.name,
    source: "steam",
    installDir: steamGame.installDir || undefined,
    libraryPath: steamGame.libraryPath,
    imageUrl,
    isInstalled: steamGame.isInstalled,
    isPlayable: steamGame.isInstalled,
    sizeOnDisk: steamGame.sizeOnDisk || undefined,
    lastUpdated: steamGame.lastUpdated || undefined,
  };
}

export default function GamesPage() {
  const { settings } = useSettings();

  const [steamGames, setSteamGames] = useState<SteamInstalledGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GamesFilter>("all");
  const [selectedGame, setSelectedGame] = useState<LauncherGame | null>(null);

  async function loadGames() {
    try {
      setLoading(true);
      const games = await scanSteamInstalledGames({
        steamPath: settings.steamRoot || undefined,
        luaPath: settings.luaPath || undefined,
        depotcachePath: settings.depotcachePath || undefined,
      });
      setSteamGames(games);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function handlePlay(game: LauncherGame) {
    if (game.source === "steam" && game.appId) {
      try {
        await openExternalUrl(`steam://run/${game.appId}`);
      } catch {
        showError("No se pudo abrir Steam.", { title: "Error" });
      }
    } else {
      showWarning("Local executable launching is not available yet.", {
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

  const [resolvedImages, setResolvedImages] = useState<Record<number, string | undefined>>({});

  const launcherGames: LauncherGame[] = useMemo(() => {
    return steamGames.map((sg) =>
      buildLauncherGame(sg, resolvedImages[sg.appId])
    );
  }, [steamGames, resolvedImages]);

  const filteredGames = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return launcherGames.filter((g) => {
      const matchesQuery =
        !normalizedQuery ||
        g.title.toLowerCase().includes(normalizedQuery) ||
        g.appId?.includes(normalizedQuery);
      const matchesFilter =
        filter === "all" ||
        (filter === "steam" && g.source === "steam") ||
        (filter === "installed" && g.isInstalled) ||
        (filter === "not-installed" && !g.isInstalled);
      return matchesQuery && matchesFilter;
    });
  }, [launcherGames, query, filter]);

  useEffect(() => {
    loadGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const appIds = steamGames.map((g) => g.appId);
    if (appIds.length === 0) return;
    resolveGameMetadata(appIds).then((metadata) => {
      const images: Record<number, string | undefined> = {};
      for (const [idStr, meta] of Object.entries(metadata)) {
        images[Number(idStr)] =
          meta.header_image || meta.capsule_image || meta.capsule_image_v5 || undefined;
      }
      setResolvedImages((prev) => ({ ...prev, ...images }));
    });
  }, [steamGames]);

  const filters: { key: GamesFilter; label: string }[] = [
    { key: "all", label: `All (${launcherGames.length})` },
    { key: "steam", label: `Steam (${launcherGames.filter((g) => g.source === "steam").length})` },
    { key: "installed", label: `Installed (${launcherGames.filter((g) => g.isInstalled).length})` },
    { key: "not-installed", label: `Not Installed (${launcherGames.filter((g) => !g.isInstalled).length})` },
  ];

  if (loading && steamGames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-5 lg:p-7">
        <div className="flex items-center gap-3 text-(--color-muted)">
          <RefreshCcw className="h-5 w-5 animate-spin" />
          <span className="text-sm">Scanning installed games...</span>
        </div>
      </div>
    );
  }

  if (!loading && steamGames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-5 lg:p-7">
        <div className="max-w-md text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-(--surface-active-border) bg-white/5">
            <Gamepad2 className="h-8 w-8 text-(--color-muted)" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-(--color-text)">
            No games detected yet
          </h2>
          <p className="mt-2 text-sm text-(--color-muted)">
            Scan Steam libraries or add a local executable to begin.
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
              onClick={() => openExternalUrl("https://store.steampowered.com")}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

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

                <div className="mt-3 flex items-center justify-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs font-medium text-(--color-accent)">
                    <Gamepad2 className="h-3.5 w-3.5" />
                    Steam
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

                <p className="mt-8 text-sm text-(--color-muted)">
                  Game detail view coming next.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-5 lg:p-7">
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
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-(--color-muted)" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search..."
                    className="w-28 bg-transparent text-xs text-(--color-text) outline-none placeholder:text-(--color-muted)"
                  />
                </div>

                <button
                  type="button"
                  onClick={loadGames}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-2.5 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-50"
                  title="Scan"
                >
                  <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">Scan</span>
                </button>
              </div>
            </div>

            <div className="mb-5 flex flex-wrap items-center gap-2">
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    filter === f.key
                      ? "bg-(--color-accent) text-black"
                      : "border border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:bg-white/10"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

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
                  <GameLauncherTile
                    key={game.id}
                    game={game}
                    onSelect={(g) => setSelectedGame(g)}
                    onPlay={handlePlay}
                    onInstall={handleInstall}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
