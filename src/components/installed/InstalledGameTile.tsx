import { useState } from "react";
import { Download, ExternalLink, Gamepad2, Play, RefreshCcw } from "lucide-react";
import type { InstalledLibraryGame } from "../../types/installedLibrary";

type InstalledGameTileProps = {
  game: InstalledLibraryGame;
  onSelect: (game: InstalledLibraryGame) => void;
  onPlay?: (game: InstalledLibraryGame) => void;
  onInstallSteam?: (game: InstalledLibraryGame) => void;
  onSync?: (game: InstalledLibraryGame) => void;
};

function getImageUrl(game: InstalledLibraryGame): string | undefined {
  return (
    game.imageUrl ||
    game.metadata?.header_image ||
    game.metadata?.capsule_image ||
    game.metadata?.capsule_image_v5 ||
    undefined
  );
}

export default function InstalledGameTile({ game, onSelect, onPlay, onInstallSteam, onSync }: InstalledGameTileProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const imageUrl = getImageUrl(game);

  const isSteamInstalled = game.steamInstalled === true;
  const isLuaActive = game.installStatus === "active";
  const isLuaDisabled = game.installStatus === "disabled";

  function handleAction(e: React.MouseEvent, action: () => void) {
    e.stopPropagation();
    action();
  }

  return (
    <div
      className="group relative aspect-video cursor-pointer overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/5 transition hover:bg-white/[0.04] hover:border-(--color-accent)/40"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onSelect(game)}
    >
      {imageUrl && !imageFailed ? (
        <img
          src={imageUrl}
          alt={game.title}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-white/5">
          <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
        </div>
      )}

      <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-transparent" />

      {/* Badges */}
      <div className="absolute bottom-0 left-0 right-0 z-10 p-3">
        <h3 className="line-clamp-1 text-sm font-bold text-white drop-shadow">
          {game.title}
        </h3>

        <div className="mt-1 flex items-center gap-1.5">
          {isSteamInstalled && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
              Installed
            </span>
          )}
          {isLuaActive && (
            <span className="inline-flex items-center gap-1 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/15 px-2 py-0.5 text-[10px] font-medium text-(--color-accent)">
              Lua
            </span>
          )}
          {isLuaDisabled && (
            <span className="inline-flex items-center gap-1 rounded-full border border-zinc-500/20 bg-zinc-500/15 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
              Disabled
            </span>
          )}
          {!isLuaActive && !isLuaDisabled && game.hasAvailableSource && (
            <span className="inline-flex items-center gap-1 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/15 px-2 py-0.5 text-[10px] font-medium text-(--color-accent)">
              Lua Ready
            </span>
          )}
          {game.hasUpdate && (
            <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/20 bg-yellow-500/15 px-2 py-0.5 text-[10px] font-medium text-yellow-300">
              Update
            </span>
          )}
        </div>
      </div>

      {/* Hover actions */}
      {isHovered && (
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/50 backdrop-blur-[2px]">
          {!isSteamInstalled && onInstallSteam && (
            <button
              type="button"
              onClick={(e) => handleAction(e, () => onInstallSteam(game))}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/25"
            >
              <Download className="h-3.5 w-3.5" />
              Install
            </button>
          )}
          {isSteamInstalled && onPlay && (
            <button
              type="button"
              onClick={(e) => handleAction(e, () => onPlay(game))}
              className="inline-flex items-center gap-1.5 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-bold text-(--color-accent-text) transition hover:opacity-90"
            >
              <Play className="h-3.5 w-3.5" />
              Play
            </button>
          )}
          {game.hasAvailableSource && onSync && (
            <button
              type="button"
              onClick={(e) => handleAction(e, () => onSync(game))}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/25"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Sync
            </button>
          )}
          <button
            type="button"
            onClick={(e) => handleAction(e, () => onSelect(game))}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/25"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Details
          </button>
        </div>
      )}
    </div>
  );
}
