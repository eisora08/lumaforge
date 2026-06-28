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
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import { useSettings } from "../../context/SettingsContext";
import AsyncImage from "../common/AsyncImage";
import { SkeletonBox } from "../common/Skeleton";

type GameLauncherTileProps = {
  game: LibraryGame;
  artwork?: SgdbArtworkData | null;
  onSelect: (game: LibraryGame) => void;
  onPlay: (game: LibraryGame) => void;
  onInstall: (game: LibraryGame) => void;
  onDeleteScript?: (game: LibraryGame) => void;
};

function getCardImage(
  game: LibraryGame,
  mode: "landscape" | "poster",
  artwork?: SgdbArtworkData | null
): string | undefined {
  const meta = game.metadata;
  if (mode === "poster") {
    return (
      artwork?.sgdbGridUrl ||
      artwork?.sgdbGridThumbUrl ||
      meta?.capsule_image ||
      meta?.capsule_image_v5 ||
      meta?.header_image ||
      game.imageUrl ||
      undefined
    );
  }
  return (
    game.imageUrl ||
    meta?.header_image ||
    meta?.library_hero_image ||
    meta?.hero_image ||
    meta?.background_image ||
    meta?.capsule_image ||
    meta?.capsule_image_v5 ||
    undefined
  );
}

export default function GameLauncherTile({
  game,
  artwork,
  onSelect,
  onPlay,
  onInstall,
  onDeleteScript,
}: GameLauncherTileProps) {
  const { settings } = useSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const artworkMode = settings.libraryCardArtworkMode ?? "landscape";
  const sgdbEnabled = settings.steamGridDbArtworkEnabled && !!settings.steamGridDbApiKey;
  const expectingSgdbArt = artworkMode === "poster" && sgdbEnabled;

  const displayImage = useMemo(
    () => getCardImage(game, artworkMode, artwork),
    [game, artworkMode, artwork]
  );

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
        {displayImage ? (
          <AsyncImage
            src={displayImage}
            alt={game.title}
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
            {game.title}
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
