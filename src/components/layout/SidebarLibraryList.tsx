import { useEffect, useMemo, useRef, useState } from "react";
import { Gamepad2, Loader2, Search } from "lucide-react";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useGameSession, computeGameKey } from "../../context/GameSessionContext";
import type { LibraryGame } from "../../types/libraryGame";
import type { LibraryAppInfoEntry } from "../../services/tauri";
import AsyncImage from "../common/AsyncImage";
import { SkeletonBox } from "../common/Skeleton";
import { batchLoadGameMedia, resolveSidebarMedia } from "../../services/gameCacheService";
import type { GameAppInfo, ResolvedSidebarMedia, GameMediaPaths } from "../../services/gameCacheService";
import { getBootSnapshot } from "../../services/appBootCoordinator";

const ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS = false;

type Props = {
  onOpenGame?: () => void;
  compact?: boolean;
  collapsed?: boolean;
};

function pickSidebarSrc(resolved: ResolvedSidebarMedia | null): string | null {
  if (!resolved) return null;
  if (resolved.landscape.exists && resolved.landscape.src) {
    return resolved.landscape.src;
  }
  if (resolved.cover.exists && resolved.cover.src) {
    return resolved.cover.src;
  }
  return null;
}

function pickSidebarFallbackPath(resolved: ResolvedSidebarMedia | null): string | null {
  if (!resolved) return null;
  if (resolved.landscape.exists && resolved.landscape.localPath) {
    return resolved.landscape.localPath;
  }
  if (resolved.cover.exists && resolved.cover.localPath) {
    return resolved.cover.localPath;
  }
  return null;
}

function getSidebarTitle(game: LibraryGame, appInfoEntry?: LibraryAppInfoEntry | null): string {
  if (appInfoEntry?.name) return appInfoEntry.name;
  return game.title || (game.appId ? `Steam App ${game.appId}` : "Unknown Game");
}

function getSnapshotMedia(appId: string): GameMediaPaths | null {
  const snapshot = getBootSnapshot();
  if (!snapshot) return null;
  for (const g of snapshot.library.games) {
    if (g.appId === appId) {
      return {
        landscapePath: g.media.landscapePath ?? null,
        coverPath: g.media.coverPath ?? null,
        backgroundPath: g.media.backgroundPath ?? null,
        logoPath: g.media.logoPath ?? null,
        iconPath: g.media.iconPath ?? null,
      };
    }
  }
  return null;
}

export default function SidebarLibraryList({ onOpenGame, compact = false, collapsed = false }: Props) {
  const { games, selectedGame, setSelectedGame, loading, initialLoading, appInfoMap } = useLibraryGames();
  const { getState } = useGameSession();
  const [query, setQuery] = useState("");
  const [canonicalInfoMap, setCanonicalInfoMap] = useState<Record<string, GameAppInfo | null>>({});
  const [sidebarMediaMap, setSidebarMediaMap] = useState<Record<string, ResolvedSidebarMedia | null>>({});
  const canonicalLoadedAppIds = useRef<Set<string>>(new Set());
  const sidebarMediaLoading = useRef<Set<string>>(new Set());

  const installed = useMemo(() => {
    return games.filter((g) => g.isPlayable || g.steamInstalled || (g.source === "local" && !!g.executablePath));
  }, [games]);

  const filtered = useMemo(() => {
    if (!query) return installed;
    const q = query.toLowerCase();
    return installed.filter((g) => {
      const entry = g.appId ? appInfoMap[g.appId] : undefined;
      const displayName = entry?.name || g.title;
      return displayName.toLowerCase().includes(q) || g.appId?.toLowerCase().includes(q);
    });
  }, [installed, query, appInfoMap]);

  const isCollapsedMode = collapsed;
  const isCompactMode = compact && !collapsed;
  const isFullMode = !compact && !collapsed;

  // Load canonical appinfo lazily — only for filtered (visible) games
  useEffect(() => {
    const ids = filtered.map((g) => g.appId).filter(Boolean) as string[];
    if (ids.length === 0) return;
    const allIds = [...new Set(ids)];
    const newIds = allIds.filter((id) => !canonicalLoadedAppIds.current.has(id));
    if (newIds.length === 0) return;
    const loadAllBatches = async () => {
      const batchSize = 20;
      for (let i = 0; i < newIds.length; i += batchSize) {
        const batch = newIds.slice(i, i + batchSize);
        for (const id of batch) canonicalLoadedAppIds.current.add(id);
        const map = await batchLoadGameMedia(batch);
        setCanonicalInfoMap((prev) => ({ ...prev, ...map }));
      }
    };
    loadAllBatches();
  }, [filtered]);

  // Resolve sidebar media for visible games — use snapshot paths first
  useEffect(() => {
    const ids = filtered.map((g) => g.appId).filter(Boolean) as string[];
    const uniqueIds = [...new Set(ids)];
    const unloadedIds = uniqueIds.filter(
      (id) => !sidebarMediaLoading.current.has(id) && sidebarMediaMap[id] === undefined
    );
    if (unloadedIds.length === 0) return;

    const batchSize = 10;
    const loadBatch = async () => {
      for (let i = 0; i < unloadedIds.length; i += batchSize) {
        const batch = unloadedIds.slice(i, i + batchSize);
        for (const id of batch) sidebarMediaLoading.current.add(id);
        const results = await Promise.all(
          batch.map(async (id) => {
            // Try snapshot first (no disk I/O)
            const snapshotMedia = getSnapshotMedia(id);
            const appInfo = canonicalInfoMap[id] ?? null;
            const resolved = await resolveSidebarMedia(id, appInfo, snapshotMedia);

            if (ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS) {
              const selectedSrc = pickSidebarSrc(resolved);
              console.log(`[SidebarMedia]`, {
                appId: id,
                fromSnapshot: !!snapshotMedia,
                selectedSource: selectedSrc ? (resolved.landscape.exists ? "landscape" : "cover") : "placeholder",
              });
            }
            return [id, resolved] as const;
          })
        );
        setSidebarMediaMap((prev) => {
          const next = { ...prev };
          for (const [id, resolved] of results) {
            next[id] = resolved;
          }
          return next;
        });
      }
    };
    loadBatch();
  }, [filtered, canonicalInfoMap]);

  return (
    <div className="flex flex-col">
      {/* Header */}
      {isFullMode && (
        <div className="mb-2 flex items-center justify-between px-1">
          <Gamepad2 className="h-4.5 w-4.5" />
          <span className="text-xs font-bold text-(--color-text)">Juegos</span>
          <span className="text-[10px] text-(--color-muted)">{installed.length} games</span>
        </div>
      )}

      {isCompactMode && (
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[11px] font-bold text-(--color-text)">Juegos</span>
          <span className="text-[10px] text-(--color-muted)">{installed.length}</span>
        </div>
      )}

      {/* Search */}
      {isFullMode && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--color-muted)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search library..."
            className="w-full rounded-lg border border-(--surface-active-border) bg-white/5 py-1.5 pl-7 pr-2.5 text-xs text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)/40"
          />
        </div>
      )}

      {isCompactMode && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--color-muted)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar..."
            className="w-full rounded-lg border border-(--surface-active-border) bg-white/5 py-1 pl-7 pr-2 text-[11px] text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)/40"
          />
        </div>
      )}

      {/* Game list */}
      <div className={`${
        isCollapsedMode ? "space-y-2" : "space-y-0.5"
      }`}>
        {(initialLoading || (loading && games.length === 0)) ? (
          isCollapsedMode ? (
            <div className="space-y-2 py-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex justify-center px-2">
                  <SkeletonBox className="h-10 w-10 shrink-0 rounded-xl" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1 py-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                  <SkeletonBox className="h-6 w-10 shrink-0 rounded" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <SkeletonBox className="h-3 w-3/4" />
                    <SkeletonBox className="h-2 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          )
        ) : filtered.length === 0 ? (
          isCollapsedMode ? null : (
            <p className="py-2 text-center text-[10px] text-(--color-muted)">No games match.</p>
          )
        ) : (
          filtered.map((game) => {
            const isSelected = selectedGame?.id === game.id;
            const appInfoEntry = game.appId ? (appInfoMap[game.appId] ?? null) : null;
            const resolved = game.appId ? (sidebarMediaMap[game.appId] ?? null) : null;
            const resolvedThumb = pickSidebarSrc(resolved);
            const sidebarFallbackPath = pickSidebarFallbackPath(resolved);
            const displayTitle = getSidebarTitle(game, appInfoEntry);
            const gk = computeGameKey(game);
            const gs = getState(gk);
            const isRunning = gs === "running";
            const isLaunching = gs === "launching";

            if (isCollapsedMode) {
              return (
                <button
                  key={game.id}
                  type="button"
                  title={displayTitle}
                  onClick={() => {
                    setSelectedGame(game);
                    onOpenGame?.();
                  }}
                  className={`flex w-full cursor-pointer items-center justify-center rounded-xl px-1 py-1.5 transition-colors ${
                    isSelected
                      ? "bg-(--color-accent)/10 ring-1 ring-(--color-accent)/30"
                      : "hover:bg-white/[0.06]"
                  }`}
                >
                  <div className="relative h-10 w-10 overflow-hidden rounded-xl object-cover">
                    {resolvedThumb ? (
                      <AsyncImage
                        src={resolvedThumb}
                        alt=""
                        className="h-full w-full object-cover"
                        fallbackLocalPath={sidebarFallbackPath}
                        fallback={
                          <Gamepad2 className="h-4 w-4 text-(--color-muted)" />
                        }
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white/5">
                        <Gamepad2 className="h-4 w-4 text-(--color-muted)" />
                      </div>
                    )}
                    {isRunning && (
                      <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-black/50" />
                    )}
                  </div>
                </button>
              );
            }

            return (
              <button
                key={game.id}
                type="button"
                onClick={() => {
                  setSelectedGame(game);
                  onOpenGame?.();
                }}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                  isSelected
                    ? "bg-(--color-accent)/10 text-(--color-accent)"
                    : "text-(--color-text) hover:bg-white/[0.06]"
                }`}
              >
                <div className={`relative shrink-0 overflow-hidden rounded object-cover ${
                  isCompactMode ? "h-6 w-9" : "h-6 w-10"
                }`}>
                  {resolvedThumb ? (
                    <AsyncImage
                      src={resolvedThumb}
                      alt=""
                      className="h-full w-full object-cover"
                      fallbackLocalPath={sidebarFallbackPath}
                      fallback={
                        <Gamepad2 className="h-3 w-3 text-(--color-muted)" />
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/5">
                      <Gamepad2 className="h-3 w-3 text-(--color-muted)" />
                    </div>
                  )}
                  {isRunning && (
                    <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-black/50" />
                  )}
                  {isLaunching && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-3 w-3 animate-spin text-white" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {isRunning && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />}
                    <span className={`truncate font-medium leading-tight ${
                      isCompactMode ? "text-[11px]" : ""
                    }`}>
                      {isCompactMode && displayTitle.length > 16
                        ? displayTitle.slice(0, 14) + ".."
                        : displayTitle
                      }
                    </span>
                  </div>
                  {!isCompactMode && (
                    <div className="text-[10px] text-(--color-muted)">
                      {isRunning ? "Running" : isLaunching ? "Launching" : game.source === "steam" ? "Steam" : game.source === "local" ? "Local" : "Lua"}
                      {!isRunning && !isLaunching && game.hasUpdate && " · Update"}
                    </div>
                  )}
                  {isCompactMode && (
                    <div className="text-[9px] text-(--color-muted)">
                      {isRunning ? "Running" : isLaunching ? "Launching" : game.source === "steam" ? "Steam" : game.source === "local" ? "Local" : "Lua"}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
