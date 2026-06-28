import { useState } from "react";
import { Download, ExternalLink, Gamepad2, Play } from "lucide-react";
import type { LauncherGame } from "../../types/launcherGame";

type GameLauncherTileProps = {
  game: LauncherGame;
  onSelect: (game: LauncherGame) => void;
  onPlay: (game: LauncherGame) => void;
  onInstall: (game: LauncherGame) => void;
};

export default function GameLauncherTile({ game, onSelect, onPlay, onInstall }: GameLauncherTileProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  function handleAction(e: React.MouseEvent, action: () => void) {
    e.stopPropagation();
    action();
  }

  return (
    <div
      className="group relative aspect-video cursor-pointer overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/5 transition hover:border-(--color-accent)/40"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onSelect(game)}
    >
      {game.imageUrl && !imageFailed ? (
        <img
          src={game.imageUrl}
          alt={game.title}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-white/5">
          <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
        </div>
      )}

      <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-transparent" />

      <div className="absolute bottom-0 left-0 right-0 z-10 p-3">
        <h3 className="line-clamp-1 text-sm font-bold text-white drop-shadow">
          {game.title}
        </h3>

        <div className="mt-1 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/15 px-2 py-0.5 text-[10px] font-medium text-(--color-accent)">
            {game.source === "steam" ? "Steam" : "Local"}
          </span>
          {game.isInstalled ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
              Installed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-zinc-500/20 bg-zinc-500/15 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
              Not Installed
            </span>
          )}
        </div>
      </div>

      {isHovered && (
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/50 backdrop-blur-[2px]">
          {game.isPlayable && (
            <button
              type="button"
              onClick={(e) => handleAction(e, () => onPlay(game))}
              className="inline-flex items-center gap-1.5 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-bold text-black transition hover:opacity-90"
            >
              <Play className="h-3.5 w-3.5" />
              Play
            </button>
          )}
          {!game.isInstalled && game.source === "steam" && (
            <button
              type="button"
              onClick={(e) => handleAction(e, () => onInstall(game))}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/25"
            >
              <Download className="h-3.5 w-3.5" />
              Install
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
