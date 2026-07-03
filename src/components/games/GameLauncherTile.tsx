import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileText,
  FolderOpen,
  Gamepad2,
  Heart,
  MoreHorizontal,
  Play,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { LibraryGame } from "../../types/libraryGame";
import type { LibraryAppInfoEntry } from "../../services/tauri";
import type { GameAppInfo } from "../../services/gameCacheService";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import { useSettings } from "../../context/SettingsContext";
import { useInViewport } from "../../hooks/useInViewport";
import { useHoverPrefetch } from "../../hooks/useHoverPrefetch";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import AsyncImage from "../common/AsyncImage";
import Tooltip from "../common/Tooltip";
import CardActionMenu, { MenuItem } from "./CardActionMenu";
import { SkeletonBox } from "../common/Skeleton";
import {
  isHttpUrl,
  isLocalPath,
} from "../../services/libraryLocalCacheService";
import {
  loadGameAppInfoWithMediaFallback,
  resolveGameMediaUrl,
  resolveCanonicalDisplayTitle,
  resolveCanonicalName,
} from "../../services/gameCacheService";
import { useGameSession, computeGameKey } from "../../context/GameSessionContext";
import { useFavorites } from "../../context/FavoritesContext";
import { showSuccess, showError } from "../toast/GameToast";

type GameLauncherTileProps = {
  game: LibraryGame;
  appInfoEntry?: LibraryAppInfoEntry | null;
  onSelect: (game: LibraryGame) => void;
  onPlay: (game: LibraryGame) => void;
  onInstall: (game: LibraryGame) => void;
  onDeleteScript?: (game: LibraryGame) => void;
};

function getCardImage(
  mode: "landscape" | "poster",
  canonicalAppInfo: GameAppInfo | null,
): string | undefined {
  if (mode === "poster") {
    return (
      canonicalAppInfo?.media?.coverPath ||
      canonicalAppInfo?.media?.landscapePath ||
      canonicalAppInfo?.media?.backgroundPath ||
      undefined
    );
  }

  return (
    canonicalAppInfo?.media?.landscapePath ||
    canonicalAppInfo?.media?.backgroundPath ||
    canonicalAppInfo?.media?.coverPath ||
    undefined
  );
}

export default function GameLauncherTile({
  game,
  appInfoEntry,
  onSelect,
  onPlay,
  onInstall,
  onDeleteScript,
}: GameLauncherTileProps) {
  const { settings } = useSettings();
  const { ref, isVisible } = useInViewport();
  const { onMouseEnter, onMouseLeave } = useHoverPrefetch(game.appId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = game.appId ? isFavorite(game.appId) : false;
  const [canonicalInfo, setCanonicalInfo] = useState<GameAppInfo | null>(null);
  const [mediaLoading, setMediaLoading] = useState(true);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const hasRequestedData = useRef(false);
  const hasMountedData = useRef(false);

  // Request game data via priority system when card enters viewport
  useEffect(() => {
    if (!game.appId || !isVisible || hasRequestedData.current) return;
    hasRequestedData.current = true;
    requestGameData(game.appId, LoadPriority.VIEWPORT);
  }, [game.appId, isVisible]);

  // Load canonical appinfo for this game — deferred until visible
  useEffect(() => {
    if (!game.appId || !isVisible) {
      if (!game.appId) setMediaLoading(false);
      return;
    }
    if (hasMountedData.current) return;
    hasMountedData.current = true;
    let cancelled = false;
    setMediaLoading(true);
    loadGameAppInfoWithMediaFallback(game.appId)
      .then(async (appInfo) => {
        if (cancelled) return;
        // Ensure canonical name is resolved — if appinfo.name is null/placeholder,
        // try metadata resolver and store details, and write back to disk.
        if (appInfo && (!appInfo.name || appInfo.name.startsWith("Steam App "))) {
          const resolvedName = await resolveCanonicalName(game.appId!);
          if (resolvedName) {
            appInfo.name = resolvedName;
          }
        }
        if (!cancelled) {
          setCanonicalInfo(appInfo);
          setMediaLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setMediaLoading(false);
      });
    return () => { cancelled = true; };
  }, [game.appId, isVisible]);

  const artworkMode = settings.libraryCardArtworkMode ?? "landscape";

  const displayTitle = game.customTitle || resolveCanonicalDisplayTitle(
    game.appId ?? "",
    game,
    appInfoEntry,
    canonicalInfo,
  );

  // Source trace log — emitted once per instance per game
  const displayTraced = useRef(false);
  if (!displayTraced.current && game.appId) {
    displayTraced.current = true;
    const sources = [
      { key: "canonical", val: canonicalInfo?.name },
      { key: "appInfoEntry", val: appInfoEntry?.name },
      { key: "metadata", val: game?.metadata?.name },
      { key: "gameTitle", val: game?.title },
    ];
    const winner = sources.find((s) => s.val && !s.val.startsWith("Steam App "));
    console.log(`[NAME][SOURCE_TRACE] surface=grid appid=${game.appId} gameTitle=${game.title} canonicalName=${canonicalInfo?.name} metadataName=${game?.metadata?.name} final=${displayTitle} source=${winner?.key || "fallback"}`);
  }

  const displayImage = useMemo(
    () => getCardImage(artworkMode, canonicalInfo),
    [artworkMode, canonicalInfo]
  );

  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!game.appId || !displayImage) {
      setResolvedSrc(undefined);
      return;
    }
    let cancelled = false;
    const logId = game.appId;
    resolveGameMediaUrl(logId, displayImage)
      .then((url) => {
        if (cancelled) return;
        if (url) {
          console.log(`[MEDIA][GRID] appid=${logId} selected=${artworkMode === "poster" ? "cover" : "landscape"} source=canonical url=true displayTitle=${displayTitle}`);
          setResolvedSrc(url);
        } else {
          console.log(`[MEDIA][GRID] appid=${logId} selected=placeholder reason=resolve-failed path=${displayImage}`);
          setResolvedSrc(undefined);
        }
      })
      .catch(() => {
        if (!cancelled) setResolvedSrc(undefined);
      });
    return () => { cancelled = true; };
  }, [game.appId, displayImage, artworkMode]);

  // Render-time diagnostics — log actual state sent to AsyncImage
  console.log(`[MEDIA][GRID_RENDER] appid=${game.appId} mediaLoading=${mediaLoading} hasResolvedSrc=${!!resolvedSrc} hasDisplayImage=${!!displayImage}`);

  // Raw local path for data URL fallback (only if it's an absolute local file path)
  const fallbackLocalPath = useMemo(() => {
    if (!displayImage) return null;
    if (isHttpUrl(displayImage)) return null;
    if (!isLocalPath(displayImage)) return null;
    return displayImage;
  }, [displayImage]);

  const { getState, stopSession } = useGameSession();
  const gk = computeGameKey(game);
  const sessionState = getState(gk);
  const isRunning = sessionState === "running";
  const action = getLauncherGamePrimaryAction(game);
  const hasLua = game.luaScripts.length > 0;

  function handleCardClick() {
    setMenuOpen(false);
    onSelect(game);
  }

  function handleActionClick(e: React.MouseEvent, cb: () => void) {
    e.stopPropagation();
    setMenuOpen(false);
    cb();
  }

  function handleMenuToggle(e: React.MouseEvent) {
    e.stopPropagation();
    setContextMenuPos(null);
    setMenuOpen((prev) => !prev);
  }

  return (
    <div ref={ref} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenuPos({ x: e.clientX, y: e.clientY }); setMenuOpen(true); }} className="group flex flex-col rounded-2xl bg-transparent transition hover:bg-white/[0.04] lf-press-effect">
      {/* Image */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCardClick();
          }
        }}
        className={`relative cursor-pointer overflow-hidden rounded-t-2xl ${artworkMode === "poster" ? "aspect-[2/3]" : "aspect-[5/3]"
          }`}
      >
        {mediaLoading ? (
          <SkeletonBox className="h-full w-full rounded-t-2xl" />
        ) : resolvedSrc ? (
          <AsyncImage
            src={resolvedSrc}
            alt={displayTitle}
            className="h-full w-full object-cover"
            fallbackLocalPath={fallbackLocalPath}
            fallback={
              <Gamepad2 className="h-8 w-8 text-(--color-muted)/40" />
            }
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/[0.02]">
            <Gamepad2 className="h-8 w-8 text-(--color-muted)/30" />
          </div>
        )}
        <div className="absolute inset-0 rounded-t-2xl bg-black/30 opacity-0 transition-opacity duration-150 group-hover:opacity-100 pointer-events-none" />
      </div>

      {/* Title + actions row */}
      <div className="flex items-start gap-1 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <Tooltip label={displayTitle} delay={400}>
            <h3
              role="button"
              tabIndex={0}
              onClick={handleCardClick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCardClick();
                }
              }}
              className="line-clamp-1 cursor-pointer text-xs font-medium text-(--color-text)/90 transition hover:text-(--color-accent)"
            >
              {displayTitle}
            </h3>
          </Tooltip>

          <div className="mt-1.5 flex items-center gap-2">
            {action === "play" && (
              <button
                type="button"
                onClick={(e) => handleActionClick(e, () => onPlay(game))}
                className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-(--color-accent)/80 transition hover:text-(--color-accent)"
              >
                <Play className="h-3 w-3" />
                Play
              </button>
            )}
            {action === "install" && (
              <button
                type="button"
                onClick={(e) => handleActionClick(e, () => onInstall(game))}
                className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-(--color-accent)/80 transition hover:text-(--color-accent)"
              >
                <Download className="h-3 w-3" />
                Install
              </button>
            )}
            {action === "missing-path" && (
              <span className="text-[10px] text-(--color-muted)/50">Missing Path</span>
            )}
          </div>
        </div>

        {/* Three-dots menu */}
        <div className="relative shrink-0">
          <Tooltip label="More actions" delay={600} disabled={menuOpen}>
            <button
              ref={menuAnchorRef}
              type="button"
              aria-label="More actions"
              onClick={handleMenuToggle}
              className="inline-flex cursor-pointer items-center justify-center rounded-lg p-1 text-(--color-muted)/50 transition hover:bg-white/[0.04] hover:text-(--color-text)"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </Tooltip>

          <CardActionMenu
            open={menuOpen}
            anchorRef={menuAnchorRef}
            onClose={() => { setMenuOpen(false); setContextMenuPos(null); }}
            cursorPos={contextMenuPos}
            gameId={game.appId}
          >
            {isRunning ? (
              <MenuItem
                label="Stop"
                icon={<X className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); stopSession(gk); }}
              />
            ) : action === "play" ? (
              <MenuItem
                label="Play"
                icon={<Play className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); onPlay(game); }}
              />
            ) : (
              <MenuItem
                label="Install"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); onInstall(game); }}
              />
            )}
            <MenuItem
              label={favorite ? "Remove from favorites" : "Add to favorites"}
              icon={<Heart className={`h-3.5 w-3.5 ${favorite ? "fill-current" : ""}`} />}
              onClick={() => { if (game.appId) toggleFavorite(game.appId); setMenuOpen(false); }}
            />
            <MenuItem
              label="Browse Local Files"
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              onClick={() => {
                setMenuOpen(false);
                if (game.installDir) {
                  invoke("open_folder", { path: game.installDir }).catch((err) => {
                    showError(`Could not open folder: ${err}`);
                  });
                }
              }}
            />
            <MenuItem
              label="Create Shortcut"
              icon={<FileText className="h-3.5 w-3.5" />}
              onClick={async () => {
                setMenuOpen(false);

                try {
                  if (!game?.appId) {
                    showError("Game ID not available");
                    return;
                  }

                  const { getExePathFromEntry, setInstalledGameEntry } = await import(
                    "../../services/installedGamesRegistry"
                  );

                  let exePath = await getExePathFromEntry(game.appId);

                  if (!exePath && game.executablePath) {
                    exePath = game.executablePath;
                  }

                  if (!exePath && game.installDir) {
                    const { discoverExecutables } = await import(
                      "../../services/tauri"
                    );

                    const executables = await discoverExecutables(game.installDir);

                    if (executables?.length > 0) {
                      const validExe =
                        executables.find(e =>
                          !["launcher", "crash", "setup"].some(x =>
                            e.file_name.toLowerCase().includes(x)
                          )
                        ) || executables[0];

                      exePath = validExe.exe_path;


                      await setInstalledGameEntry({
                        gameId: game.appId,
                        exePath: validExe.exe_path,
                        exeName: validExe.file_name,
                        installDir: game.installDir,
                        provider: "unknown",
                        lastValidated: Date.now(),
                      });
                    }
                  }

                  if (!exePath) {
                    showError("Could not locate executable for this game");
                    return;
                  }

                  const path = await invoke<string>("create_shortcut", {
                    exePath,
                    name: game.title || `Game ${game.appId}`,
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
                  disabled: !game.steamInstalled,
                  subtitle: !game.steamInstalled ? "Not installed" : undefined,
                },
                ...(hasLua
                  ? [{
                    label: "Delete Lua",
                    icon: <X className="h-3.5 w-3.5" />,
                    destructive: true as const,
                    onClick: onDeleteScript
                      ? () => { setMenuOpen(false); onDeleteScript(game); }
                      : undefined,
                    disabled: !onDeleteScript,
                  }]
                  : []),
              ]}
            />
          </CardActionMenu>
        </div>
      </div>
    </div>
  );
}


