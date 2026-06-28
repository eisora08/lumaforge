import { useMemo, useState } from "react";
import { Download, ExternalLink, Gamepad2, Play } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import { useSettings } from "../../context/SettingsContext";

type GameLauncherTileProps = {
  game: LibraryGame;
  onSelect: (game: LibraryGame) => void;
  onPlay: (game: LibraryGame) => void;
  onInstall: (game: LibraryGame) => void;
};

function getTileImage(game: LibraryGame, mode: "landscape" | "poster"): string | undefined {
  const meta = game.metadata;
  if (mode === "poster") {
    return (
      game.imageUrl ||
      meta?.capsule_image_v5 ||
      meta?.capsule_image ||
      meta?.header_image ||
      undefined
    );
  }
  return (
    game.imageUrl ||
    meta?.header_image ||
    meta?.library_hero_image ||
    meta?.hero_image ||
    meta?.background_image ||
    meta?.capsule_image_v5 ||
    meta?.capsule_image ||
    undefined
  );
}

export default function GameLauncherTile({ game, onSelect, onPlay, onInstall }: GameLauncherTileProps) {
  const { settings } = useSettings();
  const [imageFailed, setImageFailed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const displayImage = useMemo(
    () => getTileImage(game, settings.libraryCardArtworkMode),
    [game, settings.libraryCardArtworkMode]
  );

  function handleAction(e: React.MouseEvent, action: () => void) {
    e.stopPropagation();
    action();
  }

  const action = getLauncherGamePrimaryAction(game);

  return (
    <div
      className="group relative aspect-video cursor-pointer overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/5 transition hover:border-(--color-accent)/40"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onSelect(game)}
    >
      {displayImage && !imageFailed ? (
        <img
          src={displayImage}
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
      </div>

      {isHovered && (
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/50 backdrop-blur-[2px]">
          {action === "play" && (
            <button
              type="button"
              onClick={(e) => handleAction(e, () => onPlay(game))}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
            >
              <Play className="h-3.5 w-3.5" />
              Play
            </button>
          )}
          {action === "install" && (
            <button
              type="button"
              onClick={(e) => handleAction(e, () => onInstall(game))}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/25 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
            >
              <Download className="h-3.5 w-3.5" />
              Install
            </button>
          )}
          {action === "missing-path" && (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-zinc-400">
              Missing Path
            </span>
          )}
          <button
            type="button"
            onClick={(e) => handleAction(e, () => onSelect(game))}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/25 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Details
          </button>
        </div>
      )}
    </div>
  );
}
