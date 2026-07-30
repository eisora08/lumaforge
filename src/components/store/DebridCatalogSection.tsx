import { useCallback, useEffect, useMemo, useState } from "react";
import { Package, Download, HardDrive, Star, Tag, Search, Loader2, RefreshCw, Play, Settings2 } from "lucide-react";
import type { RepackQueryResult } from "../../services/tauri";
import { queryRepackCatalogByRepacker, queryRepackCatalogFuzzy, setupDebridGame } from "../../services/tauri";
import { DEBRID_LIBRARY_ENABLED } from "../../features/debrid/debridFeatureFlag";
import {
  getAllDebridGames,
  getDebridGameStatus,
  getPendingSetup,
  markDebridGameStatus,
  clearPendingSetup,
  updateDebridGame,
} from "../../services/debridGameStore";
import { showError, showSuccess } from "../toast/GameToast";
import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import PackageInstallSuccessModal from "../common/PackageInstallSuccessModal";

function formatBytes(bytes?: number | null): string {
  if (bytes == null || bytes <= 0) return "?";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)} MB`;
}

const REPACKERS = ["FitGirl", "DODI", "ElAmigos", "Chovka", "TENOKE", "Empress", "RUNE", "GOG"];
const GAMES_PER_PAGE = 24;

type DebridCatalogSectionProps = {
  onNavigateToGame?: (appId: string) => void;
};

export default function DebridCatalogSection({ onNavigateToGame }: DebridCatalogSectionProps) {
  const [activeRepacker, setActiveRepacker] = useState<string | null>(null);
  const [games, setGames] = useState<RepackQueryResult[]>([]);
  const [libraryGameIds] = useState(() => {
    try {
      const lib = getAllDebridGames();
      return new Set(lib.map((g) => g.providerGameId).filter((id): id is string => !!id));
    } catch {
      return new Set<string>();
    }
  });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const loadGames = useCallback(
    async (repacker: string | null, query: string, pageNum: number) => {
      setLoading(true);
      try {
        if (query.trim()) {
          const results = await queryRepackCatalogFuzzy(query, GAMES_PER_PAGE);
          setGames(results);
          setHasMore(false);
        } else if (repacker) {
          const results = await queryRepackCatalogByRepacker(repacker, GAMES_PER_PAGE, pageNum * GAMES_PER_PAGE);
          if (pageNum === 0) {
            setGames(results);
          } else {
            setGames((prev) => [...prev, ...results]);
          }
          setHasMore(results.length === GAMES_PER_PAGE);
        } else {
          setGames([]);
          setHasMore(false);
        }
      } catch (err) {
        console.error("[DEBRID_CATALOG] Failed to load:", err);
        showError("Failed to load repack catalog");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (activeRepacker) {
      setPage(0);
      loadGames(activeRepacker, searchQuery, 0);
    }
  }, [activeRepacker, searchQuery, loadGames]);

  const handleRepackerClick = useCallback((repacker: string) => {
    setActiveRepacker((prev) => (prev === repacker ? null : repacker));
    setSearchQuery("");
  }, []);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setActiveRepacker(null);
      loadGames(null, searchQuery, 0);
    },
    [searchQuery, loadGames],
  );

  const handleLoadMore = useCallback(() => {
    const nextPage = page + 1;
    setPage(nextPage);
    if (activeRepacker) {
      loadGames(activeRepacker, searchQuery, nextPage);
    }
  }, [page, activeRepacker, searchQuery, loadGames]);

  const displayGames = useMemo(() => {
    if (!DEBRID_LIBRARY_ENABLED) return [];
    return games;
  }, [games]);

  if (!DEBRID_LIBRARY_ENABLED) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-(--color-muted)">
        <Package className="mb-4 h-12 w-12 opacity-30" />
        <p className="text-lg font-medium">Debrid Library Disabled</p>
        <p className="mt-1 text-sm">Enable Debrid integration in Settings → Integrations.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-(--color-text)">Repack Catalog</h2>
          <p className="text-sm text-(--color-muted)">
            Debrid/Hydra repack sources — click a repacker to browse
          </p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted)" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search repacks by title..."
            className="h-10 w-full rounded-xl border border-(--surface-active-border) bg-white/5 pl-10 pr-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-cyan-400"
          />
        </div>
        <button
          type="submit"
          className="flex h-10 items-center gap-2 rounded-xl bg-cyan-500/20 px-4 text-sm font-medium text-cyan-400 transition hover:bg-cyan-500/30"
        >
          <Search className="h-4 w-4" />
          Search
        </button>
      </form>

      {/* Repacker pills */}
      <div className="flex flex-wrap gap-2">
        {REPACKERS.map((repacker) => (
          <button
            key={repacker}
            type="button"
            onClick={() => handleRepackerClick(repacker)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
              activeRepacker === repacker
                ? "bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-400/30"
                : "bg-white/5 text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
            }`}
          >
            {repacker}
          </button>
        ))}
      </div>

      {/* Game grid */}
      {loading && games.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
        </div>
      ) : displayGames.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-(--color-muted)">
          <Package className="mb-4 h-12 w-12 opacity-30" />
          <p className="text-lg font-medium">No repacks found</p>
          <p className="mt-1 text-sm">
            {searchQuery
              ? "Try a different search term"
              : "Select a repacker above or add Hydra sources in Settings"}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {displayGames.map((game) => {
              const inLibrary = game.id ? libraryGameIds.has(game.id) : false;
              return (
                <GameCard
                  key={game.id}
                  game={game}
                  inLibrary={inLibrary}
                  onNavigate={onNavigateToGame}
                />
              );
            })}
          </div>

          {hasMore && (
            <div className="flex justify-center py-6">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl bg-white/5 px-6 py-3 text-sm font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Load More
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Game Card ──

type GameCardProps = {
  game: RepackQueryResult;
  inLibrary: boolean;
  onNavigate?: (appId: string) => void;
};

function GameCard({ game, inLibrary, onNavigate }: GameCardProps) {
  const [localStatus, setLocalStatus] = useState(() => game.id ? getDebridGameStatus(game.id) : "not-downloaded");
  const [setupLoading, setSetupLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const downloadQueue = useDownloadQueue();

  // Refresh status when store updates
  useEffect(() => {
    if (!game.id) return;
    const interval = setInterval(() => {
      const s = getDebridGameStatus(game.id!);
      setLocalStatus(s);
    }, 1500);
    return () => clearInterval(interval);
  }, [game.id]);

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!game.downloadUris?.[0] || !game.id) return;

    markDebridGameStatus(game.id, "downloading");
    setLocalStatus("downloading");

    downloadQueue.addDebridInstallJob(
      game.id,
      game.title,
      game.downloadUris[0],
      game.installerType || "zip",
      game.appId > 0 ? String(game.appId) : undefined,
      undefined,
      game.repacker,
    );

    showSuccess("Download queued. Check the Downloads page for progress.");
  }, [game, downloadQueue]);

  const handleRunSetup = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!game.id) return;

    const pending = getPendingSetup(game.id);
    if (!pending) {
      showError("No pending setup found. Try downloading again.");
      return;
    }

    setSetupLoading(true);
    try {
      const result = await setupDebridGame({
        installerPath: pending.installerPath,
        installDir: pending.installDir,
      });

      clearPendingSetup(game.id);

      if (result.success) {
        updateDebridGame(game.id, pending.installDir, result.executablePath ?? undefined);
        markDebridGameStatus(game.id, "ready");
        setLocalStatus("ready");
        setShowSuccessModal(true);
      } else {
        showError(result.message || "Setup failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError(`Setup failed: ${msg}`);
    } finally {
      setSetupLoading(false);
    }
  }, [game]);

  const handlePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (game.appId > 0 && onNavigate) {
      onNavigate(String(game.appId));
    }
  }, [game, onNavigate]);

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/[0.02] transition-all hover:border-white/10 hover:bg-white/[0.04] ${(localStatus === "ready" || localStatus === "needs-setup") && game.appId > 0 ? "cursor-pointer" : "cursor-default"}`}
    >
      {/* Success modal */}
      {game.id && (
        <PackageInstallSuccessModal
          open={showSuccessModal}
          gameTitle={game.title}
          appId={game.appId > 0 ? String(game.appId) : "debrid"}
          primaryButtonLabel="Install Now"
          onViewInLibrary={() => {
            setShowSuccessModal(false);
            if (game.appId > 0) onNavigate?.(String(game.appId));
          }}
          onContinueBrowsing={() => setShowSuccessModal(false)}
        />
      )}

      {/* Top gradient */}
      <div className="bg-linear-to-br from-cyan-500/10 to-transparent p-4 pb-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-cyan-400" />
          <span className="text-xs font-medium text-cyan-400">{game.repacker}</span>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pb-4">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-(--color-text)">
          {game.title}
        </h3>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {game.appId > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-(--color-muted)">
              <Tag className="h-3 w-3" />
              {game.appId}
            </span>
          )}
          {localStatus === "needs-setup" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
              <Settings2 className="h-3 w-3" />
              Setup needed
            </span>
          )}
          {inLibrary && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
              <Star className="h-3 w-3" />
              In Library
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-3 text-[10px] text-(--color-muted)">
          <span className="inline-flex items-center gap-1">
            <HardDrive className="h-3 w-3" />
            {game.fileSize > 0 ? formatBytes(game.fileSize) : "?"}
          </span>
          {game.installSize && game.installSize > 0 && (
            <span className="inline-flex items-center gap-1">
              <Download className="h-3 w-3" />
              {formatBytes(game.installSize)}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          {localStatus === "not-downloaded" && game.downloadUris?.[0] && (
            <button
              type="button"
              onClick={handleDownload}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-cyan-500/20 px-3 py-2 text-xs font-medium text-cyan-400 transition hover:bg-cyan-500/30"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
          )}
          {localStatus === "downloading" && (
            <div className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Downloading...
            </div>
          )}
          {localStatus === "needs-setup" && (
            <button
              type="button"
              onClick={handleRunSetup}
              disabled={setupLoading}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-500/20 px-3 py-2 text-xs font-medium text-amber-400 transition hover:bg-amber-500/30 disabled:opacity-50"
            >
              {setupLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Settings2 className="h-3.5 w-3.5" />
              )}
              {setupLoading ? "Installing..." : "Run Setup"}
            </button>
          )}
          {localStatus === "ready" && (
            <button
              type="button"
              onClick={handlePlay}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500/20 px-3 py-2 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/30"
            >
              <Play className="h-3.5 w-3.5" />
              Play
            </button>
          )}
        </div>

        {game.installerType && (
          <div className="mt-2">
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-(--color-muted)">
              {game.installerType}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
