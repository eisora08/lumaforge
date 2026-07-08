import { Gamepad2, Heart } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import AsyncImage from "../../components/common/AsyncImage";
import { useFavorites } from "../../context/FavoritesContext";

type Props = {
  game: LibraryGame;
  isFocused?: boolean;
};

export default function ConsoleGameCard({ game, isFocused }: Props) {
  const { isFavorite } = useFavorites();
  const fav = game.appId ? isFavorite(game.appId) : false;

  const coverSrc =
    game.metadata?.capsule_image_v5 ||
    game.metadata?.header_image ||
    game.imageUrl ||
    null;

  return (
    <div
      className={`group/card w-[280px] shrink-0 snap-start cursor-pointer rounded-2xl border bg-(--color-surface)/20 transition-all duration-200 hover:bg-(--color-surface)/40 ${
        isFocused
          ? "border-(--color-accent)/60 ring-2 ring-(--color-accent)/30"
          : "border-(--surface-active-border) hover:border-(--color-accent)/30"
      }`}
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded-t-2xl">
        {coverSrc ? (
          <AsyncImage
            src={coverSrc}
            alt={game.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover/card:scale-105"
            fallback={
              <div className="flex h-full w-full items-center justify-center bg-(--color-surface)/40">
                <Gamepad2 className="h-10 w-10 text-(--color-muted)/30" />
              </div>
            }
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-(--color-surface)/40">
            <Gamepad2 className="h-10 w-10 text-(--color-muted)/30" />
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 bg-black/20 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100" />

        {fav && (
          <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
            <Heart className="h-3.5 w-3.5 fill-rose-400 text-rose-400" />
          </div>
        )}

        <div className="absolute bottom-2 left-2 flex flex-wrap gap-1.5">
          {game.steamInstalled && (
            <span className="rounded-md bg-emerald-500/80 px-2 py-0.5 text-[10px] font-medium text-black backdrop-blur-sm">
              Installed
            </span>
          )}
          {game.isLuaActive && (
            <span className="rounded-md bg-violet-500/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
              Lua
            </span>
          )}
          {game.hasUpdate && (
            <span className="rounded-md bg-amber-500/80 px-2 py-0.5 text-[10px] font-medium text-black backdrop-blur-sm">
              Update
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        <h3 className="line-clamp-1 text-sm font-semibold text-(--color-text)">
          {game.title}
        </h3>
      </div>
    </div>
  );
}
