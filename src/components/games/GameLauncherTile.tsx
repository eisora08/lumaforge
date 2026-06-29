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
import type { SgdbArtworkData } from "../../services/storeArtworkResolver";
import type { LibraryAppInfoEntry, GameMediaCacheEntry } from "../../services/tauri";
import type { GameAppInfo } from "../../services/gameCacheService";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import { useSettings } from "../../context/SettingsContext";
import AsyncImage from "../common/AsyncImage";
import { SkeletonBox } from "../common/Skeleton";
import {
  localPathToUrl,
  isHttpUrl,
  isLocalPath,
  getMediaCacheForAppId,
} from "../../services/libraryLocalCacheService";
import {
  loadGameAppInfo,
} from "../../services/gameCacheService";

type GameLauncherTileProps = {
  game: LibraryGame;
  artwork?: SgdbArtworkData | null;
  appInfoEntry?: LibraryAppInfoEntry | null;
  onSelect: (game: LibraryGame) => void;
  onPlay: (game: LibraryGame) => void;
  onInstall: (game: LibraryGame) => void;
  onDeleteScript?: (game: LibraryGame) => void;
};

function getCardImage(
  game: LibraryGame,
  mode: "landscape" | "poster",
  artwork: SgdbArtworkData | null | undefined,
  appInfoEntry: LibraryAppInfoEntry | null | undefined,
  mediaEntry: GameMediaCacheEntry | null | undefined,
  canonicalAppInfo: GameAppInfo | null,
): string | undefined {
  const meta = game.metadata;

  if (mode === "poster") {
    return (
      canonicalAppInfo?.media?.cover_path ||
      canonicalAppInfo?.media?.landscape_path ||
      mediaEntry?.cover_path ||
      mediaEntry?.grid_path ||
      mediaEntry?.quick_cover_path ||
      appInfoEntry?.cover_path ||
      appInfoEntry?.grid_path ||
      appInfoEntry?.header_image ||
      artwork?.sgdbGridUrl ||
      artwork?.sgdbGridThumbUrl ||
      meta?.capsule_image ||
      meta?.capsule_image_v5 ||
      meta?.header_image ||
      game.imageUrl ||
      undefined
    );
  }

  // Landscape mode: landscape.jpg first, cover only as last resort
  const canonicalLandscape = canonicalAppInfo?.media?.landscape_path;
  if (canonicalLandscape) return canonicalLandscape;

  const localLandscape = mediaEntry?.grid_path;
  if (localLandscape) return localLandscape;

  const appInfoLandscape = appInfoEntry?.grid_path;
  if (appInfoLandscape) return appInfoLandscape;

  if (game.imageUrl) return game.imageUrl;

  const remoteLandscape = meta?.header_image || meta?.library_hero_image || meta?.hero_image || meta?.background_image;
  if (remoteLandscape) return remoteLandscape;

  // Fallback: local cover
  const canonicalCover = canonicalAppInfo?.media?.cover_path;
  if (canonicalCover) return canonicalCover;

  const localCover = mediaEntry?.cover_path || mediaEntry?.quick_cover_path;
  if (localCover) return localCover;

  const appInfoCover = appInfoEntry?.cover_path || appInfoEntry?.header_image;
  if (appInfoCover) return appInfoCover;

  return meta?.capsule_image || meta?.capsule_image_v5 || undefined;
}

function resolveImageSrc(src: string | undefined): string | undefined {
  if (!src) return undefined;
  if (isHttpUrl(src)) return src;
  if (isLocalPath(src)) return localPathToUrl(src);
  return src;
}

export default function GameLauncherTile({
  game,
  artwork,
  appInfoEntry,
  onSelect,
  onPlay,
  onInstall,
  onDeleteScript,
}: GameLauncherTileProps) {
  const { settings } = useSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [mediaEntry, setMediaEntry] = useState<GameMediaCacheEntry | null>(null);
  const [canonicalInfo, setCanonicalInfo] = useState<GameAppInfo | null>(null);
  const [mediaLoading, setMediaLoading] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  // Load media cache + canonical appinfo for this game — with crash guard
  useEffect(() => {
    if (!game.appId) {
      setMediaLoading(false);
      return;
    }
    let cancelled = false;
    setMediaLoading(true);
    Promise.all([
      getMediaCacheForAppId(game.appId).catch(() => null),
      loadGameAppInfo(game.appId).catch(() => null),
    ]).then(([entry, appInfo]) => {
      if (!cancelled) {
        setMediaEntry(entry);
        setCanonicalInfo(appInfo);
        setMediaLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setMediaLoading(false);
    });
    return () => { cancelled = true; };
  }, [game.appId]);

  const artworkMode = settings.libraryCardArtworkMode ?? "landscape";
  const sgdbEnabled = settings.steamGridDbArtworkEnabled && !!settings.steamGridDbApiKey;
  const expectingSgdbArt = artworkMode === "poster" && sgdbEnabled;

  // Title priority: customTitle > appinfo name > game.title > metadata name > fallback
  const displayTitle =
    game.customTitle ||
    appInfoEntry?.name ||
    game.title ||
    game.metadata?.name ||
    (game.appId ? `Steam App ${game.appId}` : "Unknown Game");

  const displayImage = useMemo(
    () => getCardImage(game, artworkMode, artwork, appInfoEntry, mediaEntry, canonicalInfo),
    [game, artworkMode, artwork, appInfoEntry, mediaEntry, canonicalInfo]
  );

  const resolvedSrc = useMemo(() => resolveImageSrc(displayImage), [displayImage]);

  const action = getLauncherGamePrimaryAction(game);
  const hasLua = game.luaScripts.length > 0;

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

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
    setMenuOpen((prev) => !prev);
  }

  return (
    <div className="group flex flex-col rounded-2xl border border-(--surface-active-border) bg-white/[0.03] lf-card-hover hover:border-(--color-accent)/30 hover:bg-white/[0.06]">
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
          artworkMode === "poster" ? "aspect-[3/4]" : "aspect-video"
        }`}
      >
        {mediaLoading ? (
          <SkeletonBox className="h-full w-full rounded-t-2xl" />
        ) : resolvedSrc ? (
          <AsyncImage
            src={resolvedSrc}
            alt={displayTitle}
            className="h-full w-full"
            fallback={
              <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
            }
          />
        ) : expectingSgdbArt ? (
          <SkeletonBox className="h-full w-full rounded-t-2xl" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
          </div>
        )}
      </div>

      {/* Title + actions row */}
      <div className="flex items-start gap-1 px-3 py-2.5">
        <div className="min-w-0 flex-1">
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
            className="line-clamp-1 cursor-pointer text-sm font-medium text-(--color-text) transition hover:text-(--color-accent)"
          >
            {displayTitle}
          </h3>

          <div className="mt-1.5 flex items-center gap-2">
            {action === "play" && (
              <button
                type="button"
                onClick={(e) => handleActionClick(e, () => onPlay(game))}
                className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-(--color-accent) transition hover:opacity-80"
              >
                <Play className="h-3 w-3" />
                Play
              </button>
            )}
            {action === "install" && (
              <button
                type="button"
                onClick={(e) => handleActionClick(e, () => onInstall(game))}
                className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-(--color-accent) transition hover:opacity-80"
              >
                <Download className="h-3 w-3" />
                Install
              </button>
            )}
            {action === "missing-path" && (
              <span className="text-[10px] text-(--color-muted)">Missing Path</span>
            )}
          </div>
        </div>

        {/* Three-dots menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={handleMenuToggle}
            className="inline-flex cursor-pointer items-center justify-center rounded-lg p-1 text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-xl border border-(--surface-active-border) bg-(--color-bg) p-1 shadow-lg">
                <MenuButton
                  label={favorite ? "Remove from favorites" : "Add to favorites"}
                  icon={<Heart className={`h-3.5 w-3.5 ${favorite ? "fill-current" : ""}`} />}
                  onClick={() => setFavorite(!favorite)}
                />
                <MenuButton
                  label="Uninstall"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  disabled={!game.steamInstalled}
                  subtitle={!game.steamInstalled ? "Not installed" : "Coming soon"}
                />
                {hasLua && onDeleteScript && (
                  <MenuButton
                    label="Delete Lua"
                    icon={<X className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setMenuOpen(false);
                      onDeleteScript(game);
                    }}
                  />
                )}
                {hasLua && !onDeleteScript && (
                  <MenuButton
                    label="Delete Lua"
                    icon={<X className="h-3.5 w-3.5" />}
                    disabled
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuButton({
  label,
  icon,
  disabled,
  subtitle,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  subtitle?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${
        disabled
          ? "cursor-not-allowed text-(--color-muted)/40"
          : "cursor-pointer text-(--color-text) hover:bg-white/5"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {subtitle && (
        <span className="text-[10px] text-(--color-muted)">{subtitle}</span>
      )}
    </button>
  );
}
