import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Gamepad2,
  Heart,
  MoreHorizontal,
  Play,
  Trash2,
  X,
} from "lucide-react";
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
  localPathToUrl,
  isHttpUrl,
  isLocalPath,
} from "../../services/libraryLocalCacheService";
import {
  loadGameAppInfoWithMediaFallback,
} from "../../services/gameCacheService";

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

function resolveImageSrc(src: string | undefined): string | undefined {
  if (!src) return undefined;
  if (isHttpUrl(src)) return src;
  if (isLocalPath(src)) return localPathToUrl(src) ?? undefined;
  return src;
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
  const [favorite, setFavorite] = useState(false);
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
      .then((appInfo) => {
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

  // Title priority: customTitle > appinfo name > game.title > metadata name > fallback
  const displayTitle =
    game.customTitle ||
    appInfoEntry?.name ||
    game.title ||
    game.metadata?.name ||
    (game.appId ? `Steam App ${game.appId}` : "Unknown Game");

  const displayImage = useMemo(
    () => getCardImage(artworkMode, canonicalInfo),
    [artworkMode, canonicalInfo]
  );

  const resolvedSrc = useMemo(() => resolveImageSrc(displayImage), [displayImage]);

  // Raw local path for data URL fallback (only if it's a local file, not remote URL)
  const fallbackLocalPath = useMemo(() => {
    if (!displayImage) return null;
    if (isHttpUrl(displayImage)) return null;
    if (!isLocalPath(displayImage)) return null;
    return displayImage;
  }, [displayImage]);

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
    <div ref={ref} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenuPos({ x: e.clientX, y: e.clientY }); setMenuOpen(true); }} className="group flex flex-col rounded-2xl bg-transparent lf-card-hover hover:bg-white/[0.02] lf-press-effect">
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
        className={`relative cursor-pointer overflow-hidden rounded-t-2xl ${
          artworkMode === "poster" ? "aspect-[2/3]" : "aspect-[5/3]"
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
            <MenuItem
              label={favorite ? "Remove from favorites" : "Add to favorites"}
              icon={<Heart className={`h-3.5 w-3.5 ${favorite ? "fill-current" : ""}`} />}
              onClick={() => { setFavorite(!favorite); setMenuOpen(false); }}
            />
            <MenuItem
              label="Uninstall"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              disabled={!game.steamInstalled}
              subtitle={!game.steamInstalled ? "Not installed" : "Coming soon"}
            />
            {hasLua && onDeleteScript && (
              <MenuItem
                label="Delete Lua"
                icon={<X className="h-3.5 w-3.5" />}
                destructive
                onClick={() => {
                  setMenuOpen(false);
                  onDeleteScript(game);
                }}
              />
            )}
            {hasLua && !onDeleteScript && (
              <MenuItem
                label="Delete Lua"
                icon={<X className="h-3.5 w-3.5" />}
                disabled
              />
            )}
          </CardActionMenu>
        </div>
      </div>
    </div>
  );
}


