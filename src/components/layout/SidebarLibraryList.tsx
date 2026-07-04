import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileText,
  FolderOpen,
  Gamepad2,
  Heart,
  Loader2,
  Play,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useGameSession, computeGameKey } from "../../context/GameSessionContext";
import { useFavorites } from "../../context/FavoritesContext";
import type { LibraryGame } from "../../types/libraryGame";
import type { LibraryAppInfoEntry } from "../../services/tauri";
import AsyncImage from "../common/AsyncImage";
import { SkeletonBox } from "../common/Skeleton";
import { batchLoadGameMedia, resolveSidebarMedia } from "../../services/gameCacheService";
import type { GameAppInfo, ResolvedSidebarMedia, GameMediaPaths } from "../../services/gameCacheService";
import { getBootSnapshot } from "../../services/appBootCoordinator";
import { backgroundJobQueue } from "../../services/backgroundJobQueue";
import CardActionMenu, { MenuItem } from "../games/CardActionMenu";
import { showSuccess, showError } from "../toast/GameToast";
import { useConfirm } from "../../services/confirmService";
import type { AppPage } from "../../types/navigation";

const ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS = false;

type Props = {
  onOpenGame?: () => void;
  activePage?: AppPage;
  compact?: boolean;
  collapsed?: boolean;
  variant?: "full" | "header" | "list";
};

function logSidebarMedia(appId: string, msg: string): void {
  if (ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS) {
    console.log(`[MEDIA][SIDEBAR] appid=${appId} ${msg}`);
  }
}

function pickSidebarSrc(resolved: ResolvedSidebarMedia | null, appId?: string): string | null {
  if (!resolved) return null;
  const priorities: Array<{ key: keyof ResolvedSidebarMedia; label: string }> = [
    { key: "icon", label: "icon" },
    { key: "cover", label: "cover" },
    { key: "landscape", label: "landscape" },
    { key: "background", label: "background" },
  ];
  for (const { key, label } of priorities) {
    const item = resolved[key];
    if (item?.exists && item.src) {
      if (appId) logSidebarMedia(appId, `selected=${label} path=${item.localPath} exists=true`);
      return item.src;
    }
  }
  if (appId) {
    const allFields = resolved.icon?.exists || resolved.cover?.exists || resolved.landscape?.exists || resolved.background?.exists;
    const reason = !resolved ? "no-resolved-object" : !allFields ? "no-media-fields" : "files-missing";
    logSidebarMedia(appId, `selected=placeholder path=null exists=false placeholderReason=${reason}`);
  }
  return null;
}

function pickSidebarFallbackPath(resolved: ResolvedSidebarMedia | null): string | null {
  if (!resolved) return null;
  const priorities: Array<keyof ResolvedSidebarMedia> = ["icon", "cover", "landscape", "background"];
  for (const key of priorities) {
    const item = resolved[key];
    if (item?.exists && item.localPath) {
      return item.localPath;
    }
  }
  return null;
}

function getSidebarTitle(game: LibraryGame, appInfoEntry?: LibraryAppInfoEntry | null): string {
  if (appInfoEntry?.name) return appInfoEntry.name;
  if (game.title && !game.title.startsWith("Steam App ")) return game.title;
  if (game.appId) {
    logSidebarMedia(game.appId, `placeholderReason=no-name-fallback title="Steam App ${game.appId}"`);
    return `Steam App ${game.appId}`;
  }
  return "Unknown Game";
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

export default function SidebarLibraryList({ onOpenGame, activePage, compact = false, collapsed = false, variant = "full" }: Props) {
  const { games, selectedGame, setSelectedGame, loading, initialLoading, appInfoMap } = useLibraryGames();
  const { getState, launchGame, stopSession } = useGameSession();
  const [query, setQuery] = useState("");
  const [canonicalInfoMap, setCanonicalInfoMap] = useState<Record<string, GameAppInfo | null>>({});
  const [sidebarMediaMap, setSidebarMediaMap] = useState<Record<string, ResolvedSidebarMedia | null>>({});
  const [menuGame, setMenuGame] = useState<LibraryGame | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const { isFavorite, toggleFavorite } = useFavorites();
  const sidebarMenuAnchorRef = useRef<HTMLButtonElement>(null);
  const canonicalLoadedAppIds = useRef<Set<string>>(new Set());
  const sidebarMediaLoading = useRef<Set<string>>(new Set());
  const sidebarRepairEnqueued = useRef<Set<string>>(new Set());
  const [startupBatchDelayPassed, setStartupBatchDelayPassed] = useState(false);
  const { confirm } = useConfirm();

  // Defer all batch processing by 5s so initial mount stays zero-work
  useEffect(() => {
    const t = setTimeout(() => setStartupBatchDelayPassed(true), 5000);
    return () => clearTimeout(t);
  }, []);

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

  // Load canonical appinfo lazily — only for filtered (visible) games, deferred 5s on mount
  useEffect(() => {
    if (!startupBatchDelayPassed) return;
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
  // Retries when canonicalInfoMap becomes available for IDs that resolved with no usable media
  const [sidebarRetryKey, setSidebarRetryKey] = useState(0);
  useEffect(() => {
    const ids = filtered.map((g) => g.appId).filter(Boolean) as string[];
    const uniqueIds = [...new Set(ids)];
    const hasUsableMedia = (id: string) => {
      const r = sidebarMediaMap[id];
      return r ? (r.landscape.exists || r.cover.exists || r.icon.exists || r.background.exists) : false;
    };
    const unloadedIds = uniqueIds.filter((id) => {
      if (sidebarMediaLoading.current.has(id)) return false;
      if (sidebarMediaMap[id] === undefined) return true;
      if (!hasUsableMedia(id) && canonicalInfoMap[id]) return true;
      return false;
    });
    if (unloadedIds.length === 0) return;

    const batchSize = 10;
    const loadBatch = async () => {
      for (let i = 0; i < unloadedIds.length; i += batchSize) {
        const batch = unloadedIds.slice(i, i + batchSize);
        for (const id of batch) sidebarMediaLoading.current.add(id);
        const results = await Promise.all(
          batch.map(async (id) => {
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
        for (const id of batch) {
          sidebarMediaLoading.current.delete(id);
        }
      }
    };
    loadBatch();
  }, [filtered, canonicalInfoMap, sidebarRetryKey]);

  // Trigger retry when canonicalInfoMap gains entries for IDs with incomplete media
  useEffect(() => {
    const ids = Object.keys(canonicalInfoMap);
    const needsRetry = ids.some((id) => {
      const r = sidebarMediaMap[id];
      return r !== undefined && !r?.landscape?.exists && !r?.cover?.exists && !r?.icon?.exists;
    });
    if (needsRetry) setSidebarRetryKey((k) => k + 1);
  }, [canonicalInfoMap]);

  // High-priority media repair for visible games with missing thumbnails
  useEffect(() => {
    const ids = filtered.map((g) => g.appId).filter(Boolean) as string[];
    const uniqueIds = [...new Set(ids)];
    const missingIds = uniqueIds.filter((id) => {
      const resolved = sidebarMediaMap[id];
      if (!resolved) return false; // still loading
      return !resolved.landscape.exists && !resolved.cover.exists;
    });

    if (missingIds.length === 0) return;

    for (const id of missingIds) {
      if (sidebarRepairEnqueued.current.has(id)) continue;
      sidebarRepairEnqueued.current.add(id);
      const key = backgroundJobQueue.enqueue("repair-game-media", "steam", { appId: id, priority: "high" });
      if (ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS) {
        console.log(`[MEDIA][SIDEBAR] visible=${uniqueIds.length} missing=${missingIds.length}`);
        console.log(`[JOB] queued key=${key} priority=high`);
      }
    }
  }, [filtered, sidebarMediaMap]);

  function handleContextMenu(e: React.MouseEvent<HTMLButtonElement>, game: LibraryGame) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedGame(game);
    sidebarMenuAnchorRef.current = e.currentTarget;
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setMenuGame(game);
    setMenuOpen(true);
  }

  function handleMenuClose() {
    setMenuOpen(false);
    setContextMenuPos(null);
    setMenuGame(null);
  }

  const renderHeader = () => (
    <>
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
    </>
  );

  const renderGameList = () => (
    <div className={`${isCollapsedMode ? "space-y-2" : "space-y-0.5"}`}>
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
          const isSelected = activePage === "library-game-detail" && selectedGame?.id === game.id;
          const appInfoEntry = game.appId ? (appInfoMap[game.appId] ?? null) : null;
          const resolved = game.appId ? (sidebarMediaMap[game.appId] ?? null) : null;
          const resolvedThumb = pickSidebarSrc(resolved, game.appId ?? undefined);
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
                onContextMenu={(e) => handleContextMenu(e, game)}
                className={`flex w-full cursor-pointer items-center justify-center rounded-xl px-1 py-1.5 transition-colors ${isSelected
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
              onContextMenu={(e) => handleContextMenu(e, game)}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${isSelected
                ? "bg-(--color-accent)/10 text-(--color-accent)"
                : "text-(--color-text) hover:bg-white/[0.06]"
                }`}
            >
              <div className={`relative shrink-0 overflow-hidden rounded object-cover ${isCompactMode ? "h-6 w-9" : "h-6 w-10"
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
                  <span className={`truncate font-medium leading-tight ${isCompactMode ? "text-[11px]" : ""
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
  );

  const renderMenu = () => (
    menuGame && (
      <CardActionMenu
        open={menuOpen}
        anchorRef={sidebarMenuAnchorRef as React.RefObject<HTMLElement | null>}
        onClose={handleMenuClose}
        cursorPos={contextMenuPos}
        gameId={menuGame.appId}
      >
        {(() => {
          const mgk = computeGameKey(menuGame);
          const mState = getState(mgk);
          const isRunning = mState === "running";
          const mAction = menuGame.isPlayable || menuGame.steamInstalled ? "play" : "install";
          const mHasLua = menuGame.luaScripts.length > 0;
          const fav = menuGame.appId ? isFavorite(menuGame.appId) : false;

          return (
            <>
              {isRunning ? (
                <MenuItem
                  label="Stop"
                  icon={<X className="h-3.5 w-3.5" />}
                  onClick={() => { handleMenuClose(); stopSession(mgk); }}
                />
              ) : mAction === "play" ? (
                <MenuItem
                  label="Play"
                  icon={<Play className="h-3.5 w-3.5" />}
                  onClick={() => { handleMenuClose(); launchGame(menuGame); }}
                />
              ) : (
                <MenuItem
                  label="Install"
                  icon={<Download className="h-3.5 w-3.5" />}
                  onClick={() => { handleMenuClose(); }}
                />
              )}
              <MenuItem
                label={fav ? "Remove from favorites" : "Add to favorites"}
                icon={<Heart className={`h-3.5 w-3.5 ${fav ? "fill-current" : ""}`} />}
                onClick={() => {
                  if (menuGame.appId) toggleFavorite(menuGame.appId);
                  handleMenuClose();
                }}
              />
              <MenuItem
                label="Browse Local Files"
                icon={<FolderOpen className="h-3.5 w-3.5" />}
                onClick={() => {
                  handleMenuClose();
                  if (menuGame.installDir) {
                    invoke("open_folder", { path: menuGame.installDir }).catch((err) => {
                      showError(`Could not open folder: ${err}`);
                    });
                  }
                }}
              />
              <MenuItem
                label="Create Shortcut"
                icon={<FileText className="h-3.5 w-3.5" />}
                onClick={async () => {
                  handleMenuClose();

                  try {
                    const installDir = menuGame.installDir;

                    if (!installDir) {
                      showError("Install directory not found");
                      return;
                    }

                    const { discoverExecutables } = await import("../../services/tauri");

                    const executables = await discoverExecutables(installDir);

                    console.log("Executables found:", executables);

                    if (!executables.length) {
                      showError("No executables found in this folder");
                      return;
                    }

                    const exe = executables[0];

                    const exePath = exe.exe_path;

                    const path = await invoke<string>("create_shortcut", {
                      exePath,
                      name: menuGame.title || `Game ${menuGame.appId}`,
                    });

                    showSuccess(`Shortcut created:\n${path}`);

                  } catch (err) {
                    showError(`Could not create shortcut: ${err}`);
                  }
                }}
              />

              <MenuItem
                label="Manage"
                icon={<Settings className="h-3.5 w-3.5" />}
                  children={[
                    {
                      label: "Uninstall",
                      icon: <Trash2 className="h-3.5 w-3.5" />,
                      disabled: !menuGame.steamInstalled,
                      subtitle: !menuGame.steamInstalled ? "Not installed" : undefined,
                      onClick: menuGame.steamInstalled ? (() => {
                        handleMenuClose();
                        confirm({
                          title: "Uninstall game?",
                          description: `This will remove the installed package for ${getSidebarTitle(menuGame, menuGame.appId ? (appInfoMap[menuGame.appId] ?? null) : null)}. Local files may be deleted depending on the install type.`,
                          confirmLabel: "Uninstall",
                          variant: "danger",
                        }).then((r) => {
                          if (r.confirmed) showSuccess("Game uninstalled (simulated).");
                        });
                      }) : undefined,
                    },
                    ...(mHasLua
                      ? [{
                        label: "Delete Lua",
                        icon: <X className="h-3.5 w-3.5" />,
                        destructive: true as const,
                        disabled: true,
                      }]
                      : []),
                  ]}
                />
              </>
            );
          })()}
        </CardActionMenu>
      )
  );

  // Collapsed mode: render everything inline (icons only)
  if (isCollapsedMode) {
    return (
      <div className="flex flex-col">
        {renderGameList()}
        {renderMenu()}
      </div>
    );
  }

  // Split mode: header-only or list-only
  if (variant === "header") {
    return (
      <div className="flex flex-col">
        {renderHeader()}
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div className="flex flex-col">
        {renderGameList()}
        {renderMenu()}
      </div>
    );
  }

  // Full mode (default): everything
  return (
    <div className="flex flex-col">
      {renderHeader()}
      {renderGameList()}
      {renderMenu()}
    </div>
  );
}
